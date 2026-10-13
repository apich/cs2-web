// Extract CS2's own map screenshots (panorama/images/map_icons/screenshots/1080p)
// into a WebP pool used by the homepage backdrop and by any map that has no
// capture of its own. Read-only: the VPK is opened for reading and never written.
//
// Dust II's de_dust2_1_png.png came from the very same 1080p vtex (verified
// pixel-identical after an RGB flatten), so these are the game's real loading
// images rather than redraws.
//
// Usage: node scripts/extract-map-backdrops.mjs [--force]
//   CS2_VPK / CS2_GAME_DIR override the default install paths.
//
// The output lives in public/assets, which the asset lock does not cover, so a
// fresh `npm run assets:fetch` elsewhere will not restore it. The homepage
// falls back to its plain shade when a pool file is missing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { readVpkIndex } from '../tools/vpk-index.mjs';

const root = path.resolve(import.meta.dirname, '..');
const game = process.env.CS2_GAME_DIR || 'E:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const vpk = process.env.CS2_VPK || path.join(game, 'pak01_dir.vpk');
const cli = path.join(root, 'tools/source2viewer/Source2Viewer-CLI.exe');
const stage = path.join(root, 'artifacts/map-backdrop-export');
const out = path.join(root, 'public/assets/map-backgrounds');
const lockPath = path.join(root, 'artifacts/s2v-export.lock');

// Pool shown on the homepage. `shot` is the screenshot index inside the 1080p
// folder; null picks the map's base screenshot (maps with a single image only
// ship that one). Keep in sync with POOL in client/menu-backdrop.js.
const SHOTS = [
  { map: 'de_dust2', shot: '1' },
  { map: 'de_dust2', shot: '2' },
  { map: 'de_mirage', shot: '1' },
  { map: 'de_mirage', shot: '2' },
  { map: 'de_inferno', shot: '1' },
  { map: 'de_nuke', shot: '1' },
  { map: 'de_train', shot: '1' },
  { map: 'de_overpass', shot: '1' },
  { map: 'de_anubis', shot: '1' },
  { map: 'de_ancient', shot: '1' },
  { map: 'de_vertigo', shot: '1' },
  { map: 'de_cache', shot: '1' },
  { map: 'cs_italy', shot: '0' },
  { map: 'cs_office', shot: '1' },
  { map: 'de_boulder', shot: null },
  { map: 'de_fachwerk', shot: null },
  { map: 'cs_shelter', shot: null },
  { map: 'rush_001', shot: '1' },
];

// The menu photo is blurred and darkened behind a shade, so 1600px wide keeps
// every file under ~250 KiB with no visible loss on a 4K display.
const WIDTH = 1600;
const QUALITY = 78;

const index = readVpkIndex(vpk);
const entries = new Map(index.entries.map(e => [e.path, e]));
const sha = buffer => createHash('sha256').update(buffer).digest('hex');

function read(resource) {
  const e = entries.get(resource);
  if (!e) throw Error(`Missing ${resource}`);
  if (e.preloadBytes) throw Error(`Unexpected preload ${resource}`);
  const archive = e.archiveIndex === 0x7fff ? vpk : vpk.replace('_dir.vpk', `_${String(e.archiveIndex).padStart(3, '0')}.vpk`);
  const fd = fs.openSync(archive, 'r');
  const b = Buffer.alloc(e.length);
  try { fs.readSync(fd, b, 0, b.length, e.offset + (e.archiveIndex === 0x7fff ? index.headerSize + index.treeSize : 0)); }
  finally { fs.closeSync(fd); }
  return b;
}

function exportVtex(resource, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const log = fs.openSync(file + '.log', 'w');
  const args = ['-i', vpk, '-f', resource, '-o', file, '-d', '--game', path.join(game, 'gameinfo.gi')];
  const result = spawnSync(cli, args, { windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, TEMP: stage, TMP: stage }, timeout: 600000 });
  fs.closeSync(log);
  if (result.status || result.error) throw Error(`Export ${resource} failed (${result.status || result.error})`);
}

async function main() {
  const force = process.argv.includes('--force');
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, task: 'map-backdrops', startedAt: new Date().toISOString() }));
  try {
    for (const { map, shot } of SHOTS) {
      const stem = shot ? `${map}_${shot}` : map;
      const file = `assets/map-backgrounds/${stem}.webp`;
      const target = path.join(root, 'public', file);
      const source = `panorama/images/map_icons/screenshots/1080p/${stem}_png.vtex_c`;
      if (!entries.has(source)) throw Error(`No 1080p screenshot for ${stem}`);
      if (!force && fs.existsSync(target)) { console.log(`existing ${file}`); continue; }
      const png = path.join(stage, `${stem}.png`);
      exportVtex(source, png);
      const info = await sharp(png).metadata();
      await sharp(png).resize({ width: Math.min(WIDTH, info.width) }).webp({ quality: QUALITY }).toFile(target);
      console.log(`${file} ${(fs.statSync(target).size / 1024) | 0} KiB`);
    }
  } finally {
    fs.unlinkSync(lockPath);
  }
  // Provenance for the whole pool, re-read every run so a --force run cannot
  // leave the manifest describing a subset.
  const pool = [];
  for (const { map, shot } of SHOTS) {
    const stem = shot ? `${map}_${shot}` : map;
    const file = `assets/map-backgrounds/${stem}.webp`;
    const source = `panorama/images/map_icons/screenshots/1080p/${stem}_png.vtex_c`;
    const webp = fs.readFileSync(path.join(root, 'public', file));
    const info = await sharp(path.join(root, 'public', file)).metadata();
    pool.push({ map, file, width: info.width, height: info.height, bytes: webp.length, sha256: sha(webp), source, sourceSha256: sha(read(source)) });
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({
    source: 'User-installed Counter-Strike 2, Valve',
    sourceVpk: 'game/csgo/pak01_dir.vpk',
    extractedAt: new Date().toISOString(),
    method: `Read-only VPK extraction of the 1080p panorama screenshot, resized to ${WIDTH}px wide and re-encoded as WebP q${QUALITY}. No redraw.`,
    pool,
  }, null, 2) + '\n');
  console.log(`Pool: ${pool.length} files, ${(pool.reduce((s, a) => s + a.bytes, 0) / 1048576).toFixed(1)} MiB`);
  checkClientPool(pool);
}

// The client keeps its own copy of the list, so a SHOTS edit that forgets
// client/menu-backdrop.js would silently drop an image from the homepage.
function checkClientPool(pool) {
  const client = fs.readFileSync(path.join(root, 'client/menu-backdrop.js'), 'utf8');
  const listed = [...client.matchAll(/'(assets\/map-backgrounds\/[^']+\.webp)'/g)].map(m => m[1]);
  const expected = pool.map(entry => entry.file);
  const missing = listed.filter(file => !fs.existsSync(path.join(root, 'public', file)));
  const stale = expected.filter(file => !listed.includes(file));
  const extra = listed.filter(file => !expected.includes(file));
  if (missing.length || stale.length || extra.length) {
    throw Error(`client/menu-backdrop.js is out of sync — missing files: ${missing}, not extracted: ${stale}, unknown: ${extra}`);
  }
  console.log(`client/menu-backdrop.js matches: ${listed.length} entries`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
