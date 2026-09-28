// Climb Mirage's real ladders through the real physics engine.
//
// tests/ladders.mjs pins the ladder state machine on synthetic geometry; this
// file feeds the same code the shipped collision world (positions.f32 +
// penetration-materials.u8) and the ladder volumes the map pipeline extracted
// from the map itself, so a regression in either the extraction or the climb
// logic shows up here rather than in someone's play session.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMap } from '../shared/maps/registry.js';
import {
  initPhysics, activateWorld, hasWorld, dropWorld, createPlayerState,
  floorHeight, stepPlayer, getGroundMaterial,
} from '../shared/physics.js';
import { LADDER_LEDGE_SWEEP } from '../shared/ladders.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every standable spot around a ladder's base from which a player looking at
 * the ladder and holding forward actually ends up on it. Scanning the whole
 * ring — rather than assuming one approach — is what caught ladders that could
 * only be grabbed from some sides, and the mount is verified by simulation
 * rather than by the geometry alone, so a spot behind a wall is not counted.
 */
function approachSpots(ladder) {
  const tanX = Math.cos(ladder.yaw), tanZ = -Math.sin(ladder.yaw);
  const norX = -Math.sin(ladder.yaw), norZ = -Math.cos(ladder.yaw);
  const bottom = Number(ladder.bottom) || 0;
  const spots = [];
  for (let radius = 0.3; radius <= 2.5; radius += 0.1) {
    for (let a = 0; a < 24; a++) {
      const angle = a / 24 * Math.PI * 2;
      // Push into the face, not along or off it.
      if (Math.sin(angle) < 0.25) continue;
      const x = ladder.x + (tanX * Math.cos(angle) + norX * Math.sin(angle)) * radius;
      const z = ladder.z + (tanZ * Math.cos(angle) + norZ * Math.sin(angle)) * radius;
      const floor = floorHeight(x, z, bottom + 0.45, 1.5);
      if (floor === null || floor > bottom + 0.35 || floor < bottom - 1.5) continue;
      const spot = { x, z, y: floor, yaw: Math.atan2(-(ladder.x - x), -(ladder.z - z)) };
      const probe = createPlayerState(spot);
      let mounted = false;
      for (let i = 0; i < 90 && !mounted; i++) {
        stepPlayer(probe, { forward: 1, yaw: probe.yaw, pitch: 0 }, 1 / 60);
        mounted = probe.onLadder;
      }
      if (mounted) spots.push(spot);
    }
  }
  return spots;
}

/** Hold forward for `ms`, looking where `pitch` says. */
function walk(p, ms, input) {
  const steps = Math.round(ms / (1000 / 60));
  for (let i = 0; i < steps; i++) stepPlayer(p, input, 1 / 60);
}

/** Walk into the ladder and climb it, reporting where the player came out.
 *  Holding W is the whole control; the view is aimed *away* from the ladder to
 *  prove the pitch no longer steers the climb. */
function climbUp(p) {
  for (let i = 0; i < 90 && !p.onLadder; i++) stepPlayer(p, { forward: 1, yaw: p.yaw, pitch: 0 }, 1 / 60);
  for (let i = 0; i < 400 && p.onLadder; i++) stepPlayer(p, { forward: 1, yaw: p.yaw, pitch: -1.2 }, 1 / 60);
  return { landed: p.y, grounded: p.grounded, onLadder: p.onLadder };
}

function loadWorld(mapId) {
  const map = getMap(mapId);
  const geometry = fs.readFileSync(path.join(root, 'public', map.assets.geometryUrl.replace(/^\//, '')));
  const materials = fs.readFileSync(path.join(root, 'public', map.assets.penetrationUrl.replace(/^\//, '')));
  initPhysics(new Float32Array(geometry.buffer, geometry.byteOffset, geometry.byteLength / 4),
    new Uint8Array(materials), mapId, map.ladders, map.groundPatches);
  activateWorld(mapId);
  assert.equal(hasWorld(mapId), true);
}

function mirageLadders() {
  const ladders = getMap('de_mirage').ladders;
  assert.ok(ladders.length >= 2, 'the map descriptor must carry its ladders');
  return ladders;
}

test('every standable approach to a Mirage ladder mounts and reaches the top', async t => {
  loadWorld('de_mirage');
  t.after(() => dropWorld('de_mirage'));

  for (const ladder of mirageLadders()) {
    const spots = approachSpots(ladder);
    assert.ok(spots.length > 0, `${ladder.id}: the map must leave a way onto this ladder`);

    let landed = 0;
    for (const spot of spots) {
      const result = climbUp(createPlayerState(spot));
      if (!result.onLadder && result.grounded && result.landed > ladder.bottom + 1.5) landed++;
    }
    assert.equal(landed, spots.length,
      `${ladder.id}: ${spots.length - landed} of ${spots.length} ways onto this ladder never came out on the floor above`);
  }
});

test('a full round trip: up, hold, land, climb back down', async t => {
  loadWorld('de_mirage');
  t.after(() => dropWorld('de_mirage'));

  for (const ladder of mirageLadders()) {
    const spot = approachSpots(ladder)[0];
    const p = createPlayerState(spot);
    const groundFloor = p.y;

    // --- up ---------------------------------------------------------------
    const up = climbUp(p);
    assert.equal(up.onLadder, false, `${ladder.id}: the top must let go`);
    assert.equal(up.grounded, true, `${ladder.id}: must land standing, not hanging`);
    assert.ok(up.landed <= ladder.top + 0.05, `${ladder.id}: must not end above the top (${up.landed})`);
    assert.ok(up.landed > groundFloor + 1.5,
      `${ladder.id}: must end on a higher floor, ${groundFloor} → ${up.landed}`);
    // Emerging has to happen at the very top of the shaft, not part way up: the
    // landing floor sits within the top-settle reach below the ladder's top.
    assert.ok(up.landed >= ladder.top - LADDER_LEDGE_SWEEP - 0.05,
      `${ladder.id}: must come out at the top of the shaft, came out at ${up.landed} (top ${ladder.top})`);
    const ledge = up.landed;
    // Gravity is back on, so the player has to stay put on that ledge.
    walk(p, 500, { forward: 0, yaw: p.yaw, pitch: 0 });
    assert.equal(p.grounded, true, `${ladder.id}: must stay standing on the ledge`);
    assert.ok(Math.abs(p.y - ledge) < 0.15, `${ladder.id}: must not slide off the ledge (${p.y} vs ${ledge})`);

    // --- down -------------------------------------------------------------
    const down = createPlayerState({ x: ladder.x, z: ladder.z, y: ledge - 0.02, yaw: spot.yaw, pitch: 1.2 });
    for (let i = 0; i < 120 && !down.onLadder; i++) stepPlayer(down, { forward: 1, yaw: down.yaw }, 1 / 60);
    assert.equal(down.onLadder, true, `${ladder.id}: must be able to take the ladder back down`);
    for (let i = 0; i < 400 && down.onLadder; i++) stepPlayer(down, { forward: -1, yaw: down.yaw }, 1 / 60);
    assert.equal(down.onLadder, false, `${ladder.id}: the bottom must let go`);
    walk(down, 600, { forward: 0, yaw: down.yaw, pitch: 0 });
    assert.equal(down.grounded, true, `${ladder.id}: must land on the ground floor`);
    assert.ok(Math.abs(down.y - groundFloor) < 0.6,
      `${ladder.id}: must return near the floor it started on, ${down.y} vs ${groundFloor}`);

    // --- hold -------------------------------------------------------------
    // Releasing the forward axis hangs the player still, wherever they look.
    const held = createPlayerState(spot);
    for (let i = 0; i < 90 && !held.onLadder; i++) stepPlayer(held, { forward: 1, yaw: spot.yaw, pitch: 0 }, 1 / 60);
    assert.equal(held.onLadder, true, `${ladder.id}: mounted for the hold case`);
    const heldY = held.y;
    walk(held, 900, { forward: 0, yaw: spot.yaw, pitch: 1.2 });
    assert.equal(held.onLadder, true, `${ladder.id}: must stay on with the throttle released`);
    assert.ok(Math.abs(held.y - heldY) < 0.02, `${ladder.id}: released forward must not drift (${heldY} -> ${held.y})`);
    assert.ok(Math.abs(held.y - heldY) < 0.02, `${ladder.id}: level view must not drift (${heldY} → ${held.y})`);

    // --- jump off ---------------------------------------------------------
    const jumper = createPlayerState(spot);
    for (let i = 0; i < 90 && !jumper.onLadder; i++) stepPlayer(jumper, { forward: 1, yaw: spot.yaw, pitch: 0 }, 1 / 60);
    assert.equal(jumper.onLadder, true, `${ladder.id}: mounted for the jump-off case`);
    stepPlayer(jumper, { forward: 1, yaw: spot.yaw, pitch: 0, jump: true, jumpId: 1 }, 1 / 60);
    assert.equal(jumper.onLadder, false, `${ladder.id}: jump must leave the ladder`);
    assert.ok(jumper.vy > 0, `${ladder.id}: jump must push up, vy=${jumper.vy}`);
    walk(jumper, 500, { forward: 0, yaw: spot.yaw, pitch: 0 });
    assert.equal(jumper.onLadder, false, `${ladder.id}: must not re-grab straight after jumping`);
  }
});

test('a ladder is only grabbed by walking into the face', async t => {
  loadWorld('de_mirage');
  t.after(() => dropWorld('de_mirage'));

  for (const ladder of mirageLadders()) {
    const spot = approachSpots(ladder)[0];

    // Standing near it and looking up is not a grab. Source needs the push into
    // the face, so a player admiring the ladder stays on the floor.
    const admirer = createPlayerState(spot);
    walk(admirer, 500, { forward: 0, yaw: spot.yaw, pitch: 1.2 });
    assert.equal(admirer.onLadder, false, `${ladder.id}: looking up alone must not grab`);
    walk(admirer, 500, { forward: 0, yaw: spot.yaw, pitch: 0 });
    assert.equal(admirer.onLadder, false, `${ladder.id}: must still be on the floor`);

    // Walking away from the face never grabs.
    const backer = createPlayerState(spot);
    walk(backer, 600, { forward: -1, yaw: spot.yaw, pitch: 1.2 });
    assert.equal(backer.onLadder, false, `${ladder.id}: walking away must not grab`);

    // Sliding along the face parallel to it never grabs either, however close
    // the player ends up — otherwise everyone hugging a ladder wall would fly
    // up it. Facing along the tangent keeps the wish direction square to the
    // face, which is the dot ≈ 0 case.
    const alongYaw = Math.atan2(-Math.cos(ladder.yaw), Math.sin(ladder.yaw));
    const strafer = createPlayerState({ ...spot, yaw: alongYaw });
    walk(strafer, 900, { forward: 1, yaw: alongYaw, pitch: 0 });
    assert.equal(strafer.onLadder, false, `${ladder.id}: sliding past the face must not grab`);

    // The volume ends where the map says it does: standing well above the top
    // and walking into the wall is not a climb.
    const above = createPlayerState({ x: ladder.x, z: ladder.z, y: ladder.top + 2, yaw: spot.yaw, pitch: 1.2 });
    walk(above, 400, { forward: 1, yaw: spot.yaw, pitch: 0 });
    assert.equal(above.onLadder, false, `${ladder.id}: the volume must stop at the top`);
  }
});

test('footstep material patches belong to the map that declares them', async t => {
  const dust2 = getMap('de_dust2');
  const mirage = getMap('de_mirage');

  // Dust II declares its Pit as sand; Mirage declares nothing, because Mirage
  // has walkable floor inside that same box and must not inherit Dust II's.
  assert.ok(dust2.groundPatches?.length > 0, 'Dust II declares its sand Pit');
  assert.deepEqual(mirage.groundPatches || [], []);

  const PIT = { x: 40, y: -3, z: -5 };
  const OUTSIDE = { x: 0, y: -3, z: 0 };
  for (const map of [dust2, mirage]) {
    loadWorld(map.id);
    const pit = getGroundMaterial(PIT.x, PIT.y, PIT.z);
    const outside = getGroundMaterial(OUTSIDE.x, OUTSIDE.y, OUTSIDE.z);
    if (map.id === 'de_dust2') {
      assert.equal(pit, 'sand', `Dust II Pit reads as sand (got ${pit})`);
      assert.notEqual(outside, 'sand', 'outside the Pit is not sand');
    } else {
      assert.notEqual(pit, 'sand', `Mirage must not inherit Dust II's sand (got ${pit})`);
    }
    dropWorld(map.id);
  }
});

test('Dust II keeps no ladder behaviour at all', async t => {
  const map = getMap('de_dust2');
  assert.deepEqual(map.ladders, []);
  loadWorld('de_dust2');
  t.after(() => dropWorld('de_dust2'));
  const spawn = map.spawns.T[0];
  const p = createPlayerState({ x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw ?? 0 });
  for (let i = 0; i < 600; i++) stepPlayer(p, { forward: 1, yaw: p.yaw, pitch: 1.2 }, 1 / 60);
  assert.equal(p.onLadder, false, 'Dust II has no ladders and must never claim one');
});
