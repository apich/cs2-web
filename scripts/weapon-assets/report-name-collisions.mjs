// Reports display-name collisions inside one weapon, which make skins
// indistinguishable in the warehouse grid.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {SKINS}=await import(pathToFileURL(path.join(root,'shared/skins.js')).href);
const groups=new Map();
for(const skin of SKINS){
  const key=skin.weapon+'\0'+skin.name;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(skin);
}
let total=0;
for(const [key,list] of groups){
  if(list.length<2)continue;
  total+=list.length;
  const [weapon,name]=key.split('\0');
  console.log(`${weapon} / ${name}  ×${list.length}`);
  for(const s of list)console.log(`    ${s.id}  (paintkit ${s.paintkit})`);
}
console.log(`\n${total} finishes share a display name with a sibling of the same weapon.`);
