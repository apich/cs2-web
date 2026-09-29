// Lists every selectable agent in items_game.txt with its item id, name and model,
// de-duplicated by model and excluding map-based defaults.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const items=fs.readFileSync(path.join(root,'output/cs2-skins/source/scripts/items/items_game.txt'),'utf8');

const lines=items.split(/\r?\n/);
const english=new Map(),chinese=new Map();
for(const [map,file] of [[english,'csgo_english.txt'],[chinese,'csgo_schinese.txt']]){
  for(const line of fs.readFileSync(path.join(root,'output/cs2-skins/source/resource',file),'utf8').split(/\r?\n/)){
    const m=line.match(/^[\t ]*"([^"]+)"[\t ]+"((?:[^"\\]|\\.)*)"/);
    if(m)map.set(m[1].toLowerCase(),m[2]);
  }
}

// A node opens with `"key"` then `{` on its own line and closes with `}` at the
// same indent; fields are `"key"\t\t"value"`. Item ids are numeric.
const byModel=new Map();
for(let i=0;i<lines.length;i++){
  const key=lines[i].match(/^[\t ]*"(\d+)"\s*$/);
  if(!key||lines[i+1]?.trim()!=='{')continue;
  const indent=lines[i].match(/^[\t ]*/)[0].length;
  const fields={};
  for(let j=i+2;j<lines.length;j++){
    const lineIndent=lines[j].match(/^[\t ]*/)[0].length;
    if(lineIndent<=indent&&lines[j].trim()==='}')break;
    const v=lines[j].match(/^[\t ]*"([^"]+)"[\t ]+"((?:[^"\\]|\\.)*)"/);
    if(v)fields[v[1]]=v[2];
  }
  const model=fields.model_player;
  if(!model||!model.startsWith('agents/models/'))continue;
  const nameKey=(fields.item_name||'').replace(/^#/,'').toLowerCase();
  const name=chinese.get(nameKey)||english.get(nameKey)||fields.item_name||key[1];
  const rel=model.replace(/^agents\/models\//,'').replace(/\.vmdl$/,'');
  // Several item ids can point at one model; keep the first that has a name.
  if(!byModel.has(rel))byModel.set(rel,{itemId:key[1],model:rel,name});
}

const rows=[...byModel.values()].sort((a,b)=>a.model.localeCompare(b.model));
console.log('去重后探员数:',rows.length);
console.log();
console.log('id'.padEnd(8),'model'.padEnd(34),'name');
for(const r of rows)console.log(r.itemId.padEnd(8),r.model.padEnd(34),r.name);
