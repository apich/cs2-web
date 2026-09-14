import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../server/game.js';
import { initPhysics } from '../shared/physics.js';
import {
  RECOIL_SCALE,
  VIEW_RECOIL_TRACKING,
  RECOIL_DECAY_THRESHOLD,
  getRecoilParams,
  getRecoilTable,
  getRecoilData,
  getRecoveryTime,
  getInaccuracyFire,
  createRecoilState,
  applyRecoilKick,
  decayRecoilState,
  decayRecoilIndex,
  decayAccuracyPenalty,
  bulletFireAngles,
  accuracyForShot,
  sampleShotDirection
} from '../shared/aim.js';

initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const TICK = 1 / 64;

// Simulates a full spray the way the engine does at 64 tick: float next-attack
// times (interval * n) are reached on the first following tick, so shots land on
// a 6/7-tick alternation for a 0.1s cycle. Each shot reads the current aim punch
// (bullet = punch * RECOIL_SCALE), kicks, then decays per tick.
function simulateSpray(weaponId, shots, interval) {
  const state = createRecoilState();
  const bullets = [];
  let nextShot = 0, lastShot = -1;
  for (let tick = 0; tick < 64 * 60 && bullets.length < shots; tick++) {
    const now = tick * TICK;
    if (now >= nextShot) {
      bullets.push({ pitch: state.pitch * RECOIL_SCALE * RAD2DEG, yaw: state.yaw * RECOIL_SCALE * RAD2DEG });
      applyRecoilKick(state, weaponId);
      lastShot = now;
      nextShot = now + interval;
    }
    if (now > lastShot + interval * RECOIL_DECAY_THRESHOLD) decayRecoilIndex(state, TICK);
    decayRecoilState(state, TICK);
  }
  return bullets;
}

test('AK-47 table generation matches official algorithm (seed 223, suppression, magnitude ramp)', () => {
  const table = getRecoilTable('ak47');
  assert.equal(table.length, 2, 'one table per weapon mode');
  const rows = table[0];
  assert.equal(rows.length, 64, '64-entry recoil table');

  // AK has zero magnitude variance: suppression lerp determines the first 4 entries.
  assert.ok(Math.abs(rows[0].magnitude * RAD2DEG - 22.5) < 1e-6, 'shot 1 suppressed to 0.75x (22.5 deg)');
  assert.ok(Math.abs(rows[1].magnitude * RAD2DEG - 21.6328) < 1e-3, 'shot 2 suppression lerp');
  for (let i = 3; i < 12; i++) {
    assert.ok(rows[i + 1].magnitude > rows[i].magnitude, `magnitude ramps up through the variance lerp (entry ${i + 1})`);
  }
  for (let i = 12; i < 64; i++) {
    assert.ok(Math.abs(rows[i].magnitude * RAD2DEG - 30) < 0.05, `entry ${i} magnitude converged to 30 deg`);
  }
});

test('AK-47 spray climbs, hooks right at bullets 10-15, swings left at 19-27 (verified against real CS2 compensation data)', () => {
  const spray = simulateSpray('ak47', 30, 0.1);

  assert.equal(spray[0].pitch, 0, 'bullet 1 dead center in pitch');
  assert.equal(spray[0].yaw, 0, 'bullet 1 dead center in yaw');

  for (let i = 1; i < 8; i++) {
    assert.ok(spray[i].pitch > spray[i - 1].pitch, `bullet ${i + 1} must keep climbing (${spray[i].pitch.toFixed(2)} > ${spray[i - 1].pitch.toFixed(2)})`);
    assert.ok(Math.abs(spray[i].yaw) < 2.0, `bullet ${i + 1} horizontal drift stays small during initial climb`);
  }

  // Mid-spray rightward hook: bullets 10-15 right of center, peak >= 3.5 deg
  for (let i = 9; i <= 14; i++) {
    assert.ok(spray[i].yaw < -1.0, `bullet ${i + 1} must be right of center (${spray[i].yaw.toFixed(2)} deg)`);
  }
  const peakRight = Math.min(...spray.slice(9, 16).map(b => b.yaw));
  assert.ok(peakRight <= -3.5 && peakRight >= -5.5, `right hook peaks around -4.6 deg (got ${peakRight.toFixed(2)})`);

  // Late-mid spray crosses to the left: bullets 19-27
  const leftPhase = spray.slice(18, 27).filter(b => b.yaw > 0.5).length;
  assert.ok(leftPhase >= 7, `bullets 19-27 must sit left of center (${leftPhase}/9 left)`);

  // Tail swings back right
  assert.ok(spray[29].yaw < -2.0, 'bullet 30 back right of center');

  // Vertical plateau ~10 deg
  const maxPitch = Math.max(...spray.map(b => b.pitch));
  assert.ok(maxPitch >= 9.5 && maxPitch <= 11, `AK-47 max climb (${maxPitch.toFixed(2)} deg) matches CS2 ~10 deg`);
});

test('M4A1-S (silenced mode) has lower recoil than M4A4 and AK-47', () => {
  const params = getRecoilParams('m4a1');
  assert.equal(params.recoilMode, 1, 'M4A1-S uses the silenced recoil mode');
  assert.ok(Math.abs(getRecoilTable('m4a1')[1][10].magnitude * RAD2DEG - 21) < 0.2, 'M4A1-S magnitude converges to 21 deg');

  const akMax = Math.max(...simulateSpray('ak47', 20, 0.1).map(b => b.pitch));
  const m4a4Max = Math.max(...simulateSpray('m4a4', 20, 0.1).map(b => b.pitch));
  const m4a1Max = Math.max(...simulateSpray('m4a1', 20, 0.1).map(b => b.pitch));
  assert.ok(m4a1Max < m4a4Max, `M4A1-S climb (${m4a1Max.toFixed(2)}) below M4A4 (${m4a4Max.toFixed(2)})`);
  assert.ok(m4a4Max < akMax, `M4A4 climb (${m4a4Max.toFixed(2)}) below AK-47 (${akMax.toFixed(2)})`);
});

test('Hybrid decay (exp 8 + linear 18 deg/s) shrinks punch to zero; velocity integrates then decays at 4.5/s', () => {
  const state = { ...createRecoilState(), pitch: 0.1, yaw: 0.05 };
  decayRecoilState(state, 0.15);
  assert.ok(state.pitch > 0 && state.pitch < 0.1, 'punch partially decays');
  decayRecoilState(state, 2);
  assert.equal(state.pitch, 0, 'punch fully zeroed after long idle');
  assert.equal(state.yaw, 0, 'yaw fully zeroed after long idle');

  const kicked = createRecoilState();
  applyRecoilKick(kicked, 'ak47');
  assert.ok(kicked.velPitch > 0, 'kick adds upward velocity, not instant angle');
  assert.equal(kicked.pitch, 0, 'angle unchanged before decay integration');
  decayRecoilState(kicked, TICK);
  assert.ok(kicked.pitch > 0, 'velocity integrates into angle over ticks');
});

test('Recoil index holds during full-auto, decays exponentially past 1.10 cycle threshold', () => {
  const state = createRecoilState();
  state.index = 10;
  decayRecoilIndex(state, 0);
  assert.equal(state.index, 10, 'no decay before the threshold');

  decayRecoilIndex(state, 0.34);
  assert.ok(Math.abs(state.index - 10 * Math.exp(-Math.LN10 * 2.0 * 0.34)) < 1e-9, 'index decays at ln(10)*2.0 per second');

  decayRecoilIndex(state, 2);
  assert.equal(state.index, 0, 'index clamps to zero after long idle');
});

test('Recovery time follows stance and recoil-index transition bullets', () => {
  assert.equal(getRecoveryTime('ak47', { crouch: false, recoilIndex: 0 }), 0.368, 'stand base recovery');
  assert.equal(getRecoveryTime('ak47', { crouch: true, recoilIndex: 0 }), 0.305257, 'crouch base recovery');
  assert.ok(Math.abs(getRecoveryTime('ak47', { crouch: false, recoilIndex: 5 }) - 0.506) < 1e-9, 'stand final at transition end');
  assert.ok(Math.abs(getRecoveryTime('ak47', { crouch: false, recoilIndex: 3 }) - (0.368 + (0.506 - 0.368) / 3)) < 1e-9, 'mid-transition remap');
  assert.ok(Math.abs(getRecoveryTime('ak47', { inAir: true }) - 0.305257 * 4) < 1e-9, 'in-air recovery is 4x crouch');
});

test('Accuracy penalty accumulates per shot and decays exponentially with recovery time', () => {
  const ak = getRecoilData('ak47');
  assert.equal(ak.inaccuracyFire, 0.0078, 'AK-47 official inaccuracyFire');
  assert.equal(getInaccuracyFire('ak47'), 0.0078);

  let penalty = 0;
  for (let i = 0; i < 3; i++) penalty += getInaccuracyFire('ak47');
  assert.ok(Math.abs(penalty - 0.0234) < 1e-9, 'three shots accumulate linearly');

  const halfStand = decayAccuracyPenalty(penalty, ak.recoveryTimeStand * 0.5, ak.recoveryTimeStand);
  assert.ok(halfStand < penalty && halfStand > 0, 'penalty partially decays');

  const halfCrouch = decayAccuracyPenalty(penalty, 0.15, ak.recoveryTimeCrouch);
  assert.ok(halfCrouch < decayAccuracyPenalty(penalty, 0.15, ak.recoveryTimeStand), 'crouch recovery decays faster than standing over the same elapsed time');

  assert.equal(decayAccuracyPenalty(penalty, ak.recoveryTimeStand * 5, ak.recoveryTimeStand), 0, 'penalty fully clears');
});

test('Follow-recoil crosshair projection matches bullet offset relative to camera', () => {
  const fovY = 73.74, width = 1920, height = 1080;
  const vertFovRad = fovY * DEG2RAD;
  const horizFovRad = 2 * Math.atan(Math.tan(vertFovRad / 2) * (width / height));
  const crosshairScale = RECOIL_SCALE * (1 - VIEW_RECOIL_TRACKING);
  assert.ok(Math.abs(crosshairScale - 1.1) < 1e-9, 'bullet-camera delta is aimPunch * 2.0 * (1 - 0.45)');

  // Upward kick: bullet above camera center -> crosshair marginTop negative (moves up)
  const deltaPitch = 0.05 * crosshairScale;
  const recoilY = -Math.tan(deltaPitch) / Math.tan(vertFovRad / 2) * (height / 2);
  assert.ok(recoilY < 0, 'upward recoil moves crosshair up');

  // Leftward kick (positive yaw): bullet left of camera center -> crosshair marginLeft negative
  const deltaYaw = 0.03 * crosshairScale;
  const recoilX = -Math.tan(deltaYaw) / Math.tan(horizFovRad / 2) * (width / 2);
  assert.ok(recoilX < 0, 'leftward recoil moves crosshair left');
});

test('Authoritative server GameRoom reproduces the verified CS2 AK-47 spray', () => {
  let now = 100000;
  const traces = [];
  const room = new GameRoom('RECOIL_QA', { mode: 'deathmatch', bots: 0, clock: () => now });
  const p = room.addHuman({}, { name: 'Spray Tester', team: 'T', primary: 'ak47' });
  Object.assign(p, { x: 0, y: 0, z: 0, grounded: true, protectionUntil: 0, nextShotAt: 0 });
  room.traceBullet = args => {
    traces.push(args);
    return { end: { x: args.direction.x * 40, y: args.origin.y + args.direction.y * 40, z: args.direction.z * 40 }, hits: [] };
  };

  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    for (let i = 0; i < 10; i++) {
      room.fire(p, { fire: true, yaw: 0, pitch: 0 }, { receivedAt: now, input: { fire: true, yaw: 0, pitch: 0, zoomLevel: 0 } });
      now += 100;
    }

    assert.equal(traces.length, 10, 'must record exactly 10 shots in spray');
    assert.ok(Math.abs(traces[0].direction.y) < 1e-4, 'bullet 1 dead center in pitch');
    assert.ok(Math.abs(traces[0].direction.x) < 1e-4, 'bullet 1 dead center in yaw');

    for (let i = 1; i < 6; i++) {
      assert.ok(traces[i].direction.y > traces[i - 1].direction.y, `bullet ${i + 1} pitch climbs`);
    }

    // Bullet 10: ~9.7 deg up, ~1.6 deg right (verified against real CS2 compensation data)
    assert.ok(traces[9].direction.y > 0.12 && traces[9].direction.y < 0.18, `bullet 10 vertical rise (${traces[9].direction.y.toFixed(3)}) matches ~9.7 deg`);
    assert.ok(traces[9].direction.x > 0.015, `bullet 10 sweeps right (${traces[9].direction.x.toFixed(3)})`);

    // 450ms pause: punch decays to ~zero but the pattern index is only partway reset
    now += 450;
    room.fire(p, { fire: true, yaw: 0, pitch: 0 }, { receivedAt: now, input: { fire: true, yaw: 0, pitch: 0, zoomLevel: 0 } });
    assert.equal(traces.length, 11);
    assert.ok(Math.abs(traces[10].direction.y) < 0.02, 'post-pause tap lands near center');
    assert.ok(Math.abs(traces[10].direction.x) < 0.02, 'post-pause tap lands near center');
    assert.ok(p.recoil.index > 1, 'recoil index not fully reset after 450ms (authentic CS2 behavior)');

    // 2s pause: index fully resets, next shot restarts the pattern from entry 0
    now += 2000;
    room.fire(p, { fire: true, yaw: 0, pitch: 0 }, { receivedAt: now, input: { fire: true, yaw: 0, pitch: 0, zoomLevel: 0 } });
    assert.equal(traces.length, 12);
    assert.ok(Math.abs(traces[11].direction.y) < 1e-4, 'fully recovered tap dead center');
    assert.equal(p.recoil.index, 1, 'recoil index fully reset before the shot, then advances to 1');
  } finally {
    Math.random = originalRandom;
  }
});
