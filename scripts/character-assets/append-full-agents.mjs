// Builds shared/agents.js and shared/agent-assets.js from the exported optional
// agent models and previews. Keeps the four already-shipped agents byte-identical
// and appends the newly exported ones, so the audited defaults stay untouched.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const stage=path.join(root,'artifacts/characters-cs2');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const hash=f=>createHash('sha256').update(fs.readFileSync(path.join(root,'public',f))).digest('hex');
const size=f=>fs.statSync(path.join(root,'public',f)).size;

const specs=read('artifacts/characters-cs2/full-agents-source-index.json').agents;
const {AGENT_CATALOG}=await import(new URL('file://'+path.join(root,'shared/agents.js')));
const {AGENT_ASSETS}=await import(new URL('file://'+path.join(root,'shared/agent-assets.js')));

const existing=new Set(AGENT_CATALOG.map(a=>a.id));
const added=[];
for(const spec of specs){
  if(existing.has(spec.id))continue;
  const model=`assets/characters-cs2/optional/${spec.id}.glb`;
  const preview=`assets/characters-cs2/previews/${spec.id}.webp`;
  if(!fs.existsSync(path.join(root,'public',model)))continue;
  if(!fs.existsSync(path.join(root,'public',preview)))continue;
  added.push({
    id:spec.id,team:spec.team,name:spec.name,
    englishName:spec.name.includes('|')?spec.name.split('|')[1].trim():spec.name,
    isDefault:false,model,preview,
    bytes:size(model),sha256:hash(model),
    previewBytes:size(preview),previewSha256:hash(preview),
    itemId:spec.itemId,
  });
}
if(!added.length){console.log('没有新探员可添加（导出未完成？）');process.exit(0);}

// --- shared/agents.js ---
const agentsSource=fs.readFileSync(path.join(root,'shared/agents.js'),'utf8');
const marker='\n].map(agent=>Object.freeze(agent)));';
const at=agentsSource.indexOf(marker);
if(at<0)throw Error('Could not find the AGENT_CATALOG terminator');
const block=added.map(a=>`  {id:${JSON.stringify(a.id)},team:${JSON.stringify(a.team)},name:${JSON.stringify(a.name)},englishName:${JSON.stringify(a.englishName)},isDefault:false,model:${JSON.stringify(a.model)}},`).join('\n');
fs.writeFileSync(path.join(root,'shared/agents.js'),agentsSource.slice(0,at)+'\n'+block+agentsSource.slice(at));

// --- shared/agent-assets.js ---
const assetsSource=fs.readFileSync(path.join(root,'shared/agent-assets.js'),'utf8');
const closeAt=assetsSource.lastIndexOf('});');
if(closeAt<0)throw Error('Could not find the AGENT_ASSETS terminator');
const assetBlock=added.map(a=>{
  const entry={model:a.model,bytes:a.bytes,sha256:a.sha256,preview:{file:a.preview,bytes:a.previewBytes,sha256:a.previewSha256}};
  return `  ${JSON.stringify(a.id)}: ${JSON.stringify(entry,null,2).replace(/\n/g,'\n  ')},`;
}).join('\n');
fs.writeFileSync(path.join(root,'shared/agent-assets.js'),assetsSource.slice(0,closeAt)+'\n'+assetBlock+'\n'+assetsSource.slice(closeAt));

console.log(`新增探员 ${added.length} 个。AGENT_CATALOG 现有 ${AGENT_CATALOG.length+added.length} 条。`);
console.log('样例:');
for(const a of added.slice(0,5))console.log(`  ${a.id}  ${a.name}`);
