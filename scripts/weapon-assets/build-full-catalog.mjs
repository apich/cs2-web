// Builds the full-catalog spec list from the VPK paintkit enumeration, reusing
// each weapon's composite-input path and display name from default-skins.json.
// Skins already present in shared/skins.js are excluded so ids stay unique.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));

const candidates=read('artifacts/weapon-expansion/paintkit-candidates.json');
const defaults=read('scripts/weapon-assets/default-skins.json');
const {SKINS}=await import(pathToFileURL(path.join(root,'shared/skins.js')).href);

const byWeapon={};
for(const spec of defaults){
  const [display]=String(spec.name).split(' | ');
  byWeapon[spec.weapon]={input:spec.input,display,rawGLB:`artifacts/weapon-expansion/raw/${spec.weapon}/${spec.weapon}.glb`};
}
// The knife default is a vanilla butterfly export; karambit finishes need the
// karambit raw model that export.mjs now produces.
// Knife finishes come from the karambit model, so they need the karambit
// composite-input material. The default knife spec points at the vanilla
// butterfly weapon material, which is not a composite-input asset and lacks
// TextureAmbientOcclusion1/TextureMasks1.
byWeapon.knife={input:'weapons/models/knife/knife_karambit/materials/composite_inputs/knife_karambit_composite_inputs.vmat',display:'Karambit',rawGLB:'artifacts/weapon-expansion/raw/knife/knife.glb'};

const existing=new Set(SKINS.filter(s=>s.paintkit).map(s=>s.weapon+':'+s.paintkit));
const slug=name=>String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

const specs=[],taken=new Set(SKINS.map(s=>s.id));
let skipped=0,collisions=0;
for(const [weapon,list] of Object.entries(candidates.weapons)){
  const meta=byWeapon[weapon];
  if(!meta)throw Error('No composite input for '+weapon);
  for(const kit of list){
    if(existing.has(weapon+':'+kit.paintkit)){skipped++;continue;}
    let file=weapon+'-'+slug(kit.name);
    if(taken.has(file)){collisions++;file=weapon+'-'+slug(kit.name)+'-'+kit.paintkit;}
    if(taken.has(file))throw Error('Unresolvable id collision: '+file);
    taken.add(file);
    specs.push({
      paintkit:kit.paintkit,paint:kit.paint,name:`${meta.display} | ${kit.name}`,
      chineseName:kit.chineseName||kit.name,body:kit.body,
      wearMin:kit.wearMin,wearMax:kit.wearMax,officialFactoryNewPossible:kit.officialFactoryNewPossible,
      material:kit.material,inventory:kit.inventory,
      // spec.preview is the output path relative to the bake directory; the
      // source VPK resource is derived from spec.inventory by the baker.
      preview:`previews/${file}.webp`,
      id:weapon,weapon,file,englishName:kit.name,input:meta.input,rawGLB:meta.rawGLB,
    });
  }
}
const out=path.join(root,'scripts/weapon-assets/full-catalog.json');
fs.writeFileSync(out,JSON.stringify(specs,null,2)+'\n');
const counts=Object.fromEntries(Object.entries(candidates.weapons).map(([w,l])=>[w,l.length]));
console.log(`候选 ${Object.values(counts).reduce((a,b)=>a+b,0)} 款;已在目录中跳过 ${skipped} 款;新生成 ${specs.length} 款(命名冲突 ${collisions} 款)`);
console.log('新增分布:',JSON.stringify(Object.fromEntries(Object.entries(specs.reduce((a,s)=>(a[s.weapon]=(a[s.weapon]||0)+1,a),{})))));
