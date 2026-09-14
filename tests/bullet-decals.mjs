import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Effects, MAX_DECALS, getDecalScale } from '../client/shot-effects.js';

test('bullet decals caliber scaling: AWP > AK47 > P250', () => {
  const awpScale = getDecalScale('awp');
  const akScale = getDecalScale('ak47');
  const m4Scale = getDecalScale('m4a1');
  const deagleScale = getDecalScale('deagle');
  const p250Scale = getDecalScale('p250');

  assert.ok(awpScale > akScale, 'AWP (.338 Lapua) must produce larger decal than AK-47 (7.62mm)');
  assert.ok(akScale > p250Scale, 'AK-47 must produce larger decal than P250 (9mm)');
  assert.ok(deagleScale > p250Scale, 'Desert Eagle (.50 AE) must produce larger decal than P250');
  assert.equal(akScale, m4Scale);
});

test('ShotEffects spawns decals aligned with surface normal and avoids z-fighting', () => {
  const scene = new THREE.Scene();
  const effects = new Effects(scene);

  const hitPoint = new THREE.Vector3(5, 2, 0);
  const normal = new THREE.Vector3(0, 0, 1);

  effects.spawnDecal(hitPoint, normal, 'ak47');

  assert.equal(effects.decals.length, 1);
  const decal = effects.decals[0];

  const expectedPos = hitPoint.clone().addScaledVector(normal, 0.0025);
  assert.ok(Math.abs(decal.mesh.position.x - expectedPos.x) < 1e-4);
  assert.ok(Math.abs(decal.mesh.position.y - expectedPos.y) < 1e-4);
  assert.ok(Math.abs(decal.mesh.position.z - expectedPos.z) < 1e-4);

  assert.equal(decal.mesh.scale.x, getDecalScale('ak47'));
  assert.equal(decal.mesh.scale.y, getDecalScale('ak47'));

  assert.equal(decal.mesh.material.polygonOffset, true);
  assert.equal(decal.mesh.material.polygonOffsetFactor, -1.5);
  assert.equal(decal.mesh.material.polygonOffsetUnits, -3);

  effects.dispose();
});

test('ShotEffects recycles decals when MAX_DECALS is exceeded (ring buffer)', () => {
  const scene = new THREE.Scene();
  const effects = new Effects(scene);

  const normal = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < MAX_DECALS + 25; i++) {
    effects.spawnDecal(new THREE.Vector3(i, 0, 0), normal, 'ak47');
  }

  // Ring buffer caps active decals at MAX_DECALS by recycling the oldest mesh
  assert.equal(effects.decals.length, MAX_DECALS);

  // Clear returns all active decals to the pool
  effects.clear();
  assert.equal(effects.decals.length, 0);
  assert.equal(effects.decalPool.length, MAX_DECALS);

  effects.dispose();
  assert.equal(effects.decals.length, 0);
  assert.equal(effects.decalPool.length, 0);
});

test('ShotEffects spawns ricochet sparks and dust puff on impact', () => {
  const scene = new THREE.Scene();
  const effects = new Effects(scene);

  const hitPoint = new THREE.Vector3(0, 1, 5);
  const normal = new THREE.Vector3(0, 0, -1);
  const incomingDir = new THREE.Vector3(0, 0, 1);

  effects.spawnImpactFX(hitPoint, normal, incomingDir);

  assert.equal(effects.sparks.length, 4);
  assert.equal(effects.dustPuffs.length, 1);

  const initialDustScale = effects.dustPuffs[0].mesh.scale.x;
  effects.update(0.1);

  assert.ok(effects.dustPuffs[0].mesh.scale.x > initialDustScale, 'Dust puff must expand over time');

  effects.update(0.3);
  assert.equal(effects.sparks.length, 0);
  assert.equal(effects.dustPuffs.length, 0);

  effects.dispose();
});

test('ShotEffects shot method properly triggers decal when hitWorld is true', () => {
  const scene = new THREE.Scene();
  const effects = new Effects(scene);

  const origin = { x: 0, y: 1.6, z: 0 };
  const hitWall = { x: 0, y: 1.6, z: 10 };

  effects.shot(origin, hitWall, true, { weapon: 'ak47', hitWorld: true });

  assert.equal(effects.decals.length, 1);
  assert.equal(effects.sparks.length, 4);
  assert.equal(effects.dustPuffs.length, 1);

  effects.dispose();
});
