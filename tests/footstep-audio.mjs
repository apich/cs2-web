import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FootstepAudioSystem,
  CS2_STEP_INTERVAL,
  CS2_MAX_AUDIBLE_DISTANCE,
  CS2_RUN_SPEED_THRESHOLD,
  CS2_HARD_LAND_VELOCITY,
  CS2_SOFT_LAND_VELOCITY,
} from '../client/footstep-system.js';
import { initPhysics, getGroundMaterial } from '../shared/physics.js';
import fs from 'node:fs';

// Mock Audio
class MockAudio {
  constructor() {
    this.calls = [];
  }
  footstep(args) {
    this.calls.push({ type: 'footstep', ...args });
    return {};
  }
  land(args) {
    this.calls.push({ type: 'land', ...args });
    return {};
  }
  jump(args) {
    this.calls.push({ type: 'jump', ...args });
    return {};
  }
  clear() {
    this.calls.length = 0;
  }
}

test('CS2 Stealth: crouching and shift-walking are 100% silent', () => {
  const audio = new MockAudio();
  const system = new FootstepAudioSystem(audio);

  const self = {
    alive: true,
    grounded: true,
    vx: 5.0,
    vz: 0,
    x: 0,
    y: 0,
    z: 0,
    stepDistance: 0,
    crouch: false,
    walk: false,
  };

  // 1. Crouch-walking: must produce 0 footsteps
  self.crouch = true;
  self.walk = false;
  for (let i = 0; i < 20; i++) {
    self.stepDistance += 0.5; // Walked 10 meters crouching
    system.update(1 / 60, self, [], { position: { x: 0, y: 1.6, z: 0 } }, 0);
  }
  assert.equal(audio.calls.length, 0, 'Crouch walking must be 100% silent in CS2');

  // 2. Shift-walking: must produce 0 footsteps
  self.crouch = false;
  self.walk = true;
  for (let i = 0; i < 20; i++) {
    self.stepDistance += 0.5; // Walked 10 meters shift-walking
    system.update(1 / 60, self, [], { position: { x: 0, y: 1.6, z: 0 } }, 0);
  }
  assert.equal(audio.calls.length, 0, 'Shift walking must be 100% silent in CS2');

  // 3. Low speed (< 2.5 m/s): must produce 0 footsteps
  self.crouch = false;
  self.walk = false;
  self.vx = 1.2;
  self.vz = 0;
  for (let i = 0; i < 20; i++) {
    self.stepDistance += 0.5;
    system.update(1 / 60, self, [], { position: { x: 0, y: 1.6, z: 0 } }, 0);
  }
  assert.equal(audio.calls.length, 0, 'Slow movement below running threshold must be silent');
});

test('CS2 Cadence: running triggers footsteps at ~1.85m intervals with alternating left/right feet', () => {
  const audio = new MockAudio();
  const system = new FootstepAudioSystem(audio);

  const self = {
    alive: true,
    grounded: true,
    vx: 5.5,
    vz: 0,
    x: 0,
    y: 0,
    z: 0,
    stepDistance: 0,
    crouch: false,
    walk: false,
  };

  // Run 10 meters: at 1.85m interval, should trigger ~5 steps
  for (let i = 0; i < 50; i++) {
    self.stepDistance += 0.2;
    system.update(1 / 60, self, [], { position: { x: 0, y: 1.6, z: 0 } }, 0);
  }

  const footsteps = audio.calls.filter(c => c.type === 'footstep');
  assert.equal(footsteps.length, 5, `Expected 5 footsteps in 10m run at 1.85m interval, got ${footsteps.length}`);

  // Verify alternating feet
  assert.equal(footsteps[0].isLeft, true);
  assert.equal(footsteps[1].isLeft, false);
  assert.equal(footsteps[2].isLeft, true);
  assert.equal(footsteps[3].isLeft, false);
  assert.equal(footsteps[4].isLeft, true);
  assert.equal(footsteps[0].distance, 0, 'Local player footstep distance must be 0');
});

test('CS2 Jump Takeoff & Landing: soft vs hard landing impact sounds', () => {
  const audio = new MockAudio();
  const system = new FootstepAudioSystem(audio);

  const self = {
    alive: true,
    grounded: true,
    vx: 0,
    vz: 0,
    vy: 0,
    x: 0,
    y: 0,
    z: 0,
    stepDistance: 0,
    crouch: false,
    walk: false,
  };

  // Initial grounded frame
  system.update(1 / 60, self, [], { position: { x: 0, y: 1.6, z: 0 } }, 0);
  audio.clear();

  // Jump takeoff: grounded transitions from true to false with positive vy
  self.grounded = false;
  self.vy = 4.8;
  system.update(1 / 60, self, [], { position: { x: 0, y: 1.6, z: 0 } }, 0);

  const jumps = audio.calls.filter(c => c.type === 'jump');
  assert.equal(jumps.length, 1, 'Jump takeoff must trigger jump sound');
  audio.clear();

  // In air: descending with vy = -3.2 (soft landing velocity)
  self.vy = -3.2;
  system.update(1 / 60, self, [], { position: { x: 0, y: 1.6, z: 0 } }, 0);
  assert.equal(audio.calls.length, 0, 'No sound while in mid-air');

  // Touches ground: soft landing
  self.grounded = true;
  self.vy = 0;
  system.update(1 / 60, self, [], { position: { x: 0, y: 1.6, z: 0 } }, 0);

  let lands = audio.calls.filter(c => c.type === 'land');
  assert.equal(lands.length, 1, 'Landing must trigger land sound');
  assert.equal(lands[0].hard, false, 'Velocity -3.2 must be soft landing');
  audio.clear();

  // High fall: descending with vy = -6.5 (hard landing velocity < -5.2)
  self.grounded = false;
  self.vy = -6.5;
  system.update(1 / 60, self, [], { position: { x: 0, y: 1.6, z: 0 } }, 0);
  self.grounded = true;
  self.vy = 0;
  system.update(1 / 60, self, [], { position: { x: 0, y: 1.6, z: 0 } }, 0);

  lands = audio.calls.filter(c => c.type === 'land');
  assert.equal(lands.length, 1, 'Hard landing must trigger land sound');
  assert.equal(lands[0].hard, true, 'Velocity -6.5 must trigger hard landing thud');
});

test('CS2 Remote Player 3D Spatial Audio: hearing enemy/teammate footsteps with distance & stereo pan', () => {
  const audio = new MockAudio();
  const system = new FootstepAudioSystem(audio);

  const camera = { position: { x: 0, y: 1.6, z: 0 } };
  const listenerYaw = 0; // Camera facing North (-Z)

  // Remote player running to the right (x: +10, z: 0)
  const remoteEnemy = {
    id: 'enemy_1',
    alive: true,
    grounded: true,
    crouch: false,
    walk: false,
    x: 10,
    y: 0,
    z: 0,
    vy: 0,
  };

  // Frame 1: register initial position
  system.update(1 / 60, null, [remoteEnemy], camera, listenerYaw);
  assert.equal(audio.calls.length, 0);

  // Run for 2.0 meters along Z (speed ~5.0 m/s)
  remoteEnemy.z += 2.0;
  system.update(0.4, null, [remoteEnemy], camera, listenerYaw);

  const steps = audio.calls.filter(c => c.type === 'footstep');
  assert.equal(steps.length, 1, 'Remote player running should trigger 3D footstep');
  assert.ok(steps[0].distance >= 10 && steps[0].distance <= 11, `Expected distance ~10m, got ${steps[0].distance}`);
  assert.ok(steps[0].pan > 0.5, `Enemy at x=+10 should be panned heavily right (> 0.5), got ${steps[0].pan}`);
  audio.clear();

  // Remote player running to the left (x: -10, z: 0)
  const remoteLeft = {
    id: 'enemy_2',
    alive: true,
    grounded: true,
    crouch: false,
    walk: false,
    x: -10,
    y: 0,
    z: 0,
    vy: 0,
  };
  system.update(1 / 60, null, [remoteLeft], camera, listenerYaw);
  remoteLeft.z += 2.0;
  system.update(0.4, null, [remoteLeft], camera, listenerYaw);

  const leftSteps = audio.calls.filter(c => c.type === 'footstep');
  assert.equal(leftSteps.length, 1);
  assert.ok(leftSteps[0].pan < -0.5, `Enemy at x=-10 should be panned heavily left (< -0.5), got ${leftSteps[0].pan}`);
  audio.clear();

  // Remote player outside CS2 audible range (35 meters away)
  const remoteFar = {
    id: 'enemy_3',
    alive: true,
    grounded: true,
    crouch: false,
    walk: false,
    x: 0,
    y: 0,
    z: -35,
    vy: 0,
  };
  system.update(1 / 60, null, [remoteFar], camera, listenerYaw);
  remoteFar.z -= 2.0;
  system.update(0.4, null, [remoteFar], camera, listenerYaw);

  assert.equal(audio.calls.length, 0, 'Enemy beyond 25m must be inaudible');
});

test('CS2 Ground Material Awareness: detects sand in Pit, wood, metal, and concrete', () => {
  const raw = fs.readFileSync('dist/assets/map/positions.f32');
  const positions = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const materials = fs.readFileSync('dist/assets/map/penetration-materials.u8');
  initPhysics(positions, materials);

  // Pit area
  const pitMaterial = getGroundMaterial(35.14, -4.4, -6.32);
  assert.equal(pitMaterial, 'sand', 'Dust 2 Pit ground must be detected as sand');

  // Spawn road
  const ctMaterial = getGroundMaterial(8.08, -2.77, -57.15);
  assert.equal(ctMaterial, 'concrete', 'CT spawn pavement must be detected as concrete');

  const tMaterial = getGroundMaterial(-18.69, 3.5, 23.16);
  assert.equal(tMaterial, 'concrete', 'T spawn ground must be detected as concrete');
});
