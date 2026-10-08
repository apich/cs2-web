// Appends one knife type's baked painted finishes to shared/skins.js.
//   node scripts/weapon-assets/append-knife-finishes.mjs --knife=butterfly
// Painted knives keep the weapon's animationFamily and point at the vanilla
// type's shared viewmodel animation bundle, so first-person grips and inspect
// clips stay identical to the vanilla model of that knife.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const knife = process.argv.find(a => a.startsWith('--knife='))?.slice(8) || 'butterfly';
const specs = JSON.parse(fs.readFileSync(path.join(root, `scripts/weapon-assets/${knife}-catalog.json`), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, `public/assets/weapons/cs2-full/manifest-${knife}.json`), 'utf8'));
const reports = new Map(manifest.models.map(model => [model.file.replace(/\.glb$/, ''), model]));

const skinsPath = path.join(root, 'shared/skins.js');
const source = fs.readFileSync(skinsPath, 'utf8');
const { SKINS, getSkin } = await import(pathToFileURL(skinsPath).href);
const taken = new Set(SKINS.map(s => s.id));
const animation = getSkin(`${knife}-vanilla`)?.animation;
if (!animation) throw Error(`Missing ${knife}-vanilla animation bundle; run the vanilla knife pipeline first`);

const entries = [], failures = [];
for (const spec of specs) {
  const report = reports.get(spec.file);
  if (!report) { failures.push(spec.file); continue; }
  if (taken.has(spec.file)) continue;
  taken.add(spec.file);
  entries.push({
    id: spec.file, weapon: 'knife', name: spec.name, englishName: spec.englishName,
    model: `assets/weapons/cs2-full/${spec.file}.glb`,
    preview: `assets/weapons/cs2-full/${spec.preview}`,
    bytes: report.bytes, sha256: report.sha256, isDefault: false,
    paintkit: spec.paintkit, previewBytes: report.preview.bytes, previewSha256: report.preview.sha256,
    animationFamily: knife, animation, downloadRequired: true,
    condition: 'Factory New', wear: 0,
  });
}
if (!entries.length) { console.log('No new finishes to add.'); process.exit(0); }

const marker = '\n].map(skin => Object.freeze(skin)));';
const at = source.indexOf(marker);
if (at < 0) throw Error('Could not locate the SKINS array terminator');
const block = entries.map(e => '  ' + JSON.stringify(e, null, 2).replace(/\n/g, '\n  ') + ',').join('\n');
fs.writeFileSync(skinsPath, source.slice(0, at) + '\n' + block + source.slice(at));
console.log(`Added ${entries.length} ${knife} finishes; SKINS now has ${SKINS.length + entries.length} entries.`);
if (failures.length) console.log(`Skipped unbaked: ${failures.join(', ')}`);
console.log('注意：shared/skins.js 同时被客户端与服务端读取，Node 会缓存模块。');
console.log('     请重启 node server/index.js，否则运行中的服务端仍持旧目录。');
