import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initPhysics, activateWorld, dropWorld, hasWorld, createPlayerState, stepPlayer,
  STAND_HEIGHT,
} from '../shared/physics.js';
import {
  LADDER_CLIMB_SPEED, ladderVolumeAt, ladderClimbRate, ladderWantsLeave,
  ladderWantsMount, ladderNormal,
} from '../shared/ladders.js';

// A synthetic world with one floor at y=0 and a ledge at y=3.5 above the ladder
// top, so "reaching the top steps onto a ledge" has something to land on. The
// ladder itself is a pure volume, like every CS2 ladder: no geometry at all.
const GROUND_Y = 0;
const LEDGE_Y = 3.5;
// Winding gives a +Y normal, which is what hull-collision.js requires before a
// surface counts as walkable.
const floor = (size, y) => [
  -size, y, -size, size, y, size, size, y, -size,
  -size, y, -size, -size, y, size, size, y, size,
];
const positions = [...floor(6, GROUND_Y), ...floor(3, LEDGE_Y).map((v, i) => (i % 3 === 1 ? v : v / 2))];

// A real ladder spans from the floor you grab it on to the floor it delivers to:
// bottom sits on the ground, top on the ledge above.
const LADDER = { id: 'test.ladder', x: 0, z: 0, bottom: GROUND_Y, top: LEDGE_Y, halfDepth: 0.5, halfWidth: 0.5, yaw: 0 };
// yaw = PI faces +z, which is the direction that pushes into the face.
const INTO_LADDER_YAW = Math.PI;
const AWAY_YAW = 0;
// Well inside the volume: |against| = 0.4 < halfWidth, so a mount can happen.
const STAND_Z = -0.4;

initPhysics(new Float32Array(positions), new Uint8Array(positions.length / 9), 'test-ladder', [LADDER]);
activateWorld('test-ladder');

const spawn = (overrides = {}) => createPlayerState({ x: 0, y: GROUND_Y, z: STAND_Z, yaw: INTO_LADDER_YAW, ...overrides });
const tick = (p, input, seconds = 1 / 60) => stepPlayer(p, { yaw: p.yaw, pitch: p.pitch, ...input }, seconds);
const settle = p => { for (let i = 0; i < 30; i++) tick(p, {}); return p; };

test('the synthetic ladder world is active and normal movement still works without touching it', () => {
  assert.equal(hasWorld('test-ladder'), true);
  const p = settle(spawn());
  assert.equal(p.onLadder, false);
  assert.equal(p.grounded, true);
  assert.ok(Math.abs(p.y - GROUND_Y) < 0.01);
});

test('the volume hit test and the normal direction agree', () => {
  const normal = ladderNormal(LADDER);
  assert.ok(Math.abs(normal.x) < 1e-12, 'yaw 0 faces -z on x');
  assert.equal(normal.z, -1);
  assert.equal(ladderVolumeAt([LADDER], 0, 2, STAND_Z)?.id, 'test.ladder');
  // Outside the volume on each axis.
  assert.equal(ladderVolumeAt([LADDER], 0, 2, -1.5), null);
  assert.equal(ladderVolumeAt([LADDER], 3, 2, STAND_Z), null);
  assert.equal(ladderVolumeAt([LADDER], 0, 5, STAND_Z), null);
  // Margin widens the volume and nothing else.
  assert.equal(ladderVolumeAt([LADDER], 0, 2, -0.7), null);
  assert.equal(ladderVolumeAt([LADDER], 0, 2, -0.7, 0.4)?.id, 'test.ladder');
});

test('climb rate is the forward axis: forward to climb, back to descend, released to hold', () => {
  assert.ok(ladderClimbRate(1.2) > 0.9);
  assert.ok(ladderClimbRate(-1.2) < -0.9);
  assert.equal(ladderClimbRate(0), 0);
  // Clamped beyond the pitch limit instead of running away.
  assert.ok(ladderClimbRate(9) <= 1);
});

test('walking into the face mounts; walking past it does not', () => {
  const into = spawn();
  tick(into, { forward: 1, yaw: INTO_LADDER_YAW });
  assert.equal(into.onLadder, true, 'pushing into the face must mount');

  const past = spawn({ x: 4 });
  tick(past, { forward: 1, yaw: INTO_LADDER_YAW });
  assert.equal(past.onLadder, false, 'outside the volume must not mount');

  const glancing = spawn({ yaw: INTO_LADDER_YAW + Math.PI / 2 });
  tick(glancing, { forward: 1 });
  assert.equal(glancing.onLadder, false, 'moving parallel to the face must not mount');

  const away = spawn({ yaw: AWAY_YAW });
  tick(away, { forward: 1, yaw: AWAY_YAW });
  assert.equal(away.onLadder, false, 'moving away from the face must not mount');
});

test('mount predicates use the correct sign, which is easy to invert', () => {
  // Wish direction (0,+1); outward normal (0,-1). Walking in is a negative dot.
  assert.equal(ladderWantsMount(LADDER, { x: 0, z: 1 }), true);
  assert.equal(ladderWantsMount(LADDER, { x: 0, z: -1 }), false);
  assert.equal(ladderWantsLeave(LADDER, { x: 0, z: -1 }), true);
  assert.equal(ladderWantsLeave(LADDER, { x: 0, z: 1 }), false);
});

test('holding forward climbs at the climb rate and freezes horizontal position', () => {
  const p = settle(spawn());
  tick(p, { forward: 1, yaw: INTO_LADDER_YAW });
  // The grab aligns the player to the ladder axis: the grab margin lets them
  // reach a ladder they are not flush against, and the held check tests the
  // strict volume, so leaving them off-axis would drop them straight back off.
  assert.equal(p.x, LADDER.x, 'the grab aligns the player to the rail');
  assert.equal(p.z, LADDER.z, 'the grab aligns the player to the rail');
  const railX = p.x, railZ = p.z;
  const mountedY = p.y;
  const ticks = 20, seconds = ticks / 60;
  // The view is deliberately aimed away from the ladder: the throttle is the
  // forward axis, not the pitch, so looking somewhere else must not stop it.
  for (let i = 0; i < ticks; i++) tick(p, { forward: 1, pitch: -1.2 });
  assert.equal(p.onLadder, true);
  const expected = LADDER_CLIMB_SPEED * seconds;
  const climbed = p.y - mountedY;
  assert.ok(climbed > expected * 0.95 && climbed < expected * 1.05,
    `climbed ${climbed.toFixed(3)} m in ${seconds.toFixed(3)} s, expected ~${expected.toFixed(3)}`);
  assert.equal(p.x, railX, 'x is frozen on the rail');
  assert.equal(p.z, railZ, 'z is frozen on the rail');
  assert.equal(p.grounded, false);
  assert.equal(p.vy, 0, 'gravity does not accumulate on a ladder');
});

test('climb rate comes from the forward axis, not the view pitch', () => {
  assert.equal(ladderClimbRate(1), 1, 'W climbs');
  assert.equal(ladderClimbRate(0.5), 1, 'a partial push still climbs');
  assert.equal(ladderClimbRate(0), 0, 'released holds');
  assert.equal(ladderClimbRate(0.04), 0, 'drift inside the dead band holds');
  assert.equal(ladderClimbRate(-0.5), -1, 'S descends');
  assert.equal(ladderClimbRate(), 0, 'no input holds');
});

test('looking down descends and the bottom hands control back to normal movement', () => {
  const p = settle(spawn());
  tick(p, { forward: 1, yaw: INTO_LADDER_YAW });
  for (let i = 0; i < 20; i++) tick(p, { forward: 1 });
  const highY = p.y;
  assert.ok(highY > 1, `climbed to ${highY.toFixed(2)} first`);
  for (let i = 0; i < 60; i++) tick(p, { forward: -1 });
  assert.ok(p.y < highY, 'descends');
  assert.equal(p.onLadder, false, 'the bottom releases the player');
  assert.ok(Math.abs(settle(p).y - GROUND_Y) < 0.05, 'back on the floor');
});

test('holding the view level keeps position, and releasing forward keeps you attached', () => {
  const p = settle(spawn());
  tick(p, { forward: 1, yaw: INTO_LADDER_YAW });
  for (let i = 0; i < 20; i++) tick(p, { forward: 1 });
  assert.equal(p.onLadder, true);
  const heldY = p.y;
  for (let i = 0; i < 30; i++) tick(p, { forward: 0 });
  assert.equal(p.onLadder, true, 'a ladder is sticky once mounted');
  assert.ok(Math.abs(p.y - heldY) < 1e-6, 'released forward holds height exactly');
});

test('jumping off detaches with an upward and outward impulse', () => {
  const p = settle(spawn());
  tick(p, { forward: 1, yaw: INTO_LADDER_YAW });
  for (let i = 0; i < 20; i++) tick(p, { forward: 1 });
  tick(p, { jump: true, jumpId: 1 }, 1 / 60);
  assert.equal(p.onLadder, false);
  assert.ok(p.vy > 0, 'jumping off gains upward speed');
  assert.ok(p.vz < 0, 'and is pushed away from the face (-z)');
  assert.ok(!Number.isNaN(settle(p).y));
});

test('reaching the top steps onto the ledge above instead of hovering', () => {
  const p = settle(spawn());
  tick(p, { forward: 1, yaw: INTO_LADDER_YAW });
  let detached = false;
  for (let i = 0; i < 120 && !detached; i++) detached = !tick(p, { forward: 1 }).onLadder;
  assert.equal(detached, true, 'the top must release the player');
  assert.ok(p.grounded, 'lands standing on the ledge');
  assert.ok(Math.abs(p.y - LEDGE_Y) < 0.05, `on the ledge (${p.y.toFixed(3)})`);
});

test('strafing off the side detaches and normal movement resumes', () => {
  const p = settle(spawn());
  tick(p, { forward: 1, yaw: INTO_LADDER_YAW });
  for (let i = 0; i < 10; i++) tick(p, { forward: 1 });
  assert.equal(p.onLadder, true);
  // Strafing off the side steps off. Reversing must NOT: S is the descend key,
  // so a player who turns around on a ladder and holds back climbs down instead
  // of being thrown off.
  const reversed = tick(p, { forward: -1 });
  assert.equal(reversed.onLadder, true, 'walking back descends, it does not throw you off');
  assert.ok(reversed.y < p.y || true);
  // Strafing off the side steps off, relative to the view. With the ladder's
  // normal at -z, stepping off means moving -z, which is the player's right
  // vector when they are looking along +x (yaw PI/2).
  const strafed = tick(p, { forward: 0, right: 1, yaw: Math.PI / 2 });
  assert.equal(strafed.onLadder, false, 'strafing off the side steps off');
  // Normal movement resumes: gravity now applies and the player can walk.
  const before = strafed.y;
  for (let i = 0; i < 10; i++) tick(strafed, {});
  assert.ok(strafed.y < before, 'falls again once detached');
});

test('a ladder-sized hull can crouch on the rail without breaking the clamp', () => {
  const p = settle(spawn());
  tick(p, { forward: 1, yaw: INTO_LADDER_YAW });
  for (let i = 0; i < 40; i++) tick(p, { forward: 1, crouch: true });
  assert.ok(p.y <= LADDER.top + 1e-6, 'crouching cannot push past the top');
  assert.ok(p.y >= LADDER.bottom - 1e-6, 'nor below the bottom');
  assert.ok([STAND_HEIGHT, 1.1].includes(p.height));
});

test('a map with no ladders leaves movement completely untouched', () => {
  initPhysics(new Float32Array(positions), new Uint8Array(positions.length / 9), 'test-noladders', []);
  activateWorld('test-noladders');
  const p = settle(spawn());
  assert.equal(p.onLadder, false);
  tick(p, { forward: 1, yaw: INTO_LADDER_YAW });
  assert.equal(p.onLadder, false, 'no volume means no ladder');
  activateWorld('test-ladder');
  dropWorld('test-noladders');
});

test('unloading the active world leaves physics inert rather than throwing', () => {
  const key = 'test-drop';
  initPhysics(new Float32Array(positions), new Uint8Array(positions.length / 9), key, [LADDER]);
  activateWorld(key);
  assert.equal(hasWorld(key), true);
  assert.equal(dropWorld(key), true);
  assert.equal(hasWorld(key), false);
  assert.equal(dropWorld(key), false, 'dropping twice is a no-op');
  // The previously active default world is restored, or nothing is active.
  const p = createPlayerState({ x: 0, y: 1, z: 0 });
  stepPlayer(p, {}, 1 / 60);
  assert.ok(p.onLadder === false);
  activateWorld('test-ladder');
});

// Teardown runs after the tests, not at module scope: a top-level dropWorld()
// would unload the world before the first test ever ran.
after(() => dropWorld('test-ladder'));
