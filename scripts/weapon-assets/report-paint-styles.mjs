// Summarises the baked catalog by Valve paint style, so finishes that depend on
// optional source data (the anodized-airbrushed position map in particular) can
// be accounted for honestly.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {SKINS}=await import(pathToFileURL(path.join(root,'shared/skins.js')).href);

const itemsGame=fs.readFileSync(path.join(root,'output/cs2-skins/source/scripts/items/items_game.txt'),'utf8');
const tokens=[...itemsGame.matchAll(/"((?:\\.|[^"\\])*)"|([{}])|\/\/[^\r\n]*/g)].filter(m=>m[1]!==undefined||m[2]).map(m=>m[1]??m[2]);
let cursor=0;
function object(){const result={};while(cursor<tokens.length){const key=tokens[cursor++];if(key==='}')return result;const value=tokens[cursor++];result[key]=value==='{'?object():value;}throw Error('Unterminated KeyValues block');}
const kits={};
for(let index=0;index<tokens.length-1;index++)if(tokens[index]==='paint_kits'&&tokens[index+1]==='{'){
  cursor=index+2;const section=object();for(const [id,kit]of Object.entries(section))kits[id]={...kits[id],...kit};index=cursor-1;
}

const paintDir=path.join(root,'artifacts/weapon-expansion/source/materials/models/weapons/customization/paints/vmats');
const counts={},styleFive=[],noPaintKey=[];
for(const skin of SKINS){
  const key=kits[String(skin.paintkit)]?.name;
  if(!key){noPaintKey.push(skin.id);continue;}
  const vmat=path.join(paintDir,key+'.vmat');
  if(!fs.existsSync(vmat)){counts['(材质未提取)']=(counts['(材质未提取)']||0)+1;continue;}
  const style=fs.readFileSync(vmat,'utf8').match(/"F_PAINT_STYLE"\s+"(\d+)"/)?.[1]||'unknown';
  counts[style]=(counts[style]||0)+1;
  if(style==='5')styleFive.push(`${skin.id}(${key})`);
}
console.log('目录总条数:',SKINS.length);
console.log('涂装风格分布:',JSON.stringify(counts));
console.log('无 paintkit 的原厂款:',noPaintKey.length,noPaintKey.join(', '));
console.log();
console.log('风格 5(阳极气喷,读 glock 位置图):',styleFive.length,'款');
console.log(styleFive.join('\n'));
