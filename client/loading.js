import {assetManifestName} from './device-profile.js';
import { DefaultLoadingManager } from 'three';
const blobs=new Map(),inflight=new Map();let manifestMemory=null,manifestChecked=false;
const base=()=>new URL('.',document.baseURI),absolute=value=>new URL(value,document.baseURI);
const canonical=value=>{const u=absolute(value);return u.origin+u.pathname;};
const cacheNames=()=>({assets:`dust2-assets-v1:${base().pathname}`,meta:`dust2-meta-v1:${base().pathname}`});
const hashKey=hash=>new URL(`__asset_cache__/sha256/${hash}`,base()).href;
const indexKey=url=>new URL(`__asset_cache__/url/${encodeURIComponent(absolute(url).href)}`,base()).href;
const manifestURL=()=>new URL('assets/'+assetManifestName(),base()).href;
const check=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('已取消','AbortError');};
function sha256Pure(buffer){
  const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let H0=0x6a09e667,H1=0xbb67ae85,H2=0x3c6ef372,H3=0xa54ff53a,H4=0x510e527f,H5=0x9b05688c,H6=0x1f83d9ab,H7=0x5be0cd19;
  const bytes=new Uint8Array(buffer),len=bytes.length,padLen=((len+8)&~63)+64,padded=new Uint8Array(padLen);
  padded.set(bytes);padded[len]=0x80;
  const view=new DataView(padded.buffer);
  view.setUint32(padLen-8,Math.floor(len/0x20000000),false);view.setUint32(padLen-4,(len<<3)>>>0,false);
  const W=new Int32Array(64);
  for(let i=0;i<padLen;i+=64){
    for(let t=0;t<16;t++)W[t]=view.getInt32(i+(t<<2),false);
    for(let t=16;t<64;t++){
      const s0=((W[t-15]>>>7)|(W[t-15]<<25))^((W[t-15]>>>18)|(W[t-15]<<14))^(W[t-15]>>>3);
      const s1=((W[t-2]>>>17)|(W[t-2]<<15))^((W[t-2]>>>19)|(W[t-2]<<13))^(W[t-2]>>>10);
      W[t]=(W[t-16]+s0+W[t-7]+s1)|0;
    }
    let a=H0,b=H1,c=H2,d=H3,e=H4,f=H5,g=H6,h=H7;
    for(let t=0;t<64;t++){
      const S1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7));
      const ch=(e&f)^(~e&g),temp1=(h+S1+ch+K[t]+W[t])|0;
      const S0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10));
      const maj=(a&b)^(a&c)^(b&c),temp2=(S0+maj)|0;
      h=g;g=f;f=e;e=(d+temp1)|0;d=c;c=b;b=a;a=(temp1+temp2)|0;
    }
    H0=(H0+a)|0;H1=(H1+b)|0;H2=(H2+c)|0;H3=(H3+d)|0;H4=(H4+e)|0;H5=(H5+f)|0;H6=(H6+g)|0;H7=(H7+h)|0;
  }
  return [H0,H1,H2,H3,H4,H5,H6,H7].map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');
}
const digest=async (data,fallbackSha256='')=>{
  if(globalThis.crypto?.subtle?.digest){
    try{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');}catch{}
  }
  if(fallbackSha256)return fallbackSha256.toLowerCase();
  return sha256Pure(data);
};
const changed=()=>{if(typeof window!=='undefined'&&typeof CustomEvent!=='undefined')window.dispatchEvent(new CustomEvent('dust2-cache-change'));};
async function stores(){try{if(!globalThis.caches)return null;const n=cacheNames();return{assets:await caches.open(n.assets),meta:await caches.open(n.meta)};}catch{return null;}}
export function assetURL(value){return blobs.get(canonical(value))||value;}
export function releaseDownloads(){for(const b of blobs.values())URL.revokeObjectURL(b);blobs.clear();}
export function useDownloadedAssets(manager=DefaultLoadingManager){manager.setURLModifier(assetURL);}
export async function isAssetSaved(sha256,bytes){const cache=await stores();if(!cache||!sha256)return false;const hit=await cache.assets.match(hashKey(sha256));return !!hit&&Number(hit.headers.get('x-dust2-bytes'))===bytes;}

/** SHA-keyed immutable assets. Without a supplied hash, the computed SHA is
 * indexed by URL; use sha256 or a versioned URL when optional content changes.
 * onProgress receives {loaded,total,fromCache,cached}, in decoded bytes. */
function pendingResult(promise,signal){
  if(!signal)return promise;
  return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason||new DOMException('已取消','AbortError'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
export async function fetchCachedAsset(value,options={}){
  check(options.signal);const settings={...options};
  if(!settings.sha256){
    const manifest=manifestChecked?manifestMemory:await loadManifest({signal:settings.signal}).catch(error=>{check(settings.signal);return null;});
    const file=manifest?.files.find(f=>canonical(f.path)===canonical(value));
    if(file){settings.sha256=file.sha256;settings.bytes??=file.bytes;}
  }
  const key=canonical(value),existing=inflight.get(key);
  if(existing){
    try{const response=await pendingResult(existing,settings.signal);check(settings.signal);
      if((!settings.sha256||response.headers.get('x-dust2-sha256')===settings.sha256.toLowerCase())&&(!Number.isFinite(settings.bytes)||Number(response.headers.get('x-dust2-bytes'))===settings.bytes)){
        const n=Number(response.headers.get('x-dust2-bytes'));settings.onProgress?.({loaded:n,total:n,fromCache:true,cached:true});return response.clone();}}
    catch(error){check(settings.signal);}
  }
  const promise=readCachedAsset(value,settings);inflight.set(key,promise);
  try{return(await promise).clone();}finally{if(inflight.get(key)===promise)inflight.delete(key);}
}
async function readCachedAsset(value,{sha256,bytes,signal,onProgress}={}){
  check(signal);const url=absolute(value);url.hash='';
  if(sha256&&!/^[a-f\d]{64}$/i.test(sha256))throw new Error('无效的资源 SHA-256');
  sha256=sha256?.toLowerCase();if(sha256)url.searchParams.set('v',sha256.slice(0,12));
  const cache=await stores();let expected=sha256;
  if(!expected&&cache){const hit=await cache.meta.match(indexKey(url));if(hit)expected=(await hit.json()).sha256;}
  if(expected&&cache){const hit=await cache.assets.match(hashKey(expected)),length=Number(hit?.headers.get('x-dust2-bytes'));
    if(hit&&(!Number.isFinite(bytes)||length===bytes)){check(signal);onProgress?.({loaded:length,total:length,fromCache:true,cached:true});return hit;}}
  const response=await fetch(url,{signal,cache:sha256?'force-cache':'default'});
  if(!response.ok||response.type==='opaque')throw new Error(`资源下载失败 (${response.status})：${url.pathname.split('/').pop()}`);
  if(response.headers.get('content-type')?.includes('text/html')&&!url.pathname.endsWith('.html'))throw new Error(`资源地址返回了网页：${url.pathname.split('/').pop()}`);
  const chunks=[];let received=0;const reader=response.body?.getReader();
  try{if(reader){while(true){check(signal);const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.byteLength;onProgress?.({loaded:received,total:bytes||received,fromCache:false,cached:false});}}
    else{const value=new Uint8Array(await response.arrayBuffer());chunks.push(value);received=value.byteLength;}}
  catch(error){await reader?.cancel(error).catch(()=>{});throw error;}
  check(signal);if(Number.isFinite(bytes)&&received!==bytes)throw new Error(`资源不完整：${url.pathname.split('/').pop()}，请重试`);
  const blob=new Blob(chunks,{type:response.headers.get('content-type')||'application/octet-stream'}),actual=await digest(await blob.arrayBuffer(),sha256);
  check(signal);if(sha256&&actual!==sha256)throw new Error(`资源校验失败：${url.pathname.split('/').pop()}，请重试`);
  const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('transfer-encoding');headers.set('content-length',String(received));
  headers.set('x-dust2-sha256',actual);headers.set('x-dust2-bytes',String(received));headers.set('x-dust2-asset-url',url.href);
  const result=new Response(blob,{status:200,headers});let cached=false;
  if(cache){try{await cache.assets.put(hashKey(actual),result.clone());await cache.meta.put(indexKey(url),new Response(JSON.stringify({sha256:actual,bytes:received}),{headers:{'content-type':'application/json'}}));cached=true;changed();}
    catch(error){console.warn('资源已加载，但浏览器未保存持久缓存：',error.name||error.message);}}
  check(signal);onProgress?.({loaded:received,total:bytes||received,fromCache:false,cached});return result;
}

async function loadManifest({signal,refresh=true}={}){
  check(signal);if(!refresh&&manifestMemory)return manifestMemory;const cache=await stores();
  if(!refresh&&cache){const hit=await cache.meta.match(manifestURL());if(hit){manifestMemory=await hit.json();return manifestMemory;}}
  try{const response=await fetch(manifestURL(),{cache:'no-cache',signal});if(!response.ok)throw new Error(`资源清单加载失败 (${response.status})`);
    const manifest=await response.clone().json();
    if(!Array.isArray(manifest.files)||!manifest.files.every(f=>typeof f.path==='string'&&Number.isSafeInteger(f.bytes)&&f.bytes>=0&&/^[a-f\d]{64}$/i.test(f.sha256)))throw new Error('资源清单格式错误');
    manifestMemory=manifest;manifestChecked=true;try{await cache?.meta.put(manifestURL(),response.clone());}catch{}return manifest;
  }catch(error){check(signal);const hit=await cache?.meta.match(manifestURL());if(hit){manifestMemory=await hit.json();manifestChecked=true;return manifestMemory;}throw error;}
}

async function collectAssets({signal,onProgress,makeBlobs=false}={}){
  if(makeBlobs)releaseDownloads();const controller=new AbortController(),parent=signal,abort=()=>controller.abort(parent?.reason);
  parent?.addEventListener('abort',abort,{once:true});if(parent?.aborted)abort();signal=controller.signal;let workers=[];
  try{const manifest=await loadManifest({signal}),total=manifest.files.reduce((n,f)=>n+f.bytes,0);
    let next=0,complete=0,bytes=0,lastBytes=0,lastTime=performance.now(),rate=0,cachedFiles=0;
    const tick=current=>{const now=performance.now(),elapsed=(now-lastTime)/1000;if(elapsed>.35){rate=(bytes-lastBytes)/elapsed;lastTime=now;lastBytes=bytes;}onProgress?.({bytes,total,complete,count:manifest.files.length,rate,current,cachedFiles});};tick('准备地图资源');
    workers=Array.from({length:12},async()=>{while(next<manifest.files.length){check(signal);const file=manifest.files[next++],url=absolute(file.path);url.searchParams.set('v',file.sha256.slice(0,12));let seen=0,fromCache=false;
      const response=await fetchCachedAsset(url,{sha256:file.sha256,bytes:file.bytes,signal,onProgress:p=>{bytes+=p.loaded-seen;seen=p.loaded;fromCache=p.fromCache;tick(file.group);}});
      if(makeBlobs)blobs.set(canonical(url),URL.createObjectURL(await response.blob()));if(fromCache)cachedFiles++;complete++;tick(file.group);
    }});await Promise.all(workers);if(makeBlobs)useDownloadedAssets();return manifest;
  }catch(error){controller.abort();await Promise.allSettled(workers);if(makeBlobs)releaseDownloads();throw error;}
  finally{parent?.removeEventListener('abort',abort);}
}
export async function downloadAssets(options={}){
  // A controlling worker can serve verified cache entries directly. Retaining
  // every compressed file as a second set of Blob URLs only increases the peak.
  const controlled=!!globalThis.navigator?.serviceWorker?.controller;
  return collectAssets({...options,makeBlobs:!controlled});
}
export async function saveBaseAssets(options={}){
  if(!await stores())throw new Error('此浏览器无法使用离线缓存，请使用 HTTPS 或本机地址');await collectAssets({...options,makeBlobs:false});
  const stats=await getAssetCacheStats();if(!stats.complete)throw new Error('浏览器存储空间不足或缓存未能保存，请释放空间后重试');return stats;
}
export async function getAssetCacheStats(){
  const cache=await stores(),manifest=await loadManifest({refresh:false}).catch(()=>null);
  const stats={supported:!!cache,bytes:0,count:0,baseBytes:0,baseCount:0,totalBytes:manifest?.files.reduce((n,f)=>n+f.bytes,0)||0,totalCount:manifest?.files.length||0,complete:false,persisted:false,usage:null,quota:null};
  if(cache){for(const key of await cache.assets.keys()){const r=await cache.assets.match(key);stats.bytes+=Number(r?.headers.get('x-dust2-bytes'))||0;stats.count++;}
    for(const file of manifest?.files||[]){const r=await cache.assets.match(hashKey(file.sha256.toLowerCase()));if(r&&Number(r.headers.get('x-dust2-bytes'))===file.bytes){stats.baseCount++;stats.baseBytes+=file.bytes;}}
    stats.complete=stats.totalCount>0&&stats.baseCount===stats.totalCount;}
  try{stats.persisted=await navigator.storage?.persisted?.()||false;const e=await navigator.storage?.estimate?.();stats.usage=e?.usage??null;stats.quota=e?.quota??null;}catch{}return stats;
}
export async function clearAssetCache(){const n=cacheNames();if(globalThis.caches)await Promise.all([caches.delete(n.assets),caches.delete(n.meta)]);manifestMemory=null;manifestChecked=false;changed();return getAssetCacheStats();}
