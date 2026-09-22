import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {readVpkIndex} from '../../tools/vpk-index.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const game=process.env.CS2_GAME_DIR||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo';
// Vanilla finishes (paintkit 0) have no paintkit material or generated preview
// to extract; the knife default is exported as a plain weapon model instead.
const specsArg=process.argv.find(a=>a.startsWith('--specs='))?.slice(8);
const specs=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,specsArg||'default-skins.json'),'utf8')).filter(s=>s.paintkit);
const vpk=path.join(game,'pak01_dir.vpk');
const entries=new Set(readVpkIndex(vpk).entries.map(e=>e.path));
const source=path.join(root,'artifacts/weapon-expansion/source');
const filters=[...new Set(specs.flatMap(s=>[s.material,`panorama/images/econ/default_generated/${s.inventory}_light_png.vtex_c`,s.input+'_c']))];
for(const file of filters)if(!entries.has(file))throw Error('Missing source '+file);
fs.mkdirSync(source,{recursive:true});
const temp=path.join(root,'artifacts/export-temp');fs.mkdirSync(temp,{recursive:true});
const lockPath=path.join(root,'artifacts/s2v-export.lock');
const lock=fs.openSync(lockPath,'wx');fs.writeFileSync(lock,JSON.stringify({pid:process.pid,task:'weapon-finishes',startedAt:new Date().toISOString()}));
try{
 const log=fs.openSync(path.join(root,'artifacts/weapon-expansion/extract-finishes.log'),'w');
 // Windows caps a command line near 8191 characters, so a full-catalog run must
 // hand Source2Viewer the filter list in batches.
 const batches=[];let batch=[],length=0;
 for(const file of filters){
  const cost=file.length+1;
  if(length+cost>6000&&batch.length){batches.push(batch);batch=[];length=0;}
  batch.push(file);length+=cost;
 }
 if(batch.length)batches.push(batch);
 for(const [index,group] of batches.entries()){
  const result=spawnSync(path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe'),['-i',vpk,'-f',group.join(','),'-o',source,'-d'],{stdio:['ignore',log,log],windowsHide:true,env:{...process.env,TEMP:temp,TMP:temp},timeout:600000});
  if(result.error)throw result.error;
  if(result.status)throw Error('Source2Viewer exit '+result.status+' on batch '+(index+1));
  if(batches.length>1)console.log(`  batch ${index+1}/${batches.length}: ${group.length} sources`);
 }
 fs.closeSync(log);
 console.log('Extracted '+specs.length+' original finishes and previews in '+batches.length+' batches.');
}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
