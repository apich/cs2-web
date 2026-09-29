// Build the full-catalog spec list from the VPK paintkit enumeration.
// Finishes already in shared/skins.js are skipped so ids stay unique.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));

const candidates=read('artifacts/weapon-expansion/paintkit-candidates.json');
const defaults=read('scripts/weapon-assets/default-skins.json');
const {SKINS}=await import(pathToFileURL(path.join(root,'shared/skins.js')).href);

// CS2 localisation is tab-indented `"key"\t\t\t"value"`. Anchor on the leading
// quote and the separating whitespace, and allow a key to repeat so the last
// (authoritative) definition wins, as in the game's own translation loader.
function localization(file){
  const map=new Map();
  for(const match of fs.readFileSync(file,'utf8').matchAll(/"([^"\r\n]+)"\s+"([^"\r\n]*)"/g)){
    map.set(match[1].toLowerCase(),match[2]);
  }
  return map;
}
const english=localization(path.join(root,'output/cs2-skins/source/resource/csgo_english.txt'));
const chinese=localization(path.join(root,'output/cs2-skins/source/resource/csgo_schinese.txt'));

// A paintkit's display name lives under "#PaintKit_<key>_Tag". Falls back to the
// plain "#PaintKit_<key>" description, then the raw paint key.
function displayName(kit,englishNameFallback){
  for(const key of [kit.description_tag,`#PaintKit_${kit.name}_Tag`,`#PaintKit_${kit.name}`]){
    if(!key)continue;
    const value=chinese.get(key.replace(/^#/,'').toLowerCase())||chinese.get(key.toLowerCase());
    if(value)return value;
  }
  for(const key of [`#PaintKit_${kit.name}_Tag`,`#PaintKit_${kit.name}`]){
    const value=english.get(key.replace(/^#/,'').toLowerCase())||english.get(key.toLowerCase());
    if(value&&value!=='[english]')return value;
  }
  return englishNameFallback||kit.name;
}

const byWeapon={};
for(const spec of defaults){
  const [display]=String(spec.name).split(' | ');
  byWeapon[spec.weapon]={input:spec.input,display};
}
// Knives ship a legacy body only and their finishes are re-authored per model;
// the karambit composite-input material is the one this pipeline bakes against.
byWeapon.knife={input:'weapons/models/knife/knife_karambit/materials/composite_inputs/knife_karambit_composite_inputs.vmat',display:'Karambit'};

const existing=new Set(SKINS.filter(s=>s.paintkit).map(s=>s.weapon+':'+s.paintkit));
const slug=name=>String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

const specs=[],taken=new Set(SKINS.map(s=>s.id));
for(const [weapon,list] of Object.entries(candidates.weapons)){
  const meta=byWeapon[weapon];
  if(!meta)throw Error('No composite input for '+weapon);
  for(const kit of list){
    if(existing.has(weapon+':'+kit.paintkit))continue;
    const name=displayName(kit,kit.name);
    let file=weapon+'-'+slug(name);
    if(taken.has(file))file=weapon+'-'+slug(name)+'-'+kit.paintkit;
    if(taken.has(file))throw Error('Unresolvable id collision: '+file);
    taken.add(file);
    specs.push({
      paintkit:kit.paintkit,paint:kit.paint,name,englishName:name,body:kit.body,
      wearMin:kit.wearMin,wearMax:kit.wearMax,officialFactoryNewPossible:kit.officialFactoryNewPossible,
      material:kit.material,inventory:kit.inventory,preview:`previews/${file}.webp`,
      id:weapon,weapon,file,input:meta.input,
    });
  }
}
fs.writeFileSync(path.join(root,'scripts/weapon-assets/full-catalog.json'),JSON.stringify(specs,null,2)+'\n');
const raw=specs.filter(s=>/paintkit/i.test(s.name)||/paintkit/i.test(s.file));
console.log(`新 spec ${specs.length} 款,其中名称仍含内部 token 的 ${raw.length} 款`);
console.log('样例:');
for(const s of specs.slice(0,6))console.log(`  ${s.file}  ${s.name}`);
