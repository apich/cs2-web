import test from 'node:test';
import assert from 'node:assert/strict';
import { GrenadeSimulation, segmentIntersectsSmoke } from '../server/grenades.js';
import { GameRoom } from '../server/game.js';
import { EQUIPMENT } from '../shared/equipment.js';
import { initPhysics, raycastWorld, raycastWorldContact } from '../shared/physics.js';

function fixture() {
  let now = 100000;
  const events = [];
  const sim = new GrenadeSimulation({
    clock: () => now,
    raycastWorld: () => null,
    raycastContact: null,
    emit: (type, e) => events.push({ type, ...e }),
    onExplosion: () => {},
    onFlash: () => {},
    onFire: () => {}
  });
  return {
    sim,
    events,
    now: () => now,
    advance: (ms) => {
      const step = ms / 1000;
      sim.tick(step);
      now += ms;
    }
  };
}

test('CS2 Volumetric Smoke: Smoke blooms outward from canister over 1.5s instead of popping instantly', () => {
  const { sim, advance } = fixture();
  // Detonate smoke at (0, 1.3, 0)
  sim.detonate({ id: 'smoke_bloom', ownerId: 'player_1', team: 'T', weapon: 'smokegrenade', x: 0, y: 0, z: 0 });

  const offAxisFarA = { x: -10, y: 1.3, z: 3.5 };
  const offAxisFarB = { x: 10, y: 1.3, z: 3.5 };

  // At 0.1s: Smoke is a compact burst around the canister (r ~ 0.7m), so a ray at z=3.5m is NOT blocked
  advance(100);
  assert.equal(sim.blocksSight(offAxisFarA, offAxisFarB), false, 'Far ray must not be blocked during initial puff');

  // At 1.6s: Smoke has fully expanded (r = 4.5m), so a ray at z=3.5m IS blocked
  advance(1500);
  assert.equal(sim.blocksSight(offAxisFarA, offAxisFarB), true, 'Far ray must be blocked once smoke blooms to full size');
});

test('CS2 Volumetric Smoke: HE grenade explosion disperses smoke for 2.5s with recovery', () => {
  const { sim, advance, now } = fixture();
  
  // 1. Deploy smoke at (0, 1.3, 0)
  sim.detonate({ id: 'smoke_1', ownerId: 'player_1', team: 'T', weapon: 'smokegrenade', x: 0, y: 0, z: 0 });
  assert.equal(sim.smokes.length, 1);
  const smoke = sim.smokes[0];
  assert.equal(smoke.radius, 4.5);

  advance(1600); // Allow smoke cloud to bloom to full size

  const eyeA = { x: -10, y: 1.3, z: 0 };
  const eyeB = { x: 10, y: 1.3, z: 0 };

  // Before explosion, smoke blocks sight completely
  assert.equal(sim.blocksSight(eyeA, eyeB), true, 'Dense smoke must block sight');

  // 2. Detonate HE grenade at smoke center (0, 1.3, 0)
  sim.disperseSmoke({ x: 0, y: 1.3, z: 0 }, 3.5, 2.5, 0.6);

  // 3. During initial 2.0s blast window, smoke is blown clear
  assert.equal(sim.blocksSight(eyeA, eyeB), false, 'Smoke must be dispersed immediately after HE blast');

  advance(1000); // at 1.0s
  assert.equal(sim.blocksSight(eyeA, eyeB), false, 'Smoke remains cleared at 1.0s');

  advance(850); // at 1.85s (before 1.9s recovery start)
  assert.equal(sim.blocksSight(eyeA, eyeB), false, 'Smoke remains cleared at 1.85s');

  // 4. At 2.6s (past 2.5s recovery window), smoke has fully reformed
  advance(750); // at 2.6s
  assert.equal(sim.blocksSight(eyeA, eyeB), true, 'Smoke must fully reform after 2.5s');
});

test('CS2 Volumetric Smoke: Bullets carve cavitation holes through smoke that close after 0.7s', () => {
  const { sim, advance } = fixture();
  
  sim.detonate({ id: 'smoke_2', ownerId: 'player_1', team: 'T', weapon: 'smokegrenade', x: 0, y: 0, z: 0 });
  advance(1600); // Allow smoke to bloom so off-axis sight (2m away) is within the bloomed cloud

  const bulletStart = { x: -10, y: 1.3, z: 0 };
  const bulletEnd = { x: 10, y: 1.3, z: 0 };
  const offAxisA = { x: -10, y: 1.3, z: 2.0 };
  const offAxisB = { x: 10, y: 1.3, z: 2.0 };

  // Before shooting, sight is blocked everywhere
  assert.equal(sim.blocksSight(bulletStart, bulletEnd), true);
  assert.equal(sim.blocksSight(offAxisA, offAxisB), true);

  // Fire bullet through smoke along bulletStart -> bulletEnd
  sim.carveBullet(bulletStart, bulletEnd, 0.24, 0.7, 0.25);

  // Along the bullet hole, sight is NOT blocked
  assert.equal(sim.blocksSight(bulletStart, bulletEnd), false, 'Sight along bullet hole must be clear');
  
  // Off-axis sight (2m away) is still blocked by smoke
  assert.equal(sim.blocksSight(offAxisA, offAxisB), true, 'Off-axis sight must remain blocked by smoke');

  // At 0.3s, bullet hole is still open
  advance(300);
  assert.equal(sim.blocksSight(bulletStart, bulletEnd), false, 'Bullet hole stays open at 0.3s');

  // At 0.8s, bullet hole has completely closed
  advance(500);
  assert.equal(sim.blocksSight(bulletStart, bulletEnd), true, 'Bullet hole must close after 0.7s');
});

test('CS2 Volumetric Smoke: Snapshot packages carves with type, duration, and age', () => {
  const { sim, advance } = fixture();
  sim.detonate({ id: 'smoke_3', ownerId: 'player_1', team: 'T', weapon: 'smokegrenade', x: 0, y: 0, z: 0 });
  
  sim.disperseSmoke({ x: 0, y: 1.3, z: 0 }, 3.5, 2.5, 0.6);
  sim.carveBullet({ x: -5, y: 1.3, z: 0 }, { x: 5, y: 1.3, z: 0 }, 0.24, 0.7, 0.25);

  const snap = sim.snapshot();
  assert.equal(snap.smokes.length, 1);
  assert.equal(snap.smokes[0].carves.length, 2);
  
  const explosionCarve = snap.smokes[0].carves.find(c => c.type === 'explosion');
  assert.ok(explosionCarve);
  assert.ok(explosionCarve.radius >= 3.5);
  assert.equal(explosionCarve.duration, 2.5);

  const bulletCarve = snap.smokes[0].carves.find(c => c.type === 'bullet');
  assert.ok(bulletCarve);
  assert.equal(bulletCarve.radius, 0.24);
  assert.equal(bulletCarve.duration, 0.7);
});
