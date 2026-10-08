// Bakes every remaining knife type's painted finishes in one pass.
//   node scripts/weapon-assets/bake-knife-batch.mjs [--knives=m9,falchion]
// Each type runs the same four steps as the butterfly pilot and is independent:
// a failure (missing material, zero previews) skips that type and the batch
// continues. Idempotent — types already in shared/skins.js bake out to no specs.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = name => path.join(root, 'scripts/weapon-assets', name);
const ALL = ['bayonet', 'bowie', 'canis', 'cord', 'css', 'falchion', 'flip', 'gut', 'kukri', 'm9', 'navaja', 'outdoor', 'push', 'skeleton', 'stiletto', 'tactical', 'talon', 'ursus'];
const knives = process.argv.find(a => a.startsWith('--knives='))?.slice(9).split(',') || ALL;
const steps = knife => [
  ['spec', ['build-knife-paints.mjs', `--knife=${knife}`]],
  ['extract', ['extract-finishes.mjs', `--specs=${knife}-catalog.json`]],
  ['bake', ['bake-finishes.mjs', `--specs=${knife}-catalog.json`, '--out=assets/weapons/cs2-full', `--manifest=manifest-${knife}.json`]],
  ['append', ['append-knife-finishes.mjs', `--knife=${knife}`]],
];

const summary = [];
for (const knife of knives) {
  const failed = [];
  for (const [name, [scriptName, ...args]] of steps(knife)) {
    console.log(`\n===== ${knife} · ${name} =====`);
    const result = spawnSync(process.execPath, [script(scriptName), ...args], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) { failed.push(name + ' exit ' + result.status); break; }
  }
  let count = '?';
  try {
    const specs = JSON.parse(fs.readFileSync(path.join(root, `scripts/weapon-assets/${knife}-catalog.json`), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, `public/assets/weapons/cs2-full/manifest-${knife}.json`), 'utf8'));
    count = `${manifest.models.length}/${specs.length}`;
  } catch { /* manifest/specs missing — reported via failed steps */ }
  summary.push({ knife, baked: count, failed: failed.join(' ') || '—' });
}
console.log('\n===== knife batch summary =====');
for (const row of summary) console.log(`${row.knife.padEnd(12)} baked ${row.baked.padEnd(9)} ${row.failed}`);
