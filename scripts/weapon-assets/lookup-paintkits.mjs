// Prints the authoritative paintkit names for finishes that share a display name.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const text=fs.readFileSync(path.join(root,'output/cs2-skins/source/scripts/items/items_game.txt'),'utf8');
const tokens=[...text.matchAll(/"((?:\\.|[^"\\])*)"|([{}])|\/\/[^\r\n]*/g)].filter(m=>m[1]!==undefined||m[2]).map(m=>m[1]??m[2]);
let cursor=0;
function object(){const result={};while(cursor<tokens.length){const key=tokens[cursor++];if(key==='}')return result;const value=tokens[cursor++];result[key]=value==='{'?object():value;}throw Error('Unterminated block');}
const kits={};
for(let index=0;index<tokens.length-1;index++)if(tokens[index]==='paint_kits'&&tokens[index+1]==='{'){
  cursor=index+2;const section=object();for(const [id,kit]of Object.entries(section))kits[id]={...kits[id],...kit};index=cursor-1;
}
const english=Object.fromEntries([...fs.readFileSync(path.join(root,'output/cs2-skins/source/resource/csgo_english.txt'),'utf8').matchAll(/"([^"\r\n]+)"\s+"([^"\r\n]*)"/g)].map(m=>[m[1].toLowerCase(),m[2]]));
const chinese=Object.fromEntries([...fs.readFileSync(path.join(root,'output/cs2-skins/source/resource/csgo_schinese.txt'),'utf8').matchAll(/"([^"\r\n]+)"\s+"([^"\r\n]*)"/g)].map(m=>[m[1].toLowerCase(),m[2]]));

const ids=process.argv.slice(2);
for(const id of ids){
  const kit=kits[id];
  if(!kit){console.log(id,'(不在 paint_kits)');continue;}
  const token=(kit.description_tag||'').replace(/^#/,'').toLowerCase();
  console.log(id.padStart(4),'| name='+String(kit.name).padEnd(26),'| EN='+String(english[token]).padEnd(24),'| CN='+String(chinese[token]));
}
