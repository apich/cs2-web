import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const root = path.resolve(import.meta.dirname, '..');

test('third-person weapons attach directly into character hands without floating', async () => {
  globalThis.self = globalThis;
  globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1, close: () => {} });

  const loader = new GLTFLoader();
  const phoenixBuf = fs.readFileSync(path.join(root, 'public/assets/characters-cs2/t-phoenix.glb'));
  const animBuf = fs.readFileSync(path.join(root, 'public/assets/characters-cs2/animations.glb'));
  const m4Buf = fs.readFileSync(path.join(root, 'public/assets/weapons/cs2-loadout/m4a1-printstream.glb'));

  const [phoenixGltf, animGltf, m4Gltf] = await Promise.all([
    loader.parseAsync(phoenixBuf.buffer.slice(phoenixBuf.byteOffset, phoenixBuf.byteOffset + phoenixBuf.byteLength), ''),
    loader.parseAsync(animBuf.buffer.slice(animBuf.byteOffset, animBuf.byteOffset + animBuf.byteLength), ''),
    loader.parseAsync(m4Buf.buffer.slice(m4Buf.byteOffset, m4Buf.byteOffset + m4Buf.byteLength), '')
  ]);

  const names = new Set();
  phoenixGltf.scene.traverse(n => names.add(n.name));

  const model = clone(phoenixGltf.scene);
  model.rotation.y = Math.PI;
  const group = new THREE.Group();
  group.add(model);
  const mixer = new THREE.AnimationMixer(model);

  const nativeWeaponAnchor = model.getObjectByName('wpn');
  const nativeAimBone = model.getObjectByName('spine_3');
  const sourceBasisInverse = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(-.5, -.5, -.5, .5)).invert();

  const origClip = animGltf.animations.find(a => a.name === 'rifle/idle');
  const clip = origClip.clone();
  clip.tracks = clip.tracks.filter(t => names.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName));
  mixer.clipAction(clip).play();
  mixer.setTime(0.1);
  group.updateWorldMatrix(true, true);

  const content = clone(m4Gltf.scene);
  const normalization = content.getObjectByName('normalization');
  if (normalization) {
    normalization.matrixAutoUpdate = true;
    normalization.position.set(0, 0, 0);
    normalization.quaternion.identity();
    normalization.scale.set(1, 1, 1);
    normalization.updateMatrix();
  }
  const weaponBone = content.getObjectByName('weapon');
  if (weaponBone) {
    weaponBone.matrixAutoUpdate = true;
    weaponBone.position.set(0, 0, 0);
    weaponBone.quaternion.set(0.5, 0.5, 0.5, -0.5);
    weaponBone.scale.set(1, 1, 1);
    weaponBone.updateMatrix();
  }

  const gun = new THREE.Group();
  group.add(gun);
  gun.add(content);

  const anchor = nativeWeaponAnchor.matrixWorld.clone();
  new THREE.Matrix4().copy(group.matrixWorld).invert().multiply(anchor).multiply(sourceBasisInverse).decompose(gun.position, gun.quaternion, gun.scale);
  gun.updateWorldMatrix(false, true);

  content.updateMatrixWorld(true);
  const mesh = content.getObjectByProperty('isSkinnedMesh', true);
  mesh.skeleton.update();
  const box = new THREE.Box3().setFromObject(mesh);

  const handR = model.getObjectByName('hand_R');
  const hrPos = handR.getWorldPosition(new THREE.Vector3());
  const ag1 = content.getObjectByName('ag1_hand_r');
  const ag1Pos = ag1.getWorldPosition(new THREE.Vector3());

  // Vertical difference between hand_R wrist and weapon grip must be essentially zero (< 1 cm)
  const verticalDiff = Math.abs(ag1Pos.y - hrPos.y);
  assert.ok(verticalDiff < 0.01, `Grip vertical offset ${verticalDiff}m exceeds 1cm`);

  // Mesh bounding box must enclose the hand vertically
  assert.ok(box.min.y <= hrPos.y && hrPos.y <= box.max.y, 'Weapon mesh does not enclose right hand vertically');

  // Grip to wrist distance is bounded (real anatomy: ~10 cm from wrist to palm grip)
  const dist = ag1Pos.distanceTo(hrPos);
  assert.ok(dist >= 0.08 && dist <= 0.12, `Grip distance to wrist ${dist}m outside expected 8-12cm range`);

  // Weapon does not float above hands across pitch angles
  let aimRestQuaternion = null;
  for (const pitch of [-0.6, -0.3, 0, 0.3, 0.6]) {
    if (aimRestQuaternion && nativeAimBone) {
      nativeAimBone.quaternion.copy(aimRestQuaternion);
      aimRestQuaternion = null;
    }
    mixer.setTime(0.1);
    group.updateWorldMatrix(true, true);

    const a = nativeWeaponAnchor.matrixWorld.clone();
    if (nativeAimBone) {
      const pPitch = THREE.MathUtils.clamp(pitch, -1.48, 1.48);
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
      const rotation = new THREE.Quaternion().setFromAxisAngle(axis, pPitch);
      const pivot = nativeAimBone.getWorldPosition(new THREE.Vector3());

      aimRestQuaternion = nativeAimBone.quaternion.clone();
      const world = nativeAimBone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rotation);
      nativeAimBone.quaternion.copy(nativeAimBone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
      nativeAimBone.updateWorldMatrix(false, true);
      const aimMatrix = new THREE.Matrix4().makeTranslation(...pivot).multiply(new THREE.Matrix4().makeRotationFromQuaternion(rotation)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
      a.premultiply(aimMatrix);
    }
    new THREE.Matrix4().copy(group.matrixWorld).invert().multiply(a).multiply(sourceBasisInverse).decompose(gun.position, gun.quaternion, gun.scale);
    gun.updateWorldMatrix(false, true);

    const pHand = handR.getWorldPosition(new THREE.Vector3());
    const pGrip = ag1.getWorldPosition(new THREE.Vector3());
    const d = pGrip.distanceTo(pHand);
    assert.ok(Math.abs(d - dist) < 0.005, `Weapon detached during pitch ${pitch}: distance changed by ${Math.abs(d - dist)}m`);
  }
});
