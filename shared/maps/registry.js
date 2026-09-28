// Multi-map registry. Game code never hardcodes a map: it looks one up here.
// An unknown id resolves to DEFAULT_MAP so an older client that predates a
// newly added map still joins a room instead of failing to start.
import { DUST2 } from './dust2.js';
import { MIRAGE } from './mirage.js';

export const MAP_REGISTRY = { de_dust2: DUST2, de_mirage: MIRAGE };
export const DEFAULT_MAP = 'de_dust2';

export function mapIds() { return Object.keys(MAP_REGISTRY); }

export function hasMap(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(MAP_REGISTRY, id);
}

export function resolveMapId(id) { return hasMap(id) ? id : DEFAULT_MAP; }

export function getMap(id) { return MAP_REGISTRY[resolveMapId(id)]; }

export function listMaps() { return mapIds().map(id => MAP_REGISTRY[id]); }

/** Whitelist a client-supplied map pool: drop unknown ids, keep order, dedupe.
 * Returns at least one id so a room always has a playable map. */
export function normalizeMapPool(candidates, fallbackPool = [DEFAULT_MAP]) {
  const seen = new Set();
  const pool = [];
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    if (!hasMap(raw) || seen.has(raw)) continue;
    seen.add(raw);
    pool.push(raw);
  }
  if (pool.length) return pool;
  for (const raw of Array.isArray(fallbackPool) ? fallbackPool : []) {
    if (hasMap(raw) && !seen.has(raw)) { seen.add(raw); pool.push(raw); }
  }
  return pool.length ? pool : [DEFAULT_MAP];
}
