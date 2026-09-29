// Counts every finish available on each knife model, derived from the inventory
// previews that actually ship in the VPK. Doppler phases and other patterned
// finishes are re-authored per model, so a knife's finish set is NOT a copy of
// the karambit list and must be counted per model.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readVpkIndex} from '../../tools/vpk-index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const game=process.env.CS2_GAME_DIR||'E:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const entries=readVpkIndex(path.join(game,'pak01_dir.vpk')).entries.map(e=>e.path);

// One preview per finish; the heavy/medium variants are the same paint on
// different wear tiles and are excluded from the count.
const perModel=new Map();
for(const p of entries){
  const m=p.match(/default_generated\/weapon_knife_([a-z0-9_]+?)_(.+?)_light_png\.vtex_c$/);
  if(!m)continue;
  const model='knife_'+m[1];
  if(!perModel.has(model))perModel.set(model,new Set());
  perModel.get(model).add(m[2]);
}

// The karambit catalog already shipped has these finishes; anything else on the
// karambit is also still outstanding.
const shipped=new Set(['am_sapphire_marbleized','am_blackpearl_marbleized','aa_fade',
  'hy_forest_ddpat','cu_web_gun','am_night','aq_oiled','aq_blued','aq_steel',
  'cu_bloodsport_gloves','hy_waves','hy_arid','am_urban_masked','aq_sand','am_tiger_tooth',
  'aq_damascus','am_marble_fade','aq_steel_inferno','am_doppler_phase1','am_doppler_phase2',
  'am_doppler_phase3','am_doppler_phase4','cu_medieval_dragon_awp','hy_ak47_asiimov',
  'am_emerald_marbleized','am_gamma_doppler_phase1','am_gamma_doppler_phase2',
  'am_gamma_doppler_phase3','am_gamma_doppler_phase4','cu_ak47_asiimov','aa_fade_metallic',
  'am_nightburst','aq_steel_knife']);

const rows=[...perModel.entries()].map(([model,set])=>({model,count:set.size}));
rows.sort((a,b)=>b.count-a.count);
console.log('刀型'.padEnd(22),'VPK 中可用涂装');
for(const r of rows)console.log(r.model.padEnd(22),String(r.count).padStart(4));
const total=rows.reduce((s,r)=>s+r.count,0);
const karambit=rows.find(r=>r.model==='knife_karambit')?.count||0;
console.log();
console.log('全部刀型合计:',total);
console.log('已接入(爪刀):',karambit);
console.log('尚未接入:',total-karambit);
