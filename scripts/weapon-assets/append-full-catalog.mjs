// Appends the baked full-catalog finishes to shared/skins.js as non-default
// entries. Existing entries are left byte-identical; the script is idempotent
// and refuses to duplicate an id.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const hash=f=>createHash('sha256').update(fs.readFileSync(path.join(root,'public',f))).digest('hex');
const size=f=>fs.statSync(path.join(root,'public',f)).size;

const catalog=read('scripts/weapon-assets/full-catalog.json');
const manifest=read('public/assets/weapons/cs2-full/full-manifest.json');
const reports=new Map(manifest.models.map(m=>[m.file.replace(/\.glb$/,''),m]));

const skinsPath=path.join(root,'shared/skins.js');
const source=fs.readFileSync(skinsPath,'utf8');
const {SKINS}=await import(pathToFileURL(skinsPath).href);
const taken=new Set(SKINS.map(s=>s.id));

const entries=[],skipped=[];
for(const spec of catalog){
  const report=reports.get(spec.file);
  // Finishes the baker could not produce are left out of the catalog rather
  // than failing the whole import.
  if(!report){skipped.push(spec.file);continue;}
  if(taken.has(spec.file))continue;
  const model=`assets/weapons/cs2-full/${spec.file}.glb`;
  const preview=`assets/weapons/cs2-full/${spec.preview}`;
  entries.push({
    id:spec.file,weapon:spec.weapon,name:spec.chineseName,englishName:spec.name,
    model,preview,bytes:size(model),sha256:hash(model),isDefault:false,
    paintkit:spec.paintkit,previewBytes:size(preview),previewSha256:hash(preview),
  });
  taken.add(spec.file);
}
if(!entries.length){console.log('No new entries to add.');process.exit(0);}

// Insert before the array literal's closing bracket. The script has already
// added the trailing comma to the last existing entry, so each new entry leads
// with its own comma to match the file's one-entry-per-object style.
const marker='\n].map(skin => Object.freeze(skin)));';
const at=source.indexOf(marker);
if(at<0)throw Error('Could not locate the SKINS array terminator');
const block=entries.map(e=>'  '+JSON.stringify(e,null,2).replace(/\n/g,'\n  ')+',').join('\n');
fs.writeFileSync(skinsPath,source.slice(0,at)+'\n'+block+source.slice(at));
const total=SKINS.length+entries.length;
console.log(`Added ${entries.length} finishes; SKINS now has ${total} entries.`);
if(skipped.length)console.log(`Skipped ${skipped.length} unbaked finishes: ${skipped.join(', ')}`);
const perWeapon=entries.reduce((a,e)=>(a[e.weapon]=(a[e.weapon]||0)+1,a),{});
console.log('新增分布:',JSON.stringify(perWeapon));
console.log(`shared/skins.js: ${(source.length/1024).toFixed(1)} KiB -> ${(fs.statSync(skinsPath).size/1048576).toFixed(2)} MiB`);
console.log('注意：shared/skins.js 同时被客户端与服务端读取，Node 会缓存模块。');
console.log('     请重启 node server/index.js，否则新皮肤会被 equipSkin 拒绝并回退到默认款。');
