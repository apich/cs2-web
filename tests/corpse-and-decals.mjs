import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { initPhysics, createPlayerState, stepCorpse, floorHeight, GRAVITY } from '../shared/physics.js';
import { GameRoom } from '../server/game.js';

const plane = (degrees = 0) => {
  const k = Math.tan(degrees * Math.PI / 180), d = 100;
  return [-d, -d * k, -d, d, d * k, d, d, d * k, -d, -d, -d * k, -d, -d, -d * k, d, d, d * k, d];
};

test('stepCorpse simulates airborne dead player falling under gravity and landing on floor', () => {
  initPhysics(plane());
  const p = createPlayerState({ x: 0, y: 3.5, z: 0 });
  p.alive = false;
  p.grounded = false;
  p.vy = 1.0;
  p.vx = 2.0;

  let frames = 0;
  let hitGround = false;
  while (frames < 180) {
    stepCorpse(p, 1 / 60);
    frames++;
    if (p.grounded) {
      hitGround = true;
      break;
    }
  }

  assert.ok(hitGround, 'Corpse must land on floor within 3 seconds');
  assert.equal(p.grounded, true, 'Corpse must be marked grounded upon landing');
  assert.equal(p.vy, 0, 'Vertical velocity must be zeroed when grounded');
  assert.equal(p.vx, 0, 'Horizontal velocity must be zeroed when grounded');
  assert.ok(Math.abs(p.y) < 0.05, `Corpse y (${p.y}) must rest on plane at y=0`);

  // Subsequent steps should keep corpse stationary
  const stationaryY = p.y;
  for (let i = 0; i < 60; i++) stepCorpse(p, 1 / 60);
  assert.equal(p.y, stationaryY, 'Landed corpse must remain stationary');
  assert.equal(p.grounded, true);
});

test('GameRoom continues simulating falling corpse until grounded', () => {
  const bytes = fs.readFileSync('public/assets/map/positions.f32');
  const positions = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  initPhysics(positions);
  let now = 100000;
  const room = new GameRoom('test-corpse-room', { mode: 'defuse', bots: 0, clock: () => now });
  const p = room.addHuman({}, { name: 'TEST_CORPSE', team: 'CT' });
  
  // Place player in the air
  const floor = floorHeight(p.x, p.z, p.y + 10, 50);
  p.y = (floor ?? 0) + 2.5;
  p.grounded = false;
  p.vy = 0;
  
  // Kill player in mid-air
  room.kill(p, null, 'world', false);
  assert.equal(p.alive, false);
  assert.equal(p.grounded, false);
  const initialY = p.y;

  // Step room ticks
  for (let i = 0; i < 15; i++) {
    now += 1000 / 60;
    room.tick(1 / 60);
  }

  assert.ok(p.y < initialY, `Corpse Y (${p.y}) must fall below initial Y (${initialY})`);
  
  // Step until grounded
  for (let i = 0; i < 180; i++) {
    if (p.grounded) break;
    now += 1000 / 60;
    room.tick(1 / 60);
  }

  assert.ok(p.grounded, 'Corpse must land on ground in authoritative GameRoom');
  assert.equal(p.vy, 0, 'Vertical velocity must be zeroed when grounded');
  assert.ok(Number.isFinite(p.y));
});

test('Dust II overlay meshes have correct normal offsets and do not cast shadows', async () => {
  const file = path.resolve('public/assets/map-cs2/dust2-web.gltf');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const b of json.buffers || []) {
    if (b.uri && !b.uri.startsWith('data:')) {
      b.uri = 'data:application/octet-stream;base64,' + fs.readFileSync(path.resolve(path.dirname(file), decodeURIComponent(b.uri))).toString('base64');
    }
  }
  json.materials = (json.materials || []).map(m => ({ name: m.name, doubleSided: true, extras: m.extras }));
  delete json.textures; delete json.images;
  json.extensionsRequired = (json.extensionsRequired || []).filter(e => !e.includes('texture'));
  json.extensionsUsed = (json.extensionsUsed || []).filter(e => !e.includes('texture'));
  globalThis.self = globalThis;
  globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, init) { Object.assign(this, { type }, init); } };

  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(json), '');
  const group = new THREE.Group();
  group.rotation.y = Math.PI / 2;
  group.add(gltf.scene);
  group.updateMatrixWorld(true);

  const overlays = [];
  const insets = [];
  const nonOverlays = [];
  group.traverse(object => {
    if (!object.isMesh) return;
    const isOverlayMesh = /s_mesh_overlay/i.test(object.name);
    const isWindowInsetMesh = /dust_kasbah_window_insets/i.test(object.name) || (Array.isArray(object.material) ? object.material : [object.material]).some(m => /dust_kasbah_window_insets/i.test(m.name || m.userData?.vmat?.Name));
    const isDepthBiasedMesh = isOverlayMesh || isWindowInsetMesh;
    if (isDepthBiasedMesh) {
      object.castShadow = false;
      const pos = object.geometry?.attributes?.position;
      const norm = object.geometry?.attributes?.normal;
      const scale = object.scale?.x || 1.0;
      const localShift = 0.392 / scale;
      if (pos && norm && !object.userData.overlayShifted) {
        object.userData.overlayShifted = true;
        for (let i = 0; i < pos.count; i++) {
          const nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i);
          pos.setXYZ(i, pos.getX(i) - nx * localShift, pos.getY(i) - ny * localShift, pos.getZ(i) - nz * localShift);
        }
        pos.needsUpdate = true;
        object.geometry.computeBoundingBox();
        object.geometry.computeBoundingSphere();
      }
      if (isOverlayMesh) overlays.push(object);
      if (isWindowInsetMesh) insets.push(object);
    } else {
      nonOverlays.push(object);
    }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const shaderFlags = material.userData?.vmat?.IntParams || {};
      if (shaderFlags.F_DO_NOT_CAST_SHADOWS) object.castShadow = false;
      const sourceName = material.userData?.vmat?.Name || material.name;
      if (isDepthBiasedMesh || shaderFlags.F_DEPTH_BIAS || shaderFlags.F_OVERLAY || /overlay|decal|graffiti|poster|striping|window_insets/i.test(sourceName)) {
        object.castShadow = false;
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        material.polygonOffsetUnits = -1;
        if (isOverlayMesh || /overlay|decal|graffiti|poster|striping/i.test(sourceName)) {
          material.transparent = true;
          material.depthWrite = false;
        }
      }
    }
  });

  assert.equal(overlays.length, 38, 'Should find all 38 Dust II overlay meshes');
  for (const o of overlays) {
    assert.equal(o.castShadow, false, `Overlay ${o.name} must not cast shadows`);
    const mat = o.material;
    assert.equal(mat.transparent, true, `Overlay ${o.name} material must be transparent`);
    assert.equal(mat.depthWrite, false, `Overlay ${o.name} material must not write depth`);
    assert.equal(mat.polygonOffset, true, `Overlay ${o.name} material must have polygonOffset`);
  }

  assert.equal(insets.length, 14, 'Should find all 14 Dust II window inset meshes');
  for (const o of insets) {
    assert.equal(o.castShadow, false, `Window inset ${o.name} must not cast shadows`);
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    assert.equal(mat.polygonOffset, true, `Window inset ${o.name} material must have polygonOffset`);
  }

  // Verify snug fit against wall/road
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const v0 = new THREE.Vector3();
  const n0 = new THREE.Vector3();
  let snugCount = 0;
  for (const o of overlays) {
    const pos = o.geometry.attributes.position;
    const norm = o.geometry.attributes.normal;
    v0.fromBufferAttribute(pos, 0).applyMatrix4(o.matrixWorld);
    n0.fromBufferAttribute(norm, 0).transformDirection(o.matrixWorld).normalize();
    ray.set(v0.clone().addScaledVector(n0, 0.05), n0.clone().negate());
    ray.far = 0.2;
    const hits = ray.intersectObjects(nonOverlays, true);
    const d = hits[0] ? hits[0].distance - 0.05 : null;
    if (d !== null && d >= -0.01 && d <= 0.02) snugCount++;
  }
  assert.ok(snugCount >= 34, `Expected at least 34 overlays within 2cm of surface, got ${snugCount}`);

  // Verify Catwalk window insets outer rim is snug against the wall
  const catwalkInset = insets.find(o => o.name === 'n0_lr0_agg_merge_dust_kasbah_window_insets_01_0_2');
  assert.ok(catwalkInset, 'Must find catwalk window inset mesh');
  const pos2 = catwalkInset.geometry.attributes.position;
  const m2 = catwalkInset.matrixWorld;
  const vCheck = new THREE.Vector3();
  let bestRimZ = null;
  let minD = 999;
  for (let i = 0; i < pos2.count; i++) {
    vCheck.fromBufferAttribute(pos2, i).applyMatrix4(m2);
    const dist = Math.hypot(vCheck.x - 3.25, vCheck.y - 2.73);
    if (dist < minD) { minD = dist; bestRimZ = vCheck.z; }
  }
  assert.ok(bestRimZ !== null, 'Found rim vertex');
  // Wall is at z = -39.046; rim must be within 2cm of wall plane (1.6cm relief)
  assert.ok(Math.abs(bestRimZ - (-39.046)) < 0.02, `Catwalk inset rim z (${bestRimZ}) must be flush with wall (-39.046)`);
});
