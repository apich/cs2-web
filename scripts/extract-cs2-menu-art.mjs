// Extract CS2 main-menu art (map badge SVGs) from the user-installed game VPK.
// Read-only VPK extraction: the original <svg> subtree from the Source 2 DATA block.
// Usage: node scripts/extract-cs2-menu-art.mjs   (CS2_VPK env overrides the default path)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readVpkIndex } from '../tools/vpk-index.mjs';

const root = path.resolve(import.meta.dirname, '..');
const vpk = process.env.CS2_VPK || 'E:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive/game/csgo/pak01_dir.vpk';
const index = readVpkIndex(vpk);
const entries = new Map(index.entries.map(e => [e.path, e]));

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
function dataBlock(b) {
  for (let i = 0; i < b.readUInt32LE(12); i++) {
    const o = 16 + 12 * i;
    if (b.toString('ascii', o, o + 4) === 'DATA') {
      const start = o + 4 + b.readUInt32LE(o + 4);
      return b.subarray(start, start + b.readUInt32LE(o + 8));
    }
  }
  throw Error('No DATA block');
}

// Map badges shown on the play panel (图 2 地图组): playable + locked placeholders.
const MAPS = ['de_dust2', 'de_mirage', 'de_train', 'de_anubis', 'de_ancient', 'de_overpass', 'de_nuke', 'de_boulder', 'de_fachwerk', 'cs_shelter', 'cs_office', 'cs_italy', 'rush_001'];

const out = path.join(root, 'public/assets/map-icons');
fs.mkdirSync(out, { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex');
const assets = {};
for (const id of MAPS) {
  const source = `panorama/images/map_icons/map_icon_${id}.vsvg_c`;
  const original = read(source);
  const data = dataBlock(original);
  const start = data.indexOf('<svg'), end = data.lastIndexOf('</svg>');
  if (start < 0 || end < start) throw Error(`No SVG in ${source}`);
  const svg = data.subarray(start, end + 6);
  if (/<script\b|<foreignObject\b|(?:href|xlink:href)\s*=\s*["'](?:https?:|javascript:)/i.test(svg.toString())) throw Error(`Active SVG ${id}`);
  fs.writeFileSync(path.join(out, `map_icon_${id}.svg`), svg);
  assets[id] = { file: `assets/map-icons/map_icon_${id}.svg`, source, sourceSha256: sha(original), bytes: svg.length, sha256: sha(svg) };
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({
  source: 'User-installed Counter-Strike 2, Valve',
  sourceVpk: 'game/csgo/pak01_dir.vpk',
  extractedAt: new Date().toISOString(),
  method: 'Read-only VPK extraction; original SVG subtree from Source 2 DATA block. No redraw, rasterization or shape changes.',
  assets,
}, null, 2) + '\n');
console.log(JSON.stringify({ icons: Object.keys(assets).length, bytes: Object.values(assets).reduce((n, a) => n + a.bytes, 0) }));
