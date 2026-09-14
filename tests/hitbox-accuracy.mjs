import test from 'node:test';
import assert from 'node:assert/strict';
import { shotRng, accuracyForShot } from '../shared/aim.js';
import { WEAPONS } from '../shared/weapons.js';
import { rayHitPlayer } from '../server/game.js';

test('shotRng generates deterministic, uniform pseudo-random floats for synced client-server ballistics', () => {
  const rng1 = shotRng(105, 0);
  const rng2 = shotRng(105, 0);
  assert.equal(rng1(), rng2(), 'Same shotId and pellet must yield identical RNG value');

  const diffRng = shotRng(106, 0);
  assert.notEqual(rng1(), diffRng(), 'Different shotIds must yield different RNG values');

  const pellet0 = shotRng(105, 0)();
  const pellet1 = shotRng(105, 1)();
  assert.notEqual(pellet0, pellet1, 'Different pellet indices must yield different RNG values');

  const sampleRng = shotRng(999);
  for (let i = 0; i < 50; i++) {
    const val = sampleRng();
    assert.ok(val >= 0 && val < 1, `RNG value ${val} must be in [0, 1)`);
  }
});

test('moving accuracy decay curve uses cubic falloff for crisp counter-strafing', () => {
  const ak = WEAPONS.ak47;
  const standPlayer = { vx: 0, vz: 0, grounded: true, crouch: false };
  const fullRunPlayer = { vx: ak.maxSpeed, vz: 0, grounded: true, crouch: false };
  const halfRunPlayer = { vx: ak.maxSpeed * 0.5, vz: 0, grounded: true, crouch: false };

  const standAcc = accuracyForShot(ak, standPlayer);
  const fullRunAcc = accuracyForShot(ak, fullRunPlayer);
  const halfRunAcc = accuracyForShot(ak, halfRunPlayer);

  assert.ok(fullRunAcc.inaccuracy > standAcc.inaccuracy, 'Full run spread should be significantly greater than standing spread');
  
  // At 50% velocity, moving fraction is (0.5 - 0.34) / (0.95 - 0.34) = 0.2623.
  // Cubic falloff yields 0.2623^3 = 0.0180 (under 2% penalty, restoring over 98% precision).
  const totalSpreadAdded = fullRunAcc.inaccuracy - standAcc.inaccuracy;
  const halfSpreadAdded = halfRunAcc.inaccuracy - standAcc.inaccuracy;
  const ratio = halfSpreadAdded / totalSpreadAdded;
  assert.ok(ratio < 0.03, `At 50% counter-strafe speed, penalty ratio (${ratio.toFixed(4)}) must be under 3%`);
});

function normalize(v) {
  const len = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

test('rayHitPlayer reliably detects hits across all visual model zones and accurately flags headshots', () => {
  const target = {
    x: 0, y: 0, z: 10,
    yaw: 0,
    alive: true,
    crouch: false
  };

  const origin = { x: 0, y: 1.6, z: 0 };

  // 1. Head shot at eye/forehead level (z=10, y=1.68)
  const headDir = normalize({ x: 0, y: 1.68 - origin.y, z: 10 });
  const headHit = rayHitPlayer(origin, headDir, target);
  assert.ok(headHit, 'Ray directed at head must hit');
  assert.equal(headHit.headshot, true, 'Hit on head center must be flagged as headshot');

  // 2. Chest center shot (z=10, y=1.2)
  const chestDir = normalize({ x: 0, y: 1.2 - origin.y, z: 10 });
  const chestHit = rayHitPlayer(origin, chestDir, target);
  assert.ok(chestHit, 'Ray directed at chest must hit');
  assert.equal(chestHit.headshot, false, 'Chest hit must not be flagged as headshot');

  // 3. Shoulder/arm shot (z=10, x=0.32, y=1.3) - covered by 0.38m upper body box
  const shoulderDir = normalize({ x: 0.32, y: 1.3 - origin.y, z: 10 });
  const shoulderHit = rayHitPlayer(origin, shoulderDir, target);
  assert.ok(shoulderHit, 'Ray directed at shoulder/arm silhouette must hit');

  // 4. Lower leg shot (z=10, x=0.15, y=0.4)
  const legDir = normalize({ x: 0.15, y: 0.4 - origin.y, z: 10 });
  const legHit = rayHitPlayer(origin, legDir, target);
  assert.ok(legHit, 'Ray directed at leg must hit');

  // 5. Miss: far to the side (z=10, x=1.5, y=1.2)
  const missDir = normalize({ x: 1.5, y: 1.2 - origin.y, z: 10 });
  const missHit = rayHitPlayer(origin, missDir, target);
  assert.equal(missHit, null, 'Ray shooting wide must not hit');

  // 6. Miss: behind shooter (z = -1)
  const backDir = { x: 0, y: 0, z: -1 };
  const backHit = rayHitPlayer(origin, backDir, target);
  assert.equal(backHit, null, 'Ray shooting backwards must not hit target in front');
});

test('rayHitPlayer respects player rotation and hitboxes yaw orientation', () => {
  // Target rotated 90 degrees: facing positive X axis
  const target = {
    x: 0, y: 0, z: 10,
    yaw: Math.PI / 2,
    alive: true,
    crouch: false
  };

  const origin = { x: 0, y: 1.6, z: 0 };
  const chestDir = normalize({ x: 0, y: 1.2 - origin.y, z: 10 });
  const hit = rayHitPlayer(origin, chestDir, target);
  assert.ok(hit, 'Facing profile at 90 deg yaw must be hit accurately');
  assert.equal(hit.headshot, false);
});
