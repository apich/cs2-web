import assert from 'node:assert/strict';
import test from 'node:test';
import { eyePosition, STANDING_EYE_HEIGHT, CROUCH_EYE_HEIGHT } from '../shared/aim.js';

test('eyePosition backward compatibility with boolean crouch flag', () => {
  const pStand = { x: 0, y: 10, z: 0, crouch: false };
  const pCrouch = { x: 0, y: 10, z: 0, crouch: true };

  assert.equal(eyePosition(pStand).y, 10 + STANDING_EYE_HEIGHT);
  assert.equal(eyePosition(pCrouch).y, 10 + CROUCH_EYE_HEIGHT);
});

test('eyePosition continuous interpolation with duckAmount float', () => {
  const p0 = { x: 5, y: 2, z: -3, duckAmount: 0.0 };
  const pHalf = { x: 5, y: 2, z: -3, duckAmount: 0.5 };
  const p1 = { x: 5, y: 2, z: -3, duckAmount: 1.0 };

  assert.equal(eyePosition(p0).y, 2 + STANDING_EYE_HEIGHT);
  assert.equal(eyePosition(p1).y, 2 + CROUCH_EYE_HEIGHT);

  const expectedMid = 2 + STANDING_EYE_HEIGHT - 0.5 * (STANDING_EYE_HEIGHT - CROUCH_EYE_HEIGHT);
  assert.ok(Math.abs(eyePosition(pHalf).y - expectedMid) < 1e-6);

  // Out of bounds clamp
  assert.equal(eyePosition({ x: 0, y: 0, z: 0, duckAmount: -0.8 }).y, STANDING_EYE_HEIGHT);
  assert.equal(eyePosition({ x: 0, y: 0, z: 0, duckAmount: 2.5 }).y, CROUCH_EYE_HEIGHT);
});

test('CS2 Hermite cubic smoothstep S-curve dynamics', () => {
  const smoothstep = t => t * t * (3 - 2 * t);

  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(0.5), 0.5);

  // Monotonicity check
  let prev = -1;
  for (let t = 0; t <= 1; t += 0.05) {
    const val = smoothstep(t);
    assert.ok(val >= prev);
    prev = val;
  }
});

test('CS2 duck down (0.13s) and duck up (0.17s) timing progression', () => {
  const DUCK_DOWN_RATE = 1.0 / 0.13;
  const DUCK_UP_RATE = 1.0 / 0.17;
  const dt = 1 / 60;

  // Simulate crouching down
  let progress = 0;
  let framesDown = 0;
  while (progress < 1.0) {
    progress = Math.min(1.0, progress + dt * DUCK_DOWN_RATE);
    framesDown++;
  }
  const timeDown = framesDown * dt;
  assert.ok(timeDown >= 0.12 && timeDown <= 0.15, `Down time ${timeDown}s should be ~0.13s`);

  // Simulate standing back up
  let framesUp = 0;
  while (progress > 0.0) {
    progress = Math.max(0.0, progress - dt * DUCK_UP_RATE);
    framesUp++;
  }
  const timeUp = framesUp * dt;
  assert.ok(timeUp >= 0.16 && timeUp <= 0.19, `Up time ${timeUp}s should be ~0.17s`);
});

test('Halfway crouch reversal smoothly transitions without jump or discontinuity', () => {
  const DUCK_DOWN_RATE = 1.0 / 0.13;
  const DUCK_UP_RATE = 1.0 / 0.17;
  const dt = 1 / 60;
  const smoothstep = t => t * t * (3 - 2 * t);

  let progress = 0;
  // Crouch down for 4 frames (~0.066s, halfway down)
  for (let f = 0; f < 4; f++) {
    progress = Math.min(1.0, progress + dt * DUCK_DOWN_RATE);
  }
  const midProgress = progress;
  assert.ok(midProgress > 0.3 && midProgress < 0.8);

  // Player releases crouch key immediately
  const eyeHeights = [];
  for (let f = 0; f < 10; f++) {
    progress = Math.max(0.0, progress - dt * DUCK_UP_RATE);
    const amount = smoothstep(progress);
    const eye = eyePosition({ x: 0, y: 0, z: 0, duckAmount: amount });
    eyeHeights.push(eye.y);
  }

  // Eye height must smoothly rise back to standing height without sudden jumps
  for (let i = 1; i < eyeHeights.length; i++) {
    const diff = eyeHeights[i] - eyeHeights[i - 1];
    assert.ok(diff >= 0, 'Eye height must monotonically rise when releasing crouch');
    assert.ok(diff < 0.2, 'Eye height delta per frame must never jump or pop');
  }
});
