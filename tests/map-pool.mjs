import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMapId, normalizeMapPool, DEFAULT_MAP } from '../shared/maps/registry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The same pure function server/index.js uses to draw a room's map. */
function pickMapId(pool, rng) {
  const list = normalizeMapPool(pool);
  if (list.length === 1) return list[0];
  const value = rng();
  return list[value % list.length];
}
// Deterministic stand-in for crypto.randomBytes so the distribution is testable.
const seq = values => { let i = 0; return () => values[i++ % values.length]; };

test('a single-map pool always yields that map, whatever the rng says', () => {
  for (const draw of [0, 1, 7, 999]) {
    assert.equal(pickMapId(['de_mirage'], () => draw), 'de_mirage');
    assert.equal(pickMapId(['de_dust2'], () => draw), 'de_dust2');
  }
});

test('a multi-map pool is drawn by the server, not the player', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(pickMapId(['de_dust2', 'de_mirage'], () => i % 2));
  assert.deepEqual([...seen].sort(), ['de_dust2', 'de_mirage'], 'both maps are reachable');

  // Every draw lands in the pool; nothing outside it is ever returned.
  for (let i = 0; i < 500; i++) {
    assert.ok(['de_dust2', 'de_mirage'].includes(pickMapId(['de_dust2', 'de_mirage'], seq([i]))));
  }
});

test('a pool with unknown ids is narrowed before the draw', () => {
  assert.equal(pickMapId(['de_does_not_exist'], () => 0), DEFAULT_MAP);
  assert.equal(pickMapId(['bogus', 'de_mirage'], () => 1), 'de_mirage');
});

test('extracted ladder volumes are all-sane and match the map they came from', () => {
  const mirage = resolveMapId('de_mirage');
  const file = path.join(root, 'public/assets/maps', mirage, 'ladders.json');
  assert.ok(fs.existsSync(file), 'the pipeline must emit ladders.json');
  const { ladders } = JSON.parse(fs.readFileSync(file, 'utf8'));

  assert.ok(ladders.length > 0, 'Mirage has ladders; a silent zero is a bug');
  const ids = new Set();
  for (const ladder of ladders) {
    assert.ok(typeof ladder.id === 'string' && ladder.id, 'every ladder needs an id');
    assert.equal(ids.has(ladder.id), false, `duplicate ladder id ${ladder.id}`);
    ids.add(ladder.id);
    for (const field of ['x', 'z', 'bottom', 'top', 'halfDepth', 'halfWidth', 'yaw']) {
      assert.ok(Number.isFinite(ladder[field]), `ladder ${ladder.id} has a bad ${field}`);
    }
    assert.ok(ladder.top > ladder.bottom, `${ladder.id} must climb upward`);
    assert.ok(ladder.top - ladder.bottom > 1.5, `${ladder.id} is too short to be a route`);
    // A ladder is a narrow vertical shaft, never a ramp or a wall.
    assert.ok(ladder.halfWidth <= 0.9 && ladder.halfDepth <= 0.9, `${ladder.id} footprint is too wide`);
    assert.ok(Math.abs(ladder.yaw) <= Math.PI, `${ladder.id} yaw out of range`);
  }
  // Distinct volumes must not overlap: overlapping rails would grab a player twice.
  for (let i = 0; i < ladders.length; i++) for (let j = i + 1; j < ladders.length; j++) {
    const a = ladders[i], b = ladders[j];
    const apart = Math.hypot(a.x - b.x, a.z - b.z) > (a.halfDepth + b.halfDepth);
    assert.ok(apart, `${a.id} and ${b.id} overlap`);
  }
});

test('Dust II declares no ladders, matching the map source', () => {
  const file = path.join(root, 'public/assets/map');
  // Dust II keeps its legacy layout and has no ladder file at all.
  assert.equal(fs.existsSync(path.join(file, 'ladders.json')), false);
});
