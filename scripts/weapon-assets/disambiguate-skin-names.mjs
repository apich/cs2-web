// Disambiguates finishes that share a display name inside one weapon. CS2
// localises every Doppler phase as just "Doppler", which makes them
// indistinguishable in the warehouse grid, so the distinguishing part of the
// paint key is appended. Run with --write to update shared/skins.js.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const skinsPath=path.join(root,'shared/skins.js');
const {SKINS}=await import(pathToFileURL(skinsPath).href);
const write=process.argv.includes('--write');

// Authoritative paint keys, keyed by paintkit id.
const itemsGame=fs.readFileSync(path.join(root,'output/cs2-skins/source/scripts/items/items_game.txt'),'utf8');
const tokens=[...itemsGame.matchAll(/"((?:\\.|[^"\\])*)"|([{}])|\/\/[^\r\n]*/g)].filter(m=>m[1]!==undefined||m[2]).map(m=>m[1]??m[2]);
let cursor=0;
function object(){const result={};while(cursor<tokens.length){const key=tokens[cursor++];if(key==='}')return result;const value=tokens[cursor++];result[key]=value==='{'?object():value;}throw Error('Unterminated block');}
const kits={};
for(let index=0;index<tokens.length-1;index++)if(tokens[index]==='paint_kits'&&tokens[index+1]==='{'){
  cursor=index+2;const section=object();for(const [id,kit]of Object.entries(section))kits[id]={...kits[id],...kit};index=cursor-1;
}

// Valve's finish families share a short prefix token; drop it along with the
// tokens that spell the finish name or a generic material qualifier.
const FAMILY=/^(am|aq|cu|gs|hy|so|sp)$/;
const GENERIC=new Set(['marbleized','glock','default','workshop']);
const title=token=>token.replace(/(\D)(\d)$/,'$1 $2').replace(/(^|-)(\w)/g,(_,s,c)=>c.toUpperCase());

// Returns the raw tokens that distinguish a finish from its display name.
function distinguishingTokens(paint,englishName){
  let parts=String(paint).split('_').filter(Boolean);
  if(FAMILY.test(parts[0]))parts=parts.slice(1);
  while(parts.length&&GENERIC.has(parts[parts.length-1]))parts=parts.slice(0,-1);
  const display=String(englishName||'').split(' | ').pop().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  while(display.length&&parts.length&&parts[0]===display[0]){parts=parts.slice(1);display.shift();}
  return parts;
}

const groups=new Map();
for(const skin of SKINS){
  const key=skin.weapon+' '+skin.name;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(skin);
}

const proposals=[];
for(const [key,list] of groups){
  if(list.length<2)continue;
  const weapon=key.slice(0,key.indexOf(' '));
  const labelled=list.map(skin=>{
    const paint=kits[String(skin.paintkit)]?.name;
    return{skin,tokens:paint?distinguishingTokens(paint,skin.englishName):[]};
  });
  // A token shared by the whole group tells the player nothing.
  const isShared=token=>labelled.every(({tokens})=>tokens.includes(token));
  for(const entry of labelled)entry.tokens=entry.tokens.filter(t=>!isShared(t));
  const labels=labelled.map(({tokens})=>tokens.map(title).join(' '));
  // Only use labels when every member ends up with a distinct, non-empty one.
  const usable=labels.every(l=>l)&&new Set(labels).size===labels.length;
  labelled.forEach((entry,index)=>proposals.push({skin:entry.skin,weapon,suffix:usable?labels[index]:String(entry.skin.paintkit)}));
}
if(!proposals.length){console.log('No display-name collisions.');process.exit(0);}
console.log('提议的名称:');
for(const {skin,weapon,suffix} of proposals)
  console.log(`  ${weapon.padEnd(9)} ${skin.name}  ->  ${skin.name} · ${suffix}   (${skin.id})`);

if(!write){console.log('\n dry run; pass --write to apply');process.exit(0);}

let source=fs.readFileSync(skinsPath,'utf8');
// The original entries are pretty-printed with a space after the colon and the
// generated ones are compact; accept both by matching the field's own text.
const fieldPattern=(name,value)=>{
  const escaped=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`"${name}":\\s*"${escaped}"`);
};
for(const {skin,suffix} of proposals){
  const renamed=skin.name+' · '+suffix;
  const at=source.search(fieldPattern('id',skin.id));
  if(at<0)throw Error('Entry not found: '+skin.id);
  const entryEnd=source.indexOf('}',at);
  const within=source.slice(at,entryEnd);
  const match=within.match(fieldPattern('name',skin.name));
  if(!match)throw Error('Name field not found for '+skin.id);
  const absolute=at+match.index;
  source=source.slice(0,absolute)+`"name": ${JSON.stringify(renamed)}`+source.slice(absolute+match[0].length);
}
fs.writeFileSync(skinsPath,source);
console.log(`\nRenamed ${proposals.length} finishes.`);
console.log('注意：shared/skins.js 同时被客户端与服务端读取，Node 会缓存模块。');
console.log('     请重启 node server/index.js，否则运行中的服务端仍持旧目录。');
