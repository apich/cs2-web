// Exports every glove model and every glove paint from the installed CS2 VPK.
// The existing export-gloves.mjs only handled glove_sporty + sporty_green.
//
// Output lands in artifacts/characters-cs2/gloves/:
//   models/<glove>.glb            one GLB per glove model (12)
//   paints/<paint>.vmat           the paint definition (72)
//   paints/<paint>.vcompmat       the composite material (72)
// The baked arms.glb assembly is a separate step; this only stages the sources.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readVpkIndex} from '../../tools/vpk-index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const stage=path.join(root,'artifacts/characters-cs2/gloves');
const game=process.env.CS2_GAME_DIR||'E:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const vpk=path.join(game,'pak01_dir.vpk');
const cli=path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe');
const temp=path.join(root,'artifacts/export-temp');
const lockPath=path.join(root,'artifacts/s2v-export.lock');

const entries=readVpkIndex(vpk).entries.map(e=>e.path);
const models=entries.filter(p=>/^agents\/models\/shared\/arms\/glove_[a-z0-9_]+\/[^/]+\.vmdl_c$/.test(p));
const paints=entries.filter(p=>/^gloves\/paints\/[a-z0-9_]+\.vmat_c$/.test(p)).map(p=>p.replace(/\.vmat_c$/,''));
const comps=entries.filter(p=>/^gloves\/paints\/[a-z0-9_]+\.vcompmat_c$/.test(p)).map(p=>p.replace(/\.vcompmat_c$/,''));

console.log(`手套模型 ${models.length} 个 | 涂装 ${paints.length} 款 | 复合材质 ${comps.length} 个`);

if(process.argv.includes('--index-only')){
  fs.mkdirSync(stage,{recursive:true});
  fs.writeFileSync(path.join(stage,'gloves-source-index.json'),
    JSON.stringify({models,paints,comps},null,2)+'\n');
  console.log('已写入 gloves-source-index.json');
  process.exit(0);
}

fs.mkdirSync(stage,{recursive:true});fs.mkdirSync(temp,{recursive:true});
// These scripts share artifacts/s2v-export.lock so only one Source2Viewer runs at
// a time. Wait for it instead of failing when another export holds the lock.
function acquireLock(){
  for(let attempt=0;attempt<900;attempt++){
    try{const fd=fs.openSync(lockPath,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,task:'full-gloves',startedAt:new Date().toISOString()}));return fd;}
    catch(error){if(error.code!=='EEXIST')throw error;}
    const until=Date.now()+2000;
    while(Date.now()<until)/* busy-wait keeps this dependency-free */;
  }
  throw Error('Timed out waiting for the Source2Viewer export lock');
}
const lock=acquireLock();

function valid(file){const b=Buffer.alloc(12),fd=fs.openSync(file,'r');fs.readSync(fd,b,0,12,0);fs.closeSync(fd);return b.toString('ascii',0,4)==='glTF'&&b.readUInt32LE(8)===fs.statSync(file).size;}
function run(resource,file,model=false){
  if(fs.existsSync(file)&&(model?valid(file):true)){console.log('existing '+path.relative(stage,file));return;}
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const log=fs.openSync(file+'.log','w');
  const args=['-i',vpk,'-f',resource,'-o',file,'-d','--game',path.join(game,'gameinfo.gi')];
  if(model)args.push('--gltf_export_format','glb','--gltf_export_animations','--gltf_export_materials','--gltf_textures_adapt','--gltf_export_extras');
  const result=spawnSync(cli,args,{windowsHide:true,stdio:['ignore',log,log],env:{...process.env,TEMP:temp,TMP:temp},timeout:300000});
  fs.closeSync(log);
  if(result.status||result.error)throw Error('Export '+resource+' '+(result.status||result.error?.message));
  console.log(path.relative(stage,file));
}

try{
  for(const m of models){
    const name=m.split('/')[4];                       // glove_sporty
    run(m,path.join(stage,'models',name+'.glb'),true);
  }
  for(const p of paints)run(p+'.vmat_c',path.join(stage,'paints',path.basename(p)+'.vmat'));
  for(const c of comps)run(c+'.vcompmat_c',path.join(stage,'paints',path.basename(c)+'.vcompmat'));
  console.log(`导出完成: ${models.length} 模型 + ${paints.length} 涂装 + ${comps.length} 复合材质`);
}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
