// Reconciles the painted-finish count per gun against what the VPK actually
// ships.
//
// Two counting methods disagree, and only the second is authoritative:
//
//   1. `paintkit-candidates.json` (index-paintkits.mjs) counts paintkits whose
//      *material file* `paints/vmats/<kit.name>.vmat_c` exists. Patterned
//      finishes are re-authored per weapon and get a different paint key
//      (`aq_ak47_cartel`, `am_ak47_sparkle_gold`), so this method only sees the
//      shared material and undercounts.
//   2. Counting the inventory previews
//      `panorama/images/econ/default_generated/weapon_<inv>_*_light_png.vtex_c`
//      counts every finish actually offered for that weapon, including the
//      per-weapon re-authors. One preview per finish (_light; _heavy/_medium are
//      the same paint on different wear tiles).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readVpkIndex} from '../../tools/vpk-index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const game=process.env.CS2_GAME_DIR||'E:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const entries=readVpkIndex(path.join(game,'pak01_dir.vpk')).entries.map(e=>e.path);

const {SKINS}=await import(pathToFileURL(path.join(root,'shared/skins.js')).href);
const candidates=JSON.parse(fs.readFileSync(path.join(root,'artifacts/weapon-expansion/paintkit-candidates.json'),'utf8'));

// index-paintkits.mjs's weapon -> inventory name map.
const INVENTORY={elite:'elite',p250:'p250',fiveseven:'fiveseven',deagle:'deagle',nova:'nova',mag7:'mag7',mp9:'mp9',mp7:'mp7',bizon:'bizon',scar20:'scar20',m4a4:'m4a1',ssg08:'ssg08',tec9:'tec9',xm1014:'xm1014',sawedoff:'sawedoff',mac10:'mac10',galilar:'galilar',sg553:'sg556',ak47:'ak47',m4a1:'m4a1',awp:'awp',pistol:'glock',usp:'usp',knife:'knife'};

const perModel=new Map();
for(const entry of entries){
  const m=entry.match(/default_generated\/weapon_([a-z0-9_]+?)_(.+?)_light_png\.vtex_c$/);
  if(!m)continue;
  const inv=m[1];
  if(!perModel.has(inv))perModel.set(inv,new Set());
  perModel.get(inv).add(m[2]);
}

const rows=[];
for(const [weapon,inv] of Object.entries(INVENTORY)){
  const counted=candidates.weapons[weapon]?.length||0;
  const actual=perModel.get(inv)?.size||0;
  const shipped=SKINS.filter(s=>s.weapon===weapon&&s.paintkit).length;
  rows.push({weapon,inv,counted,actual,shipped,missing:Math.max(0,actual-shipped)});
}
rows.sort((a,b)=>b.missing-a.missing);

console.log('武器'.padEnd(10),'inventory'.padEnd(15),'枚举口径','VPK 实际','已接入','缺口');
let t1=0,t2=0,t3=0,t4=0;
for(const r of rows){
  console.log(r.weapon.padEnd(10),r.inv.padEnd(15),String(r.counted).padStart(8),String(r.actual).padStart(9),String(r.shipped).padStart(7),String(r.missing).padStart(5));
  t1+=r.counted;t2+=r.actual;t3+=r.shipped;t4+=r.missing;
}
console.log();
console.log('合计'.padEnd(10),' '.padEnd(15),String(t1).padStart(8),String(t2).padStart(9),String(t3).padStart(7),String(t4).padStart(5));
console.log();
console.log(`枚举口径漏掉的油漆变体: ${t2-t1}`);
console.log(`真实缺口(可烘焙但未接入): ${t4}`);
