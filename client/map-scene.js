import {mobileDevice} from './device-profile.js';
import * as THREE from 'three';
import {gameGLTFLoader} from './gltf-loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import { MAP } from '../shared/map-data.js';
import { assetURL, useDownloadedAssets } from './loading.js';

const assetUrl=path=>new URL(path.replace(/^\//,''),document.baseURI).href;

/** Actual CS2 render geometry, original material UVs, browser-compressed textures.
 * Source 2 Viewer handles VTEX/VMAT conversion. Physics stays a separate,
 * separately sourced reduced collision mesh for deterministic multiplayer;
 * render/collision alignment is checked by map-render-validate.mjs.
 */
// Classify a Source 2 VMAT by its actual render metadata (shader, flags and
// the alphaMode/alphaTest that GLTFLoader already resolved), not by broad name
// regexes. A crate's "_decals" layer is still an opaque surface. Returns three
// orthogonal decisions so render state, depth bias and geometry correction are
// never coupled:
//   renderType         -> transparent / depthWrite / depthTest / alphaTest
//   depthBias          -> polygonOffset only
//   geometryCorrection -> whether/how vertices are shifted (none|overlay|window-inset)
function classifySource2Material(material, object) {
  const vmat = material.userData?.vmat || {};
  const flags = vmat.IntParams || {};
  const shader = vmat.ShaderName || '';

  // Depth-feathered proxy volumes have no glTF opacity equivalent; hide them.
  if (flags.F_DEPTH_FEATHER) return { renderType: 'hidden', depthBias: false, geometryCorrection: 'none' };

  const isOverlay =
    !!(flags.F_OVERLAY || shader === 'csgo_static_overlay.vfx') ||
    /s_mesh_overlay/i.test(object.name);
  // Narrow, deliberate special-case: Source 2 Viewer exports the kasbah window
  // inset geometry pushed outward, needing its own vertex alignment. This name
  // match controls geometryCorrection (and at most depthBias), never renderType.
  const isWindowInset =
    /dust_kasbah_window_insets/i.test(object.name) ||
    /dust_kasbah_window_insets/i.test(material.name || '') ||
    /dust_kasbah_window_insets/i.test(vmat.Name || '');

  if (material.transparent) {
    return {
      renderType: isOverlay ? 'decal' : 'transparent',
      depthBias: isOverlay,
      geometryCorrection: isOverlay ? 'overlay' : 'none',
    };
  }
  if (material.alphaTest > 0) {
    return {
      renderType: 'alpha-cutout',
      depthBias: !!flags.F_DEPTH_BIAS,
      geometryCorrection: isWindowInset ? 'window-inset' : 'none',
    };
  }
  return {
    renderType: 'opaque',
    depthBias: isOverlay || !!flags.F_DEPTH_BIAS,
    geometryCorrection: isWindowInset ? 'window-inset' : (isOverlay ? 'overlay' : 'none'),
  };
}

// Apply the classified render policy. Only decal/transparent surfaces enter the
// blended queue; opaque and alpha-cutout keep writing depth so they correctly
// occlude one another. depthBias only toggles polygonOffset — it never implies
// transparency.
function configureMaterialForType(material, { renderType, depthBias }) {
  if (renderType === 'hidden') {
    material.visible = false;
    material.polygonOffset = false;
    return;
  }
  if (renderType === 'opaque' || renderType === 'alpha-cutout') {
    material.transparent = false;
    material.depthWrite = true;
    material.depthTest = true;
  } else { // 'decal' | 'transparent'
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
  }
  if (depthBias) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
  } else {
    material.polygonOffset = false;
  }
}

// Shift vertices backward along their normals by a world-space distance. Source 2
// Viewer pushes surface-attached geometry (overlay decals and window insets)
// ~0.392 m outward; moving them back along the normal lays them flush without
// touching their transparent/depthWrite state.
function shiftAlongNormal(object, worldDistance) {
  const pos = object.geometry?.attributes?.position;
  const norm = object.geometry?.attributes?.normal;
  if (!pos || !norm) return;
  const scale = object.getWorldScale(new THREE.Vector3()).x || 1.0;
  const localShift = worldDistance / scale;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) - norm.getX(i) * localShift,
      pos.getY(i) - norm.getY(i) * localShift,
      pos.getZ(i) - norm.getZ(i) * localShift
    );
  }
  pos.needsUpdate = true;
  object.geometry.computeBoundingBox();
  object.geometry.computeBoundingSphere();
}

function shiftOverlayOntoSurface(object) { shiftAlongNormal(object, 0.392); }
function shiftWindowInsetOntoSurface(object) { shiftAlongNormal(object, 0.392); }

export async function createMapScene(scene,{onProgress=()=>{}}={}) {
  onProgress('载入 CS2 原版 Dust II 场景…');
  const manager=new THREE.LoadingManager();
  useDownloadedAssets(manager);
  manager.onProgress=(_url,loaded,total)=>{
    if(total>5)onProgress(`载入原版材质 ${Math.min(loaded,total)} / ${total}…`);
  };
  const loader=gameGLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  const [gltf,response,sky,matResponse]=await Promise.all([
    loader.loadAsync(assetUrl(mobileDevice()?'assets/map-mobile/dust2-mobile.gltf':'assets/map-cs2/dust2-web.gltf?v=e4f2b2d3903c')),
    fetch(assetURL(assetUrl(MAP.geometryUrl))),
    new HDRLoader(manager).loadAsync(assetUrl('assets/sky/daylight.hdr?v=5244534e9cf5')),
    fetch(assetURL(assetUrl('assets/map/penetration-materials.u8'))).catch(()=>null),
  ]);
  if(!response.ok)throw new Error(`地图碰撞下载失败 (${response.status})`);
  const positions=new Float32Array(await response.arrayBuffer());
  const surfaceMaterials = matResponse && matResponse.ok ? new Uint8Array(await matResponse.arrayBuffer()) : null;
  onProgress('对齐场景、材质和碰撞…');
  const group=new THREE.Group();
  group.name='Dust II · original CS2 render';
  // S2V: Source (x,y,z) → meters (y,z,x). Gameplay: (x,z,-y).
  // S2V already bakes inch-to-meter scaling; do not scale the model again.
  group.rotation.y=Math.PI/2;
  group.add(gltf.scene);
  group.updateMatrixWorld(true);
  const originalLights=[];
  const textures=new Set(),materials=new Set();
  let meshCount=0,triangles=0;
  group.traverse(object=>{
    if(object.isLight){originalLights.push(object);return;}
    if(!object.isMesh)return;
    meshCount++;
    triangles+=(object.geometry.index?.count||object.geometry.attributes.position.count)/3;
    object.castShadow=true;object.receiveShadow=true;
    object.frustumCulled=true;
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      const flags=material.userData?.vmat?.IntParams||{};
      const classification=classifySource2Material(material,object);
      if(classification.renderType==='hidden'||classification.renderType==='decal'||classification.depthBias||flags.F_DO_NOT_CAST_SHADOWS){
        object.castShadow=false;
      }
      if(classification.geometryCorrection&&classification.geometryCorrection!=='none'&&!object.userData.geometryCorrected){
        object.userData.geometryCorrected=classification.geometryCorrection;
        if(classification.geometryCorrection==='window-inset')shiftWindowInsetOntoSurface(object);
        else shiftOverlayOntoSurface(object);
      }
      if(materials.has(material))continue;
      materials.add(material);
      configureMaterialForType(material,classification);
      // In Source foliage/cloth shaders vertex colors encode wind weights,
      // not albedo. Multiplying them into the texture turns green leaves red.
      if(flags.F_VERTEX_ANIMATION||['csgo_effects.vfx','csgo_foliage.vfx'].includes(material.userData?.vmat?.ShaderName))material.vertexColors=false;
      for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
    }
  });
  for(const texture of textures)texture.anisotropy=mobileDevice()?1:4;

  // Keep the exported sun direction. Web lighting approximates Source 2's
  // baked lighting; original surface textures and their UVs stay untouched.
  const sunDirection=new THREE.Vector3(-.43,-.84,-.33);
  const originalSun=originalLights.find(l=>l.isDirectionalLight);
  if(originalSun){
    const origin=new THREE.Vector3(),target=new THREE.Vector3();
    originalSun.getWorldPosition(origin);originalSun.target.getWorldPosition(target);
    if(target.distanceToSquared(origin)>1e-8)sunDirection.subVectors(target,origin).normalize();
  }
  for(const light of originalLights)light.removeFromParent();
  scene.add(group);
  // The map is static: retain its already-computed transforms instead of
  // multiplying every imported object matrix on every animation frame.
  group.traverse(object=>{object.matrixAutoUpdate=false;object.matrixWorldAutoUpdate=false;});
  sky.mapping=THREE.EquirectangularReflectionMapping;
  scene.background=sky;scene.backgroundIntensity=.8;
  scene.backgroundRotation.y=1.2;
  scene.userData.sky={source:'Poly Haven / Kloofendal 48d Partly Cloudy',resolution:'2048 × 1024',downloadBytes:5451493};
  scene.fog=new THREE.Fog(0xc9d8de,140,300);
  const hemisphere=new THREE.HemisphereLight(0xd5e9ff,0x99805f,2.15);
  hemisphere.name='dust2-web-sky';
  const sun=new THREE.DirectionalLight(0xfff0d7,3.3);
  sun.name='dust2-web-sun';
  const center=new THREE.Vector3(-5,0,-25);
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(sunDirection,-110);
  sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-78,right:78,top:78,bottom:-78,near:1,far:230});
  sun.shadow.normalBias=.035;sun.shadow.bias=-.00012;
  scene.add(hemisphere,sun,sun.target);
  group.userData.renderStats={meshCount,triangles,materials:materials.size,textures:textures.size,originalCS2Materials:true};
  onProgress('CS2 原版 Dust II 场景就绪');
  return {mapData:MAP,positions,surfaceMaterials,group,lights:[hemisphere,sun],spawn:MAP.spawns.T[0]};
}

export { MAP };
