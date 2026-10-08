// Build a per-knife-type painted-finish spec list (the shape export.mjs bakes
// and append-knife-finishes.mjs merges). Painted finishes reuse the type's own
// composite_inputs, so every knife bakes against its own UV/material groups.
// Display names: localisation first, then the paint key's distinguishing tokens
// (CS2 localises every Doppler phase as one name, so phases are separated the
// same way disambiguate-skin-names.mjs does for the gun finishes).
//   node scripts/weapon-assets/build-knife-paints.mjs --knife=butterfly
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readVpkIndex } from '../../tools/vpk-index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const knife = process.argv.find(a => a.startsWith('--knife='))?.slice(8) || 'butterfly';
const weaponName = (knnife => {
  const chinese = { bayonet: '刺刀', bowie: '鲍伊猎刀', butterfly: '蝴蝶刀', canis: '求生匕首', cord: '系绳匕首', css: '海豹短刀', falchion: '弯刀', flip: '折叠刀', gut: '穿肠刀', karambit: '爪子刀', kukri: '廓尔喀刀', m9: 'M9 刺刀', navaja: '折刀', outdoor: '流浪者匕首', push: '暗影双匕', skeleton: '骷髅匕首', stiletto: '短剑', tactical: '猎杀者匕首', talon: '锯齿爪刀', ursus: '熊刀' };
  return chinese[knnife] || knnife;
})(knife);
const outArg = process.argv.find(a => a.startsWith('--out='))?.slice(6);
const dest = outArg || `scripts/weapon-assets/${knife}-catalog.json`;
const game = process.env.CS2_GAME_DIR || 'E:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const vpk = path.join(game, 'pak01_dir.vpk');
const entries = new Set(readVpkIndex(vpk).entries.map(e => e.path));
const { SKINS } = await import(pathToFileURL(path.join(root, 'shared/skins.js')).href);

const source = path.join(root, 'output/cs2-skins/source');
const translation = file => Object.fromEntries([...fs.readFileSync(file, 'utf8').matchAll(/"([^"\r\n]+)"\s+"([^\r\n]*)"/g)].map(m => [m[1].toLowerCase(), m[2]]));
const english = translation(path.join(source, 'resource/csgo_english.txt'));
const chinese = translation(path.join(source, 'resource/csgo_schinese.txt'));
const text = fs.readFileSync(path.join(source, 'scripts/items/items_game.txt'), 'utf8');
const tokens = [...text.matchAll(/"((?:\\.|[^"\\])*)"|([{}])|\/\/[^\r\n]*/g)].filter(m => m[1] !== undefined || m[2]).map(m => m[1] ?? m[2]);
let cursor = 0;
function object() { const result = {}; while (cursor < tokens.length) { const key = tokens[cursor++]; if (key === '}') return result; const value = tokens[cursor++]; result[key] = value === '{' ? object() : value; } throw Error('Unterminated block'); }
// items_game repeats paint_kits across collections; keep the lowest kit id per name.
const kits = new Map();
for (let index = 0; index < tokens.length - 1; index++) {
  if (tokens[index] !== 'paint_kits' || tokens[index + 1] !== '{') continue;
  cursor = index + 2;
  for (const [id, kit] of Object.entries(object())) {
    const known = kits.get(kit.name);
    kits.set(kit.name, !known || Number(id) < known.id ? { id: Number(id), ...kit } : known);
  }
}

const tokenOf = kit => (kit.description_tag || `#PaintKit_${kit.name}`).replace(/^#/, '').toLowerCase();
const prettify = key => String(key).replace(/_/g, ' ').replace(/(\D)(\d)$/, '$1 $2').replace(/(^|-)(\w)/g, (_, s, c) => c.toUpperCase());
const FAMILY = /^(am|aq|cu|gs|hy|so|sp)$/;
const GENERIC = new Set(['marbleized', 'glock', 'default', 'workshop']);
// Valve localises every Doppler phase as one name; CS2's own reflective tokens
// separate them. Single letters are paint-key disambiguators (…_b / …_gr).
const ZH_TOKEN = { ruby: '红宝石', sapphire: '蓝宝石', blackpearl: '黑珍珠', emerald: 'Emerald' };
function distinguishing(paint, englishDisplay) {
  let parts = String(paint).split('_').filter(Boolean);
  if (FAMILY.test(parts[0])) parts = parts.slice(1);
  parts = parts.filter(part => part.length > 1);
  while (parts.length && GENERIC.has(parts[parts.length - 1])) parts = parts.slice(0, -1);
  const display = String(englishDisplay || '').split(' | ').pop().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  while (display.length && parts.length && parts[0] === display[0]) { parts = parts.slice(1); display.shift(); }
  return parts.length ? parts.map(part => ZH_TOKEN[part] || prettify(part)).join(' ') : '';
}

// Inventory preview prefixes are the game's item names, which differ from the
// model folder for six knives (CS2 reuses older item entries).
const INVENTORY_PREFIX = { bayonet: 'weapon_bayonet', bowie: 'weapon_knife_survival_bowie', m9: 'weapon_knife_m9_bayonet', navaja: 'weapon_knife_gypsy_jackknife', talon: 'weapon_knife_widowmaker' };
const inventoryPrefix = INVENTORY_PREFIX[knife] || `weapon_knife_${knife}`;
const input = `weapons/models/knife/knife_${knife}/materials/composite_inputs/knife_${knife}_composite_inputs.vmat`;
const rawGLB = `artifacts/optional-extras/${knife}/${knife}.glb`;
if (!entries.has(input + '_c')) throw Error('Missing composite inputs ' + input);
if (!fs.existsSync(path.join(root, rawGLB))) throw Error('Missing staged raw model ' + rawGLB + ' — run export-extras.mjs first');

// Only finishes already baked for THIS knife type block a rerun; the same
// paintkit on another knife is a different skin with its own baked materials.
const family = skin => skin.animationFamily || 'knife';
const takenTypes = new Set(SKINS.filter(s => s.weapon === 'knife').map(s => family(s) + ':' + s.paintkit));
const taken = new Set(SKINS.map(s => s.id));
const candidates = [], skipped = [];
for (const entry of entries) {
  const match = entry.match(new RegExp(`^panorama/images/econ/default_generated/${inventoryPrefix}_([a-z0-9_]+)_light_png\\.vtex_c$`));
  if (!match) continue;
  const paint = match[1];
  const kit = kits.get(paint), paintkit = kit?.id;
  if (!kit || !Number.isFinite(paintkit)) { skipped.push(paint + ' (no paintkit)'); continue; }
  const material = `materials/models/weapons/customization/paints/vmats/${paint}.vmat_c`;
  if (!entries.has(material)) { skipped.push(paint + ' (no material)'); continue; }
  if (takenTypes.has(`${knife}:${paintkit}`)) { skipped.push(paint + ' (already in catalog)'); continue; }
  const key = tokenOf(kit);
  candidates.push({
    paintkit, paint, kit,
    base: chinese[key] || english[key] || prettify(paint),
    english: english[key] && english[key] !== '[english]' ? english[key] : prettify(paint),
    body: kit.use_legacy_model === '1' ? 'legacy' : 'hd',
    wearMin: Number(kit.wear_remap_min || 0), wearMax: Number(kit.wear_remap_max || 1),
    input, rawGLB,
  });
}
// Valve shares one display name across a finish family (every Doppler phase is
// just "多普勒"), so members of a shared name get their paint-key tokens back,
// exactly like disambiguate-skin-names.mjs does for the gun finishes.
const shared = new Map();
for (const candidate of candidates) shared.set(candidate.base, (shared.get(candidate.base) || 0) + 1);
const specs = [];
for (const candidate of candidates) {
  const suffix = (shared.get(candidate.base) || 0) > 1 ? distinguishing(candidate.paint, candidate.english) : '';
  const name = suffix && suffix !== candidate.base ? `${candidate.base} · ${suffix}` : candidate.base;
  // ids stay deterministic and unambiguous: the paint key with its family
  // prefix dropped (gamma phases keep theirs so they never collide).
  const stem = `${knife}-${candidate.paint.replace(/^(am|aq|cu|gs|hy|so|sp)_/, '').replace(/_/g, '-')}`;
  let file = stem;
  if (taken.has(file)) file = `${stem}-${candidate.paintkit}`;
  if (taken.has(file)) throw Error('Unresolvable id collision: ' + file);
  taken.add(file);
  specs.push({
    paintkit: candidate.paintkit, paint: candidate.paint, name,
    englishName: `${weaponName} | ${candidate.english}`,
    body: candidate.body, wearMin: candidate.wearMin, wearMax: candidate.wearMax,
    material: `materials/models/weapons/customization/paints/vmats/${candidate.paint}.vmat_c`,
    inventory: `${inventoryPrefix}_${candidate.paint}`,
    preview: `previews/${file}.webp`,
    id: knife, weapon: 'knife', file, input, rawGLB,
  });
}
fs.writeFileSync(path.join(root, dest), JSON.stringify(specs, null, 2) + '\n');
console.log(`${knife}: ${specs.length} painted finishes -> ${dest}`);
if (skipped.length) console.log('skipped ' + skipped.length + ': ' + skipped.join(', '));
for (const spec of specs) console.log(`  ${spec.file.padEnd(32)} ${spec.name.padEnd(18)} #${spec.paintkit}`);
