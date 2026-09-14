import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initPhysics,
  createPlayerState,
  stepPlayer,
  SV_FRICTION,
  SV_STOPSPEED,
  SV_ACCELERATE,
  SV_AIRACCELERATE,
  SV_AIR_WISHSPEED_CAP
} from '../shared/physics.js';

function plane() {
  const d = 100;
  return [-d, 0, -d, d, 0, d, d, 0, -d, -d, 0, -d, -d, 0, d, d, 0, d];
}

function settle(dt = 1 / 60) {
  const p = createPlayerState();
  for (let i = 0; i < 60; i++) stepPlayer(p, {}, dt);
  assert.ok(p.grounded, 'Fixture has a walkable floor');
  return p;
}

test('Source engine physics constants are correctly calibrated', () => {
  assert.equal(SV_FRICTION, 5.2);
  assert.equal(SV_STOPSPEED, 100 * 0.0254);
  assert.equal(SV_ACCELERATE, 5.5);
  assert.equal(SV_AIRACCELERATE, 12.0);
  assert.equal(SV_AIR_WISHSPEED_CAP, 30 * 0.0254);
});

test('Counter-strafing decelerates player to stop twice as fast as releasing movement keys', () => {
  initPhysics(plane());
  
  const playerFriction = settle();
  for (let i = 0; i < 40; i++) {
    stepPlayer(playerFriction, { right: 1 }, 1 / 60);
  }
  assert.ok(playerFriction.vx > 5.95, `Expected max speed near 6.0, got ${playerFriction.vx}`);

  const playerCounter = { ...playerFriction };

  let frictionFrames = 0;
  while (playerFriction.vx > 0.05 && frictionFrames < 100) {
    stepPlayer(playerFriction, {}, 1 / 60);
    frictionFrames++;
  }

  let counterFrames = 0;
  while (playerCounter.vx > 0.05 && counterFrames < 100) {
    stepPlayer(playerCounter, { right: -1 }, 1 / 60);
    counterFrames++;
  }

  console.log(`Stop frames: friction-only = ${frictionFrames} (${(frictionFrames * 1000 / 60).toFixed(1)}ms), counter-strafe = ${counterFrames} (${(counterFrames * 1000 / 60).toFixed(1)}ms)`);
  
  assert.ok(counterFrames < frictionFrames, 'Counter-strafe should be faster than friction');
  assert.ok(counterFrames <= 8, `Counter-strafe should stop within 8 frames (~133ms), took ${counterFrames}`);
  assert.ok(frictionFrames >= 12, `Friction stop takes at least 12 frames (~200ms), took ${frictionFrames}`);
});

test('Air-strafing allows steering and gaining speed in flight via PM_AirAccelerate', () => {
  initPhysics(plane());

  const p = createPlayerState({ y: 50.0 });
  p.grounded = false;
  p.vz = -6.0;
  p.vx = 0.0;
  p.yaw = 0.0;

  for (let i = 0; i < 30; i++) {
    stepPlayer(p, { forward: 1 }, 1 / 60);
  }
  const speedHoldingW = Math.hypot(p.vx, p.vz);
  assert.ok(speedHoldingW <= 6.0001, `Holding W in air should not increase speed: ${speedHoldingW}`);

  const strafePlayer = createPlayerState({ y: 50.0 });
  strafePlayer.grounded = false;
  strafePlayer.vz = -6.0;
  strafePlayer.vx = 0.0;
  strafePlayer.yaw = 0.0;

  const initialSpeed = Math.hypot(strafePlayer.vx, strafePlayer.vz);
  const yawTurnPerFrame = 0.045;

  for (let frame = 0; frame < 40; frame++) {
    strafePlayer.yaw += yawTurnPerFrame;
    stepPlayer(strafePlayer, { right: -1, yaw: strafePlayer.yaw }, 1 / 60);
  }

  const finalSpeed = Math.hypot(strafePlayer.vx, strafePlayer.vz);
  console.log(`Air strafe: initial speed = ${initialSpeed.toFixed(3)} m/s, final speed = ${finalSpeed.toFixed(3)} m/s (+${((finalSpeed - initialSpeed) / initialSpeed * 100).toFixed(1)}%)`);

  assert.ok(finalSpeed > initialSpeed, `Air strafe should gain speed: ${finalSpeed} > ${initialSpeed}`);
  assert.ok(Math.abs(strafePlayer.vx) > 1.0, `Air strafe should steer trajectory horizontally: vx = ${strafePlayer.vx}`);
});

test('Bhop takeoff skips ground friction preserving horizontal velocity', () => {
  initPhysics(plane());
  const p = settle();
  p.vx = 6.0;
  p.vz = 0.0;

  stepPlayer(p, { jump: true }, 1 / 60);

  assert.ok(p.vx >= 5.99, `Takeoff tick must conserve horizontal speed: vx = ${p.vx}`);
  assert.ok(!p.grounded, 'Player must be airborne on jump');
});
