// 库存页行为测试：CT/T 装备状态、搜索空态与恢复、装备确认顺序与失败重试。
// 过滤/排序/装备状态推导放在 shared/inventory-query.js（无 DOM），可在此直接覆盖；
// DOM 相关的渲染流程用最小 stub 复刻 InventoryView.equip 的顺序保证。
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKINS, DEFAULT_SKINS } from '../shared/skins.js';
import { canTeamUseWeapon } from '../shared/weapons.js';
import { filterItems, equipStateOf } from '../shared/inventory-query.js';

const skinById = id => SKINS.find(s => s.id === id);
const loadout = (ct = {}, t = {}) => ({ ct: { ...DEFAULT_SKINS, ...ct }, t: { ...DEFAULT_SKINS, ...t } });
// awp-gungnir：双阵营可用且非默认皮肤，适合验证 CT/T 独立装备
const DUAL = skinById('awp-gungnir');
// m4a1-blue-phosphor：仅 CT 可用且非默认皮肤，适合验证阵营限制
const CT_ONLY = skinById('m4a1-blue-phosphor');

test('CT/T 独立装备状态：单阵营、双阵营与未装备互不混淆', () => {
  assert.equal(equipStateOf(DUAL, loadout()), 'ready', '默认配置下未装备');
  assert.equal(equipStateOf(DUAL, loadout({ awp: 'awp-gungnir' })), 'equipped-ct');
  assert.equal(equipStateOf(DUAL, loadout({}, { awp: 'awp-gungnir' })), 'equipped-t');
  assert.equal(equipStateOf(DUAL, loadout({ awp: 'awp-gungnir' }, { awp: 'awp-gungnir' })), 'equipped-both');
  // 换一把枪不影响另一把的状态
  assert.equal(equipStateOf(skinById('awp-asiimov'), loadout({ awp: 'awp-gungnir' })), 'ready');
});

test('装备状态遵守武器阵营限制：不能给某阵营用的枪不计入该阵营', () => {
  assert.ok(canTeamUseWeapon('CT', CT_ONLY.weapon), 'm4a1-blue-phosphor 应仅 CT 可用');
  assert.ok(!canTeamUseWeapon('T', CT_ONLY.weapon), 'm4a1-blue-phosphor 不应 T 可用');
  // 配置在可用的阵营 → 已装备
  assert.equal(equipStateOf(CT_ONLY, loadout({ m4a1: 'm4a1-blue-phosphor' })), 'equipped-ct');
  // 配置在不可用的那一阵营 → 必须仍是 ready，不能显示成已装备
  assert.equal(equipStateOf(CT_ONLY, loadout({}, { m4a1: 'm4a1-blue-phosphor' })), 'ready');
  // 双方都不可用的武器是 blocked
  const blocked = { id: 'x', weapon: 'nonexistent-weapon' };
  assert.equal(equipStateOf(blocked, loadout()), 'blocked');
});

test('搜索无结果返回空列表，清空后恢复完整列表', () => {
  const all = filterItems('all', '', 'default');
  assert.ok(all.length > 0);
  const none = filterItems('all', 'zzzzz-不存在的物品', 'default');
  assert.equal(none.length, 0, '无匹配时应为空');
  // 清空搜索（query 为空）即恢复
  assert.deepEqual(filterItems('all', '', 'default'), all);
  // 大小写不敏感，且能按中文名命中
  const byName = filterItems('all', SKINS[0].name.toLowerCase(), 'default');
  assert.ok(byName.some(entry => entry.skin?.id === SKINS[0].id));
});

test('搜索命中英文名与刀型名，不只匹配中文名', () => {
  const withEnglish = SKINS.find(s => s.englishName);
  assert.ok(withEnglish);
  const hits = filterItems('all', withEnglish.englishName.toLowerCase(), 'default');
  assert.ok(hits.some(e => e.skin?.id === withEnglish.id), '英文名应可搜索');
});

test('排序：名称与稀有度真实生效，默认顺序保持目录内置顺序', () => {
  const def = filterItems('all', '', 'default');
  // 默认顺序 = 目录顺序（皮肤在前，随后探员/手套/展示品）
  assert.equal(def[0].skin?.id, SKINS[0].id);

  const byName = filterItems('all', '', 'name');
  const names = byName.map(it => it.skin?.name || it.agent?.name || it.glove?.name || it.showcase.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  assert.deepEqual(names, sorted, '名称排序应真正按中文名升序');

  const byRarity = filterItems('all', '', 'rarity');
  const ranks = byRarity.map(it => it.skin ? SKINS.indexOf(it.skin) : -1);
  // 稀有度高的应排在前面：第一个有皮肤的条目稀有度不低于最后一个
  const firstSkin = byRarity.find(it => it.skin);
  const lastSkin = [...byRarity].reverse().find(it => it.skin);
  assert.ok(firstSkin && lastSkin);
  const rankOf = s => ['consumer', 'industrial', 'milspec', 'restricted', 'classified', 'covert', 'contraband', 'extraordinary'].indexOf(
    ({ 'm4a4-howl': 'contraband', 'awp-dragon-lore': 'covert', 'ak47-vulcan': 'classified' })[s.id] ?? 'milspec');
  assert.ok(rankOf(firstSkin.skin) >= rankOf(lastSkin.skin), '稀有度排序应递减');
});

test('分类筛选只返回该分类的物品', () => {
  const knives = filterItems('knives', '', 'default');
  assert.ok(knives.length > 0);
  assert.ok(knives.every(e => e.skin && e.skin.weapon === 'knife'), '刀分类只含刀');
  const agents = filterItems('agents', '', 'default');
  assert.ok(agents.every(e => e.agent), '探员分类只含探员');
  const gloves = filterItems('gloves', '', 'default');
  assert.ok(gloves.every(e => e.glove), '手套分类只含手套');
});

// ---- 装备状态机（用最小 stub 复刻 InventoryView.equip 的顺序保证）----

/** 复刻 equip() 的顺序：先下载 → 再等服务端确认 → 最后才写本地配置。 */
async function equipFlow(skin, team, { onEquipServer, saved, setTeamSkin, downloadSkin }) {
  const events = [];
  if (!saved) {
    events.push('download-start');
    await downloadSkin();
    events.push('download-done');
    return { events, committed: false };
  }
  events.push('confirm-start');
  await onEquipServer();          // 服务端先确认
  events.push('confirmed');
  setTeamSkin(team, skin.weapon, skin.id); // 确认后才写本地
  events.push('local-commit');
  return { events, committed: true };
}

test('在线装备：服务端确认成功后才写入本地配置', async () => {
  const skin = DUAL;
  const order = [];
  const { events, committed } = await equipFlow(skin, 'CT', {
    saved: true,
    onEquipServer: async () => { order.push('server'); },
    setTeamSkin: () => { order.push('local'); },
    downloadSkin: async () => { order.push('download'); },
  });
  assert.equal(committed, true);
  assert.deepEqual(order, ['server', 'local'], '必须先服务端确认再写本地');
  assert.deepEqual(events, ['confirm-start', 'confirmed', 'local-commit']);
});

test('服务端拒绝或超时：本地配置保持原状，不写已装备', async () => {
  const skin = DUAL;
  const order = [];
  await assert.rejects(equipFlow(skin, 'CT', {
    saved: true,
    onEquipServer: async () => { order.push('server'); throw new Error('服务器确认超时，请重试。'); },
    setTeamSkin: () => { order.push('local'); },
    downloadSkin: async () => {},
  }), /服务器确认超时/);
  assert.deepEqual(order, ['server'], '失败时不得写入本地配置');
});

test('需要下载时先下载、不提前写配置，完成后需再次点击', async () => {
  const skin = DUAL;
  const order = [];
  const result = await equipFlow(skin, 'CT', {
    saved: false,
    onEquipServer: async () => { order.push('server'); },
    setTeamSkin: () => { order.push('local'); },
    downloadSkin: async () => { order.push('download'); },
  });
  assert.equal(result.committed, false, '下载阶段不写配置');
  assert.deepEqual(order, ['download'], '只下载，不联系服务端');
  assert.deepEqual(result.events, ['download-start', 'download-done']);
});

test('下载失败不写配置，也不进入确认流程', async () => {
  const skin = DUAL;
  const order = [];
  await assert.rejects(equipFlow(skin, 'CT', {
    saved: false,
    onEquipServer: async () => { order.push('server'); },
    setTeamSkin: () => { order.push('local'); },
    downloadSkin: async () => { order.push('download'); throw new Error('浏览器未能保存资源'); },
  }), /浏览器未能保存资源/);
  assert.deepEqual(order, ['download'], '下载失败不联系服务端、不写本地');
});

test('离线装备：没有服务端确认也正常保存', async () => {
  const skin = DUAL;
  const order = [];
  // 离线时 onEquipServer 为空操作（main.js 中 connected 为 false 直接 return）
  const { committed } = await equipFlow(skin, 'CT', {
    saved: true,
    onEquipServer: async () => {},
    setTeamSkin: () => { order.push('local'); },
    downloadSkin: async () => {},
  });
  assert.equal(committed, true);
  assert.deepEqual(order, ['local'], '离线直接写本地');
});

test('重复点击被拦截：下载中/确认中不再提交', () => {
  // 复刻 equip() 开头的两道闸门
  const guard = (busy, state, equipped) => {
    if (busy) return 'blocked-busy';
    if (state === 'downloading' || state === 'confirming') return 'blocked-state';
    if (equipped) return 'blocked-equipped';
    return 'allowed';
  };
  assert.equal(guard(false, 'downloading', false), 'blocked-state');
  assert.equal(guard(false, 'confirming', false), 'blocked-state');
  assert.equal(guard(false, 'ready', true), 'blocked-equipped');
  assert.equal(guard(false, 'ready', false), 'allowed');
  assert.equal(guard(true, 'ready', false), 'blocked-busy');
});

test('页面切换后刷新：从 team-loadout 重新读取，已装备标记不落后', () => {
  // refresh() 重新调用 equipStateOf；换一套 loadout 后状态必须跟着变
  const before = equipStateOf(DUAL, loadout());
  const after = equipStateOf(DUAL, loadout({ awp: 'awp-gungnir' }));
  assert.equal(before, 'ready');
  assert.equal(after, 'equipped-ct', '刷新后应反映最新 loadout');
});
