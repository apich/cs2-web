// Reports which damaged display names are recoverable from the authoritative
// items_game paint key plus CS2's own localisation tables.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {SKINS}=await import(pathToFileURL(path.join(root,'shared/skins.js')).href);

function localization(file){
  const map=new Map();
  for(const m of fs.readFileSync(file,'utf8').matchAll(/"([^"\r\n]+)"\s+"([^"\r\n]*)"/g))map.set(m[1].toLowerCase(),m[2]);
  return map;
}
const english=localization(path.join(root,'output/cs2-skins/source/resource/csgo_english.txt'));
const chinese=localization(path.join(root,'output/cs2-skins/source/resource/csgo_schinese.txt'));

const items=fs.readFileSync(path.join(root,'output/cs2-skins/source/scripts/items/items_game.txt'),'utf8');
const tokens=[...items.matchAll(/"((?:\\.|[^"\\])*)"|([{}])|\/\/[^\r\n]*/g)].filter(m=>m[1]!==undefined||m[2]).map(m=>m[1]??m[2]);
let cursor=0;
function object(){const result={};while(cursor<tokens.length){const key=tokens[cursor++];if(key==='}')return result;const value=tokens[cursor++];result[key]=value==='{'?object():value;}throw Error('Unterminated block');}
const kits={};
for(let index=0;index<tokens.length-1;index++)if(tokens[index]==='paint_kits'&&tokens[index+1]==='{'){
  cursor=index+2;const section=object();for(const [id,kit]of Object.entries(section))kits[id]={...kits[id],...kit};index=cursor-1;
}

function lookup(kit){
  for(const key of [kit.description_tag,`#PaintKit_${kit.name}_Tag`,`#PaintKit_${kit.name}`]){
    if(!key)continue;
    const value=chinese.get(key.toLowerCase())||english.get(key.toLowerCase());
    if(value&&value!=='[english]')return value;
  }
  return null;
}

const damaged=SKINS.filter(s=>s.model.includes('cs2-full')&&(/^#?paintkit/i.test(s.name)||/paintkit/i.test(s.id)));
let named=0;
const missing=[];
for(const skin of damaged){
  const kit=kits[String(skin.paintkit)];
  const name=kit?lookup(kit):null;
  if(name)named++;else missing.push(`${skin.id} (paintkit ${skin.paintkit})`);
}
console.log(`损坏名称条目: ${damaged.length}`);
console.log(`可从本地化取回真名: ${named}`);
console.log(`本地化里也无名: ${missing.length}`);
if(missing.length){console.log('\n仍缺名的样例:');for(const m of missing.slice(0,8))console.log('  '+m);}
console.log('\n取回成功的样例:');
for(const skin of damaged.slice(0,5)){
  const kit=kits[String(skin.paintkit)];
  console.log(`  ${skin.id} -> ${lookup(kit)}`);
}
