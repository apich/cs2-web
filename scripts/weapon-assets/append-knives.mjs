// Appends the packed vanilla knife types (artifacts/optional-extras/knife-catalog.json)
// to shared/skins.js as non-default entries. Idempotent: existing ids are kept
// byte-identical and never duplicated.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'artifacts/optional-extras/knife-catalog.json'),'utf8'));
const skinsPath=path.join(root,'shared/skins.js');
const source=fs.readFileSync(skinsPath,'utf8');
const {SKINS}=await import(pathToFileURL(skinsPath).href);
const taken=new Set(SKINS.map(s=>s.id));

const entries=catalog.filter(row=>{
  if(taken.has(row.id))return false;
  for(const file of [row.model,row.preview,row.animation.model]){
    const full=path.join(root,'public',file);
    if(!fs.existsSync(full))throw Error('Missing packed asset '+file);
  }
  taken.add(row.id);
  return true;
});
if(!entries.length){console.log('No new knife entries to add.');process.exit(0);}

const marker='\n].map(skin => Object.freeze(skin)));';
const at=source.indexOf(marker);
if(at<0)throw Error('Could not locate the SKINS array terminator');
const block=entries.map(e=>'  '+JSON.stringify(e,null,2).replace(/\n/g,'\n  ')+',').join('\n');
fs.writeFileSync(skinsPath,source.slice(0,at)+'\n'+block+source.slice(at));
console.log(`Added ${entries.length} knife types; SKINS now has ${SKINS.length+entries.length} entries.`);
console.log(entries.map(e=>e.id).join(', '));
console.log('注意：shared/skins.js 同时被客户端与服务端读取，Node 会缓存模块。');
console.log('     请重启 node server/index.js，否则新刀型会被 equipSkin 拒绝并回退到默认款。');
