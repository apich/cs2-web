// 库存页的过滤 / 搜索 / 排序与装备状态推导。
// 与 DOM 无关，放在 shared/ 以便 node:test 直接覆盖；client/inventory-view.js 只负责渲染。
import { SKINS, DEFAULT_SKINS } from './skins.js';
import { GLOVES } from './gloves.js';
import { AGENT_CATALOG } from './agents.js';
import { canTeamUseWeapon } from './weapons.js';
import { rarityRank } from '../client/skin-rarity.js';

// 展示品（不可装备，仅陈列）：用现有 CS2 图标 + CSS 绘制
export const SHOWCASE = Object.freeze([
  { id: 'coin-veteran', name: '5 年老兵硬币', kind: 'coin', flavor: '五年生涯纪念' },
  { id: 'graffiti-heart', name: '涂鸦 | 心 [藕色]', kind: 'graffiti', flavor: '艺术作品' },
  { id: 'c4-display', name: 'C4 炸弹', kind: 'c4', flavor: '展示品' },
  { id: 'charm-keychain', name: '挂件 | 拆卸器', kind: 'charm', flavor: '挂件' },
]);

// 装备状态机：need-download → downloading → ready → confirming → equipped / failed。
const EQUIP_STATE = Object.freeze({
  EQUIPPED_CT: 'equipped-ct', EQUIPPED_T: 'equipped-t', EQUIPPED_BOTH: 'equipped-both',
  BLOCKED: 'blocked', NEED_DOWNLOAD: 'need-download', DOWNLOADING: 'downloading',
  CONFIRMING: 'confirming', FAILED: 'failed', READY: 'ready',
});
export { EQUIP_STATE };

const itemName = it => it.skin ? it.skin.name : it.agent ? it.agent.name : it.glove ? it.glove.name : it.showcase.name;

/** 过滤 + 搜索 + 排序。
 *  sort 'default' 保持目录内置顺序——shared/skins.js 没有可靠的获取时间字段，
 *  所以不提供"最新"，也不伪造日期。 */
export function filterItems(filter, query, sort) {
  let list = [];
  if (filter === 'art') {
    list = SHOWCASE.filter(s => s.kind === 'graffiti').map(showcase => ({ showcase }));
  } else if (filter === 'showcase') {
    list = SHOWCASE.map(s => ({ showcase: s }));
  } else if (filter === 'agents') {
    list = AGENT_CATALOG.map(a => ({ agent: a }));
  } else if (filter === 'gloves') {
    list = GLOVES.map(g => ({ glove: g }));
  } else if (filter === 'knives') {
    list = SKINS.filter(s => s.weapon === 'knife').map(s => ({ skin: s }));
  } else if (filter === 'gear') {
    list = SKINS.map(s => ({ skin: s }));
  } else {
    list = [...SKINS.map(s => ({ skin: s })), ...AGENT_CATALOG.map(a => ({ agent: a })), ...GLOVES.map(g => ({ glove: g })), ...SHOWCASE.map(s => ({ showcase: s }))];
  }
  if (query) {
    const needle = String(query).toLowerCase();
    list = list.filter(({ skin, agent, glove, showcase }) => {
      const text = skin ? `${skin.name} ${skin.englishName || ''} ${skin.weapon}`
        : agent ? `${agent.name} ${agent.id}`
        : glove ? `${glove.name} ${glove.englishName || ''} ${glove.family}`
        : `${showcase.name}`;
      return text.toLowerCase().includes(needle);
    });
  }
  if (sort === 'name') {
    list.sort((a, b) => itemName(a).localeCompare(itemName(b), 'zh-Hans-CN'));
  } else if (sort === 'rarity') {
    list.sort((a, b) => (b.skin ? rarityRank(b.skin) : -1) - (a.skin ? rarityRank(a.skin) : -1));
  }
  // 'default'：保持内置顺序。
  return list;
}

/** 该物品当前的已装备状态：CT / T / 双阵营，并遵守武器阵营限制。
 *  CT/T 各一套 loadout，任一阵营装备即视为已装备，双阵营都装备是 EQUIPPED_BOTH。
 *  武器不能被某阵营使用时，那一阵营的配置不计入。 */
export function equipStateOf(skin, loadouts) {
  const ctOk = canTeamUseWeapon('CT', skin.weapon);
  const tOk = canTeamUseWeapon('T', skin.weapon);
  if (!ctOk && !tOk) return EQUIP_STATE.BLOCKED;
  const ct = ctOk && (loadouts.ct?.[skin.weapon] || DEFAULT_SKINS[skin.weapon]) === skin.id;
  const t = tOk && (loadouts.t?.[skin.weapon] || DEFAULT_SKINS[skin.weapon]) === skin.id;
  if (ct && t) return EQUIP_STATE.EQUIPPED_BOTH;
  if (ct) return EQUIP_STATE.EQUIPPED_CT;
  if (t) return EQUIP_STATE.EQUIPPED_T;
  return EQUIP_STATE.READY;
}

/** 该物品能否装备到指定阵营（遵守武器阵营限制）。 */
export function canEquipToTeam(skin, team) { return canTeamUseWeapon(team, skin.weapon); }
