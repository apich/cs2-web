// Builds shared/gloves.js from the baked gloves under
// public/assets/viewmodel/gloves/, pulling each glove's Chinese name from CS2's
// own localisation and its inventory preview from the VPK.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readVpkIndex} from '../../tools/vpk-index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const game=process.env.CS2_GAME_DIR||'E:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const vpk=path.join(game,'pak01_dir.vpk');
const cli=path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe');
const DEST=path.join(root,'public/assets/viewmodel/gloves');
const PREV=path.join(DEST,'previews');

function localization(file){
  const map=new Map();
  for(const line of fs.readFileSync(path.join(root,'output/cs2-skins/source/resource',file),'utf8').split(/\r?\n/)){
    const m=line.match(/^[\t ]*"([^"]+)"[\t ]+"((?:[^"\\]|\\.)*)"/);
    if(m)map.set(m[1].toLowerCase(),m[2]);
  }
  return map;
}
const english=localization('csgo_english.txt');
const chinese=localization('csgo_schinese.txt');

// The VPK names glove previews after the paint, with a family prefix that is not
// consistent across models (`motorcycle_gloves_*`, `leather_handwraps_*`, …).
// Match on the `_<paint>_light_png` suffix instead of guessing the prefix.
const entries=readVpkIndex(vpk).entries.map(e=>e.path);
const previews=new Map();
for(const p of entries){
  const m=p.match(/default_generated\/(.+)_light_png\.vtex_c$/);
  if(!m)continue;
  const stem=m[1];
  for(const id of fs.readdirSync(DEST).filter(f=>f.endsWith('.glb')).map(f=>f.replace(/\.glb$/,''))){
    if(stem===id||stem.endsWith('_'+id)){ if(!previews.has(id))previews.set(id,p); break; }
  }
}

// Glove paint names come from the paintkit tag, same as weapon finishes.
const items=fs.readFileSync(path.join(root,'output/cs2-skins/source/scripts/items/items_game.txt'),'utf8');
const tokens=[...items.matchAll(/"((?:\\.|[^"\\])*)"|([{}])|\/\/[^\r\n]*/g)].filter(m=>m[1]!==undefined||m[2]).map(m=>m[1]??m[2]);
let cursor=0;
function object(){const result={};while(cursor<tokens.length){const key=tokens[cursor++];if(key==='}')return result;const value=tokens[cursor++];result[key]=value==='{'?object():value;}throw Error('Unterminated block');}
const kits={};
for(let index=0;index<tokens.length-1;index++)if(tokens[index]==='paint_kits'&&tokens[index+1]==='{'){
  cursor=index+2;const section=object();for(const [id,kit]of Object.entries(section))kits[id]={...kits[id],...kit};index=cursor-1;
}
const kitByName=new Map(Object.values(kits).map(k=>[k.name,k]));

const FAMILY_ZH={sporty:'运动手套',specialist:'专业手套',bloodhound:'猎血手套',handwrap:'缠手绷带',motorcycle:'驾驶手套',slick:'精英手套',operation10:'狂牙手套',brokenfang:'狂牙手套'};

function displayName(paintId){
  const kit=kitByName.get(paintId);
  if(kit){
    for(const key of [kit.description_tag,`#PaintKit_${kit.name}_Tag`,`#PaintKit_${kit.name}`]){
      if(!key)continue;
      const v=chinese.get(key.replace(/^#/,'').toLowerCase())||english.get(key.replace(/^#/,'').toLowerCase());
      if(v&&v!=='[english]')return v;
    }
  }
  // A few glove paints never got a game-visible name; title-case the paint key.
  return paintId.split('_').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
}

const files=fs.readdirSync(DEST).filter(f=>f.endsWith('.glb')).sort();
fs.mkdirSync(PREV,{recursive:true});
const rows=[];
let extracted=0;
for(const file of files){
  const id=file.replace(/\.glb$/,'');
  const fam=id.split('_')[0];
  const name=displayName(id)||id.replace(/_/g,' ');
  const family=FAMILY_ZH[fam]||fam;

  // Extract the inventory preview; a webp produced earlier (or baked from the
  // model for paints the VPK never shipped an icon for) is used as-is.
  let preview=null;
  const webp=path.join(PREV,id+'.webp');
  if(!fs.existsSync(webp)){
    const src=previews.get(id);
    if(src){
      const png=path.join(PREV,id+'.png');
      spawnSync(cli,['-i',vpk,'-f',src,'-o',png,'-d'],{stdio:'ignore',timeout:120000});
      if(fs.existsSync(png)){
        spawnSync('python',['-c',
          `from PIL import Image;im=Image.open(${JSON.stringify(png)}).convert('RGBA');im.thumbnail((512,512),Image.Resampling.LANCZOS);im.save(${JSON.stringify(webp)},'WEBP',quality=92)`],
          {stdio:'ignore',timeout:60000});
        fs.unlinkSync(png);
      }
    }
  }
  if(fs.existsSync(webp)){
    preview=`assets/viewmodel/gloves/previews/${id}.webp`;
    extracted++;
  }

  const b=fs.readFileSync(path.join(DEST,file));
  rows.push({id,weapon:'gloves',name,family,englishName:id,model:`assets/viewmodel/gloves/${file}`,
    bytes:b.length,sha256:createHash('sha256').update(b).digest('hex'),
    ...(preview?{preview,previewBytes:fs.statSync(path.join(PREV,id+'.webp')).size,previewSha256:createHash('sha256').update(fs.readFileSync(path.join(PREV,id+'.webp'))).digest('hex')}:{})});
}

const out=`// Baked glove models: original CS2 glove mesh merged with the weapon_arms
// skeleton, one self-contained GLB per paint. Names come from CS2's own
// localisation; previews are the game's inventory images.
export const GLOVES = Object.freeze(${JSON.stringify(rows,null,2)}.map(glove => Object.freeze(glove)));
const byId=new Map(GLOVES.map(glove=>[glove.id,glove]));
export function getGlove(id){return typeof id==='string'?byId.get(id):undefined;}
export const DEFAULT_GLOVE='sporty_green';
`;
fs.writeFileSync(path.join(root,'shared/gloves.js'),out);
console.log(`GLOVES: ${rows.length} 条 | 预览图 ${extracted} 张`);
console.log('样例:');
for(const r of rows.slice(0,5))console.log(`  ${r.id}  ${r.name}  (${r.family})`);
