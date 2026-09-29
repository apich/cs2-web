import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {AGENT_ARM_ASSETS} from '../shared/agent-arm-assets.js';
import {GLOVES,getGlove,DEFAULT_GLOVE} from '../shared/gloves.js';
import {fetchCachedAsset} from './loading.js';

const models=new Map(),pending=new Map(),references=new Map(),retry=new Map();
const gloveModels=new Map(),glovePending=new Map();
export function loadedAgentArms(id){const model=models.get(id);if(model){models.delete(id);models.set(id,model);}return model;}
export function retainAgentArms(id){references.set(id,(references.get(id)||0)+1);}
export function releaseAgentArms(id){references.set(id,Math.max(0,(references.get(id)||0)-1));trim();}
function trim(){
 const idle=[...models.keys()].filter(id=>!references.get(id));
 while(idle.length>2){
  const id=idle.shift(),source=models.get(id);models.delete(id);references.delete(id);
  const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set();
  source.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.skeleton)skeletons.add(o.skeleton);for(const material of [].concat(o.material||[])){materials.add(material);for(const texture of Object.values(material))if(texture?.isTexture)textures.add(texture);}});
  skeletons.forEach(s=>s.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>{t.dispose();t.source?.data?.close?.();});
 }
}
export async function loadAgentArms(id,{onProgress,signal}={}){
 if(models.has(id))return loadedAgentArms(id);if(pending.has(id))return pending.get(id);
 const asset=AGENT_ARM_ASSETS[id];if(!asset)throw Error('未找到探员第一人称模型');
 const task=(async()=>{const url=new URL(asset.model,document.baseURI);const response=await fetchCachedAsset(url.href,{bytes:asset.bytes,sha256:asset.sha256,onProgress,signal});if(!response.ok)throw Error('探员手臂下载失败');const source=await new GLTFLoader().parseAsync(await response.arrayBuffer(),new URL('.',url).href);models.set(id,source);trim();return source;})();
 pending.set(id,task);try{return await task;}finally{pending.delete(id);}
}
export function requestAgentArms(id){if(!AGENT_ARM_ASSETS[id]||models.has(id)||pending.has(id)||(retry.get(id)||0)>performance.now())return;retry.set(id,performance.now()+30000);loadAgentArms(id).catch(()=>{});}
export function agentArmsCacheStatus(){return {loaded:models.size,pending:pending.size,references:Object.fromEntries(references)};}

/** Glove GLBs are complete arms+glove rigs on the same weapon_arms skeleton. */
export function loadedGloveArms(id){return gloveModels.get(id);}
export async function loadGloveArms(id,{onProgress,signal}={}){
 if(gloveModels.has(id))return gloveModels.get(id);if(glovePending.has(id))return glovePending.get(id);
 const glove=getGlove(id);if(!glove)throw Error('未找到该手套');
 const task=(async()=>{const url=new URL(glove.model,document.baseURI);const response=await fetchCachedAsset(url.href,{bytes:glove.bytes,sha256:glove.sha256,onProgress,signal});if(!response.ok)throw Error('手套模型下载失败');const source=await new GLTFLoader().parseAsync(await response.arrayBuffer(),new URL('.',url).href);gloveModels.set(id,source);return source;})();
 glovePending.set(id,task);try{return await task;}finally{glovePending.delete(id);}
}
export function requestGloveArms(id){if(!getGlove(id)||gloveModels.has(id)||glovePending.has(id))return;loadGloveArms(id).catch(()=>{});}

const isGloveMesh=o=>o.isSkinnedMesh&&/glove/i.test(o.name||'');

/**
 * Swap the baked-in glove on a cloned arms rig for another one.
 *
 * Both models are built on the identical weapon_arms skeleton — same 52 joints
 * in the same order — so the glove's joints are re-pointed at the arms rig's
 * joint nodes by name and follow the viewmodel mixer. Joint order (and thus
 * skinIndex) is kept. The authored bind matrices must survive: SkeletonUtils
 * clone shares boneInverses with the library source, so a bare SkinnedMesh
 * bind would recompute them from the rest pose and deform every arms instance.
 */
export function swapGlove(armsRoot,gloveRoot){
 const boneByName=new Map();
 armsRoot.traverse(o=>{if(!o.isSkinnedMesh)return;for(const bone of o.skeleton.bones)if(bone)boneByName.set(bone.name,bone);});
 if(!boneByName.size)return;

 // Drop the glove that came with the agent arms; keep sleeve and bare arm.
 const doomed=[];
 armsRoot.traverse(o=>{if(isGloveMesh(o))doomed.push(o);});
 for(const o of doomed)o.parent?.remove(o);

 const gloveClone=clone(gloveRoot);
 const keep=[];
 gloveClone.traverse(o=>{if(isGloveMesh(o))keep.push(o);});
 for(const mesh of keep){
  mesh.skeleton.bones=mesh.skeleton.bones.map(bone=>bone?boneByName.get(bone.name)||bone:bone);
  armsRoot.add(mesh);
 }
}
