import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {shiftAlongNormal} from '../client/map-scene.js';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

test('surface offsets decode normalized integer positions before crossing their storage limits',()=>{
 const geometry=new THREE.BufferGeometry();
 const original=new THREE.Int16BufferAttribute([-32767,0,0,32767,0,0,0,32767,0],3,true);
 geometry.setAttribute('position',original);
 geometry.setAttribute('normal',new THREE.Float32BufferAttribute([1,0,0,-1,0,0,0,-1,0],3));
 const mesh=new THREE.Mesh(geometry);mesh.scale.setScalar(10);mesh.updateMatrixWorld(true);
 shiftAlongNormal(mesh,.392);
 const positions=geometry.attributes.position;
 assert.ok(Math.abs(positions.getX(0)-(-1-.0392))<1e-6);
 assert.ok(Math.abs(positions.getX(1)-(1+.0392))<1e-6);
 assert.ok(Math.abs(positions.getY(2)-(1+.0392))<1e-6);
 assert.ok(positions.array instanceof Float32Array);assert.equal(positions.normalized,false);
 assert.equal(original.getX(0),-1);
 assert.ok(geometry.boundingBox.min.x<-1);assert.ok(geometry.boundingBox.max.x>1);
 geometry.dispose();mesh.material.dispose();
});

test('real Dust II overlay and window vertices move only the intended distance',async()=>{
 const file=new URL('../public/assets/map-cs2/dust2-web.gltf',import.meta.url);
 const json=JSON.parse(await readFile(file,'utf8'));
 for(const buffer of json.buffers||[])if(buffer.uri&&!buffer.uri.startsWith('data:')){
  buffer.uri='data:application/octet-stream;base64,'+(await readFile(new URL(buffer.uri,file))).toString('base64');
 }
 json.materials=json.materials.map(m=>({name:m.name,extras:m.extras}));
 delete json.textures;delete json.images;
 json.extensionsRequired=json.extensionsRequired.filter(e=>!e.includes('texture'));
 json.extensionsUsed=json.extensionsUsed.filter(e=>!e.includes('texture'));
 globalThis.ProgressEvent??=class{constructor(type,init){Object.assign(this,{type},init);}};
 const {scene}=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(json),'');
 scene.updateMatrixWorld(true);
 let meshes=0,vertices=0,wrapped=0;
 scene.traverse(mesh=>{
  if(!mesh.isMesh)return;
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  if(/s_mesh_overlay|dust_kasbah_window_insets/i.test(mesh.name)||materials.some(m=>/dust_kasbah_window_insets/i.test(m.name))){
   const before=mesh.geometry.attributes.position,normal=mesh.geometry.attributes.normal;
   shiftAlongNormal(mesh,.392);
   const after=mesh.geometry.attributes.position;
   const scale=mesh.getWorldScale(new THREE.Vector3()).x;
   for(let i=0;i<before.count;i++){
    const delta=new THREE.Vector3(after.getX(i)-before.getX(i),after.getY(i)-before.getY(i),after.getZ(i)-before.getZ(i)).multiplyScalar(scale);
    const expected=new THREE.Vector3(normal.getX(i),normal.getY(i),normal.getZ(i)).multiplyScalar(-.392);
    const old=new Int16Array([Math.round((before.getX(i)+expected.x/scale)*32767),Math.round((before.getY(i)+expected.y/scale)*32767),Math.round((before.getZ(i)+expected.z/scale)*32767)]);
    if(Math.hypot(old[0]/32767-after.getX(i),old[1]/32767-after.getY(i),old[2]/32767-after.getZ(i))*scale>1)wrapped++;
    assert.ok(delta.distanceTo(expected)<.0001,`${mesh.name}: vertex ${i} stretched`);
   }
   meshes++;vertices+=before.count;
  }
 });
 assert.equal(meshes,52);assert.ok(vertices>1000);
 assert.ok(wrapped>0,'The map fixture must exercise vertices that previously wrapped');
 scene.traverse(mesh=>{if(mesh.isMesh){mesh.geometry.dispose();for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])m.dispose();}});
});
