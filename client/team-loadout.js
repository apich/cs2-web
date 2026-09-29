// CT / T 独立枪械皮肤配置（plan.md 步骤 3）。存 dust2.loadout.v2 = {ct:{...}, t:{...}}，
// 从旧 dust2.skins.v1（单套）迁移；进游戏时按实际分队用 equipSkin 同步给服务器。
import { preferences } from './persistence.js';
import { queueProfileSave } from './account.js';
import { SKINS, DEFAULT_SKINS, getSkin, normalizeSkinLoadout } from '../shared/skins.js';

const STORAGE_KEY = 'dust2.loadout.v2';
const LEGACY_KEY = 'dust2.skins.v1';

function read() {
  try {
    const saved = JSON.parse(preferences.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.ct && saved.t) return { ct: normalizeSkinLoadout(saved.ct), t: normalizeSkinLoadout(saved.t) };
  } catch {}
  let legacy = {};
  try { legacy = JSON.parse(preferences.getItem(LEGACY_KEY) || '{}'); } catch {}
  const base = normalizeSkinLoadout(legacy);
  return { ct: { ...base }, t: { ...base } };
}

let loadouts = read();
function persist() { preferences.setItem(STORAGE_KEY, JSON.stringify(loadouts)); queueProfileSave(); }

export function getTeamLoadout(team) { return { ...(team === 'CT' ? loadouts.ct : loadouts.t) }; }
export function getJoinLoadout() { return getTeamLoadout('CT'); } // 进房先带 CT 套，分队后按队同步
export function setTeamSkin(team, weapon, skinId) {
  const key = team === 'CT' ? 'ct' : 't';
  const skin = getSkin(skinId);
  if (!skin || skin.weapon !== weapon) return getTeamLoadout(team);
  loadouts = { ...loadouts, [key]: { ...loadouts[key], [weapon]: skinId } };
  persist();
  return getTeamLoadout(team);
}
export function equippedSkinId(team, weapon) { return getTeamLoadout(team)[weapon] || DEFAULT_SKINS[weapon]; }
export function skinsForWeapon(weapon) { return SKINS.filter(s => s.weapon === weapon); }
