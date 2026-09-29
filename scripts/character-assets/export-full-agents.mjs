// Exports every selectable agent model and inventory preview from the installed
// CS2 VPK. Grows the optional-agent set from items_game.txt's authoritative list
// rather than a hand-maintained array. Reuses the same world animation bundle as
// the existing four agents.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const stage=path.join(root,'artifacts/characters-cs2');
const game=process.env.CS2_GAME_DIR||'E:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const vpk=path.join(game,'pak01_dir.vpk');
const cli=path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe');
const temp=path.join(root,'artifacts/export-temp');
const lockPath=path.join(root,'artifacts/s2v-export.lock');

// --- authoritative agent list, deduplicated by model (see list-agents.mjs) ---
const items=fs.readFileSync(path.join(root,'output/cs2-skins/source/scripts/items/items_game.txt'),'utf8');
const lines=items.split(/\r?\n/);
const english=new Map(),chinese=new Map();
for(const [map,file] of [[english,'csgo_english.txt'],[chinese,'csgo_schinese.txt']]){
  for(const line of fs.readFileSync(path.join(root,'output/cs2-skins/source/resource',file),'utf8').split(/\r?\n/)){
    const m=line.match(/^[\t ]*"([^"]+)"[\t ]+"((?:[^"\\]|\\.)*)"/);
    if(m)map.set(m[1].toLowerCase(),m[2]);
  }
}
const byModel=new Map();
for(let i=0;i<lines.length;i++){
  const key=lines[i].match(/^[\t ]*"(\d+)"\s*$/);
  if(!key||lines[i+1]?.trim()!=='{')continue;
  const indent=lines[i].match(/^[\t ]*/)[0].length;
  const fields={};
  for(let j=i+2;j<lines.length;j++){
    const lineIndent=lines[j].match(/^[\t ]*/)[0].length;
    if(lineIndent<=indent&&lines[j].trim()==='}')break;
    const v=lines[j].match(/^[\t ]*"([^"]+)"[\t ]+"((?:[^"\\]|\\.)*)"/);
    if(v)fields[v[1]]=v[2];
  }
  const model=fields.model_player;
  if(!model||!model.startsWith('agents/models/'))continue;
  const rel=model.replace(/^agents\/models\//,'').replace(/\.vmdl$/,'');
  if(rel.startsWith('shared/'))continue;                       // glove models, not agents
  const nameKey=(fields.item_name||'').replace(/^#/,'').toLowerCase();
  const name=chinese.get(nameKey)||english.get(nameKey)||fields.item_name||key[1];
  if(!byModel.has(rel))byModel.set(rel,{itemId:key[1],source:rel,name});
}

// Keep the four already shipped; everything else becomes a new optional agent.
const shipped=new Set(['ctm_sas/ctm_sas','tm_phoenix/tm_phoenix','ctm_fbi/ctm_fbi_variantb','tm_professional/tm_professional_varf']);
const isDefaultAgent=name=>/默认 (CT|T) 探员/.test(name);
const specs=[...byModel.values()].filter(s=>!shipped.has(s.source)&&!isDefaultAgent(s.name)).map(s=>{
  // id follows the existing ct-ava / t-miami convention: team + model stem.
  const stem=s.source.split('/')[1];
  const team=s.source.startsWith('ctm_')?'CT':'T';
  const id=(team==='CT'?'ct-':'t-')+stem.replace(/^ctm_|^tm_/,'');
  return {...s,team,id};
});
console.log(`待导出探员: ${specs.length}（已跳过 ${shipped.size} 个已发布）`);

if(process.argv.includes('--index-only')){
  fs.mkdirSync(stage,{recursive:true});
  fs.writeFileSync(path.join(stage,'full-agents-source-index.json'),JSON.stringify({agents:specs},null,2)+'\n');
  console.log('已写入 full-agents-source-index.json');
  process.exit(0);
}

fs.mkdirSync(temp,{recursive:true});
fs.mkdirSync(stage,{recursive:true});
const lock=fs.openSync(lockPath,'wx');
fs.writeFileSync(lock,JSON.stringify({pid:process.pid,task:'full-agents',startedAt:new Date().toISOString()}));

function valid(file){const b=Buffer.alloc(12),fd=fs.openSync(file,'r');fs.readSync(fd,b,0,12,0);fs.closeSync(fd);return b.toString('ascii',0,4)==='glTF'&&b.readUInt32LE(8)===fs.statSync(file).size;}
function run(resource,file,model=false){
  if(fs.existsSync(file)&&valid(file)){console.log('existing '+path.relative(stage,file));return;}
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const log=fs.openSync(file+'.log','w');
  const args=['-i',vpk,'-f',resource,'-o',file,'-d','--game',path.join(game,'gameinfo.gi')];
  if(model)args.push('--gltf_export_format','glb','--gltf_export_animations','--gltf_export_materials','--gltf_textures_adapt','--gltf_export_extras');
  const result=spawnSync(cli,args,{windowsHide:true,stdio:['ignore',log,log],env:{...process.env,TEMP:temp,TMP:temp},timeout:360000});
  fs.closeSync(log);
  if(result.status||result.error)throw Error('Export '+resource+' '+(result.status||result.error?.message));
  console.log(path.relative(stage,file));
}

try{
  for(const s of specs){
    run('agents/models/'+s.source+'.vmdl_c',path.join(stage,'raw',s.id,s.id+'.glb'),true);
    const stem=s.source.split('/')[1];
    run('panorama/images/econ/characters/customplayer_'+stem+'_png.vtex_c',path.join(stage,'previews',s.id+'.png'));
  }
  fs.writeFileSync(path.join(stage,'full-agents-source-index.json'),JSON.stringify({agents:specs},null,2)+'\n');
  console.log(`导出完成 ${specs.length} 个探员模型与预览。`);
}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
