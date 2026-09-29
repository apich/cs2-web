// Rewrites damaged display names in shared/skins.js from CS2's own localisation.
//
// The earlier catalog run parsed csgo_*.txt with a global regex, which silently
// dropped keys: a single line's value can contain literal backslash-escaped
// quotes, and the line-oriented KV format is what the game's own loader reads.
// Parsing line by line recovers the authoritative "#PaintKit_<key>_Tag" name.
// Ids and baked GLBs are left untouched — only the display string changes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const skinsPath=path.join(root,'shared/skins.js');

function localization(file){
  // Line-oriented: CS2 writes `"key"\t\t\t"value"`. A value may span nothing and
  // may hold escaped quotes, so match the key and the rest of the line as value.
  const map=new Map();
  for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    const m=line.match(/^[\t ]*"([^"]+)"[\t ]+"((?:[^"\\]|\\.)*)"/);
    if(m)map.set(m[1].toLowerCase(),m[2]);
  }
  return map;
}
const english=localization(path.join(root,'output/cs2-skins/source/resource/csgo_english.txt'));
const chinese=localization(path.join(root,'output/cs2-skins/source/resource/csgo_schinese.txt'));

// items_game.txt keys a finish by paintkit id -> paint key.
const items=fs.readFileSync(path.join(root,'output/cs2-skins/source/scripts/items/items_game.txt'),'utf8');
const tokens=[...items.matchAll(/"((?:\\.|[^"\\])*)"|([{}])|\/\/[^\r\n]*/g)].filter(m=>m[1]!==undefined||m[2]).map(m=>m[1]??m[2]);
let cursor=0;
function object(){const result={};while(cursor<tokens.length){const key=tokens[cursor++];if(key==='}')return result;const value=tokens[cursor++];result[key]=value==='{'?object():value;}throw Error('Unterminated KeyValues block');}
const kits={};
for(let index=0;index<tokens.length-1;index++)if(tokens[index]==='paint_kits'&&tokens[index+1]==='{'){
  cursor=index+2;const section=object();for(const [id,kit]of Object.entries(section))kits[id]={...kits[id],...kit};index=cursor-1;
}

function displayName(kit){
  for(const key of [kit.description_tag,`#PaintKit_${kit.name}_Tag`,`#PaintKit_${kit.name}`]){
    if(!key)continue;
    const value=chinese.get(key.replace(/^#/,'').toLowerCase())||chinese.get(key.toLowerCase());
    if(value)return value;
  }
  for(const key of [`#PaintKit_${kit.name}_Tag`,`#PaintKit_${kit.name}`]){
    const value=english.get(key.replace(/^#/,'').toLowerCase())||english.get(key.toLowerCase());
    if(value&&value!=='[english]')return value;
  }
  return null;
}

const {SKINS}=await import(pathToFileURL(skinsPath).href);
const write=process.argv.includes('--write');

// Only entries whose name still carries an internal token, or whose id reveals
// one, are rewritten. Deliberately leaves the audited 24 defaults alone.
const damaged=SKINS.filter(s=>/^#?PaintKit[_ ]/i.test(s.name));
if(!damaged.length){console.log('没有损坏的名称。');process.exit(0);}

const proposals=[];
for(const skin of damaged){
  const kit=kits[String(skin.paintkit)];
  const name=kit?displayName(kit):null;
  proposals.push({skin,name:skin.name,next:name});
}

const unresolved=proposals.filter(p=>!p.next);
console.log(`待修正名称: ${proposals.length}`);
console.log(`可从本地化取回: ${proposals.length-unresolved.length}`);
if(unresolved.length){
  console.log(`\n仍无名的 ${unresolved.length} 款(保留原名):`);
  for(const p of unresolved.slice(0,10))console.log(`  ${p.skin.id} -> ${p.skin.name}`);
}
console.log('\n样例:');
for(const p of proposals.filter(p=>p.next).slice(0,8))
  console.log(`  ${p.skin.name}  ->  ${p.next}`);

if(!write){console.log('\n dry run; 加 --write 应用。');process.exit(0);}

// Patch the name field in place. Handles both the pretty-printed original
// entries (`"name": "x"`) and the compact generated ones (`"name":"x"`).
let source=fs.readFileSync(skinsPath,'utf8');
const fieldPattern=(field,value)=>{
  const escaped=String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`"${field}":\\s*"${escaped}"`);
};
let changed=0;
for(const {skin,next} of proposals){
  if(!next)continue;
  const at=source.search(fieldPattern('id',skin.id));
  if(at<0)throw Error('Entry not found: '+skin.id);
  const entryEnd=source.indexOf('}',at);
  const match=source.slice(at,entryEnd).match(fieldPattern('name',skin.name));
  if(!match)throw Error('Name field not found for '+skin.id);
  const absolute=at+match.index;
  source=source.slice(0,absolute)+`"name": ${JSON.stringify(next)}`+source.slice(absolute+match[0].length);
  changed++;
}
fs.writeFileSync(skinsPath,source);
console.log(`\n已修正 ${changed} 个名称。`);
