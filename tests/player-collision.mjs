import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import fs from 'node:fs';
import {
  initPhysics,
  createPlayerState,
  stepPlayer,
  PLAYER_BODY_RADIUS,
  STAND_HEIGHT,
  CROUCH_HEIGHT,
  resolvePlayerBodyCollision,
  resolvePlayerAgainstOthers,
  resolveAllPlayerCollisions
} from '../shared/physics.js';
import { simulateMove } from '../shared/movement-commands.js';

const flatFloor = () => {
  const s = 100;
  return [-s, 0, -s, s, 0, s, s, 0, -s, -s, 0, -s, -s, 0, s, s, 0, s];
};

test('Player solid collision blocks two opposing players from walking through each other', () => {
  initPhysics(flatFloor());
  const p1 = createPlayerState({ x: 0, y: 0, z: -2, yaw: 0 });
  const p2 = createPlayerState({ x: 0, y: 0, z: 2, yaw: Math.PI });
  p1.grounded = true;
  p2.grounded = true;

  for (let frame = 0; frame < 90; frame++) {
    stepPlayer(p1, { forward: 1, yaw: 0 }, 1 / 60);
    stepPlayer(p2, { forward: 1, yaw: Math.PI }, 1 / 60);
    resolveAllPlayerCollisions([p1, p2]);
  }

  const dist = Math.hypot(p1.x - p2.x, p1.z - p2.z);
  const minDist = 2 * PLAYER_BODY_RADIUS;
  assert.ok(dist >= minDist - 0.01, `Players must not penetrate: dist (${dist.toFixed(3)}) >= minDist (${minDist})`);
  assert.ok(p1.z < p2.z, 'Player 1 must remain on their side of Player 2 and not pass through');
});

test('Boosting: a player landing on top of another player stands on their head', () => {
  initPhysics(flatFloor());
  const groundPlayer = createPlayerState({ x: 0, y: 0, z: 0 });
  groundPlayer.grounded = true;

  const jumper = createPlayerState({ x: 0, y: STAND_HEIGHT + 0.5, z: 0 });
  jumper.grounded = false;
  jumper.vy = -1.0;

  let landed = false;
  for (let frame = 0; frame < 60; frame++) {
    stepPlayer(jumper, {}, 1 / 60);
    if (resolvePlayerBodyCollision(jumper, groundPlayer)) {
      if (jumper.grounded) {
        landed = true;
        break;
      }
    }
  }

  assert.ok(landed, 'Jumper must land and become grounded on top of groundPlayer');
  assert.ok(Math.abs(jumper.y - STAND_HEIGHT) < 0.05, `Jumper y (${jumper.y}) must rest on head at STAND_HEIGHT (${STAND_HEIGHT})`);
  assert.equal(jumper.vy, 0, 'Vertical fall velocity must be zeroed when landing on head');
});

test('Client prediction simulateMove prevents player from walking into another player', () => {
  initPhysics(flatFloor());
  const localPlayer = createPlayerState({ x: 0, y: 0, z: -1, yaw: 0 });
  localPlayer.grounded = true;
  const teammate = createPlayerState({ x: 0, y: 0, z: 0 });
  teammate.grounded = true;

  for (let frame = 0; frame < 60; frame++) {
    simulateMove(localPlayer, { forward: 1, yaw: 0, speedScale: 1 }, { canMove: true, otherPlayers: [teammate] });
  }

  const dist = Math.hypot(localPlayer.x - teammate.x, localPlayer.z - teammate.z);
  const minDist = 2 * PLAYER_BODY_RADIUS;
  assert.ok(dist >= minDist - 0.01, `Local player predicted distance (${dist.toFixed(3)}) must respect body radius`);
  assert.ok(localPlayer.z <= teammate.z - minDist + 0.01, 'Local player cannot penetrate teammate forward');
});

test('Multiple players clustered in a group resolve without NaN or explosion', () => {
  initPhysics(flatFloor());
  const players = [];
  for (let i = 0; i < 5; i++) {
    const p = createPlayerState({ x: (i - 2) * 0.1, y: 0, z: 0 });
    p.grounded = true;
    players.push(p);
  }

  for (let frame = 0; frame < 30; frame++) {
    resolveAllPlayerCollisions(players);
  }

  for (let i = 0; i < players.length; i++) {
    assert.ok(Number.isFinite(players[i].x) && Number.isFinite(players[i].z), 'Positions must remain finite');
    for (let j = i + 1; j < players.length; j++) {
      const d = Math.hypot(players[i].x - players[j].x, players[i].z - players[j].z);
      assert.ok(d >= 2 * PLAYER_BODY_RADIUS - 0.02, `Pair (${i}, ${j}) separated: dist=${d.toFixed(3)}`);
    }
  }
});

test('Death animation relaxes right arm and limbs into natural ground rest pose', async () => {
  globalThis.self = globalThis;
  const animBuf = fs.readFileSync('public/assets/characters-cs2/animations.glb');
  const modelBuf = fs.readFileSync('public/assets/characters-cs2/t-phoenix.glb');

  const loader = new GLTFLoader();
  const animGltf = await loader.parseAsync(animBuf.buffer.slice(animBuf.byteOffset, animBuf.byteOffset + animBuf.byteLength), '');
  const modelGltf = await loader.parseAsync(modelBuf.buffer.slice(modelBuf.byteOffset, modelBuf.byteOffset + modelBuf.byteLength), '');

  const names = new Set();
  modelGltf.scene.traverse(n => names.add(n.name));
  const animations = animGltf.animations.map(original => {
    const clip = original.clone();
    clip.tracks = clip.tracks.filter(t => names.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName));
    clip.duration = Math.max(0.1, clip.duration);
    return clip;
  });

  const death = animations.find(a => a.name === 'death');
  const targetArmR = new THREE.Quaternion(0.3176, 0.0220, 0.1553, -0.9352).normalize();
  const targetElbowR = new THREE.Quaternion(0, 0, 0.3502, 0.9367).normalize();
  const targetThighL = new THREE.Quaternion(0.4259, -0.2517, 0.8285, -0.2624).normalize();
  const targetHead = new THREE.Quaternion(0.015, 0.06, 0.08, 0.996).normalize();

  function blendTrack(trackName, targetQ, startTime = 1.4, endTime = 2.4) {
    const track = death.tracks.find(t => t.name === trackName);
    if (!track) return;
    const q = new THREE.Quaternion();
    for (let i = 0; i < track.times.length; i++) {
      const time = track.times[i];
      if (time >= startTime) {
        const factor = Math.min(1, Math.max(0, (time - startTime) / (endTime - startTime)));
        const smooth = factor * factor * (3 - 2 * factor);
        q.fromArray(track.values, i * 4);
        q.slerp(targetQ, smooth);
        q.toArray(track.values, i * 4);
      }
    }
  }

  blendTrack('arm_upper_R.quaternion', targetArmR);
  blendTrack('arm_lower_R.quaternion', targetElbowR);
  blendTrack('leg_upper_L.quaternion', targetThighL);
  blendTrack('head_0.quaternion', targetHead);

  const model = modelGltf.scene;
  model.rotation.y = Math.PI;
  const group = new THREE.Group();
  group.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(death);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  mixer.setTime(2.49);
  group.updateMatrixWorld(true);

  const elbowR = model.getObjectByName('arm_lower_R').getWorldPosition(new THREE.Vector3());
  const handR = model.getObjectByName('hand_R').getWorldPosition(new THREE.Vector3());

  assert.ok(elbowR.y < 0.25, `Right elbow resting height (${elbowR.y.toFixed(3)}) must be near ground (< 0.25m)`);
  assert.ok(handR.y < 0.25, `Right hand resting height (${handR.y.toFixed(3)}) must be near ground (< 0.25m)`);
});
