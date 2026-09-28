import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAP_REGISTRY, DEFAULT_MAP, mapIds, listMaps, hasMap, resolveMapId, getMap,
  normalizeMapPool,
} from '../shared/maps/registry.js';
import {
  initPhysics, activateWorld, hasWorld, loadedWorldKeys, getCurrentWorldKey, dropWorld,
} from '../shared/physics.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every registered map has a complete descriptor', () => {
  assert.ok(mapIds().length >= 2, 'at least two maps are registered');
  for (const map of listMaps()) {
    for (const field of ['id', 'name', 'version', 'bounds', 'spawns', 'sites', 'nav', 'labels', 'overview', 'ladders', 'assets', 'lighting']) {
      assert.ok(map[field] !== undefined, `${map.id} is missing ${field}`);
    }
    assert.equal(map.id, resolveMapId(map.id));
    // Two bombsite maps only: the bomb-target pick in server/game.js is built on A/B.
    assert.ok(map.sites.A && map.sites.B, `${map.id} needs both A and B sites`);
    for (const team of ['T', 'CT']) {
      assert.ok(Array.isArray(map.spawns[team]) && map.spawns[team].length >= 2, `${map.id} needs ${team} spawns`);
    }
  }
});

test('an unknown map id falls back to the default instead of failing to start', () => {
  assert.equal(resolveMapId('de_does_not_exist'), DEFAULT_MAP);
  assert.equal(resolveMapId(undefined), DEFAULT_MAP);
  assert.equal(resolveMapId(42), DEFAULT_MAP);
  assert.equal(getMap('de_does_not_exist').id, DEFAULT_MAP);
  assert.equal(hasMap('de_mirage'), true);
  assert.equal(hasMap('[object Object]'), false, 'a JSON object must not pass as a map id');
});

test('Mirage is registered and its assets exist on disk', () => {
  const mirage = getMap('de_mirage');
  assert.equal(mirage.id, 'de_mirage');
  assert.equal(mirage.name, 'Mirage');
  for (const url of [mirage.assets.geometryUrl, mirage.assets.penetrationUrl,
    mirage.assets.renderDesktop, mirage.assets.renderMobile, mirage.assets.radarImage]) {
    const file = path.join(root, 'public', url.replace(/^\//, '').split('?')[0]);
    assert.ok(fs.existsSync(file), `missing asset: ${url}`);
  }
  // The mobile tier must reuse the desktop geometry buffer rather than duplicate it.
  const mobile = JSON.parse(fs.readFileSync(path.join(root, 'public', mirage.assets.renderMobile.replace(/^\//, '')), 'utf8'));
  assert.ok(mobile.buffers.some(b => /\.bin$/.test(b.uri || '')), 'mobile gltf should reference a shared bin');
});

test('the map pool normaliser keeps valid ids and always yields one map', () => {
  assert.deepEqual(normalizeMapPool(['de_dust2']), ['de_dust2']);
  assert.deepEqual(normalizeMapPool(['de_dust2', 'de_mirage']), ['de_dust2', 'de_mirage']);
  assert.deepEqual(normalizeMapPool(['de_mirage', 'de_mirage', 'de_dust2']), ['de_mirage', 'de_dust2'], 'dedupes but keeps order');
  assert.deepEqual(normalizeMapPool(['nope', 'de_mirage']), ['de_mirage'], 'unknown ids are dropped');
  assert.deepEqual(normalizeMapPool([]), [DEFAULT_MAP], 'an empty pool falls back');
  assert.deepEqual(normalizeMapPool(null), [DEFAULT_MAP]);
  assert.deepEqual(normalizeMapPool('de_dust2'), [DEFAULT_MAP], 'a bare string is not a pool');
  assert.deepEqual(normalizeMapPool(['de_mirage', {}]), ['de_mirage'], 'objects are rejected');
});

test('two maps can hold collision worlds in the same process', () => {
  const worlds = [];
  try {
    for (const map of listMaps()) {
      const raw = fs.readFileSync(path.join(root, 'public', map.assets.geometryUrl.replace(/^\//, '')));
      const materials = fs.readFileSync(path.join(root, 'public', map.assets.penetrationUrl.replace(/^\//, '')));
      initPhysics(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4),
        new Uint8Array(materials), map.id, map.ladders);
      worlds.push(map.id);
    }
    assert.equal(loadedWorldKeys().length, worlds.length, 'every map world stays resident');
    for (const id of worlds) assert.equal(hasWorld(id), true);
    // Switching maps must move the active world, not blank it.
    for (const id of worlds) {
      assert.equal(activateWorld(id), true);
      assert.equal(getCurrentWorldKey(), id);
    }
  } finally {
    for (const id of worlds) dropWorld(id);
  }
});
