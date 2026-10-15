// 直接执行两个视图的生产方法，仅替换资源、存储和 DOM 边界。
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { getSkin } from '../shared/skins.js';

const io = globalThis.__inventoryFlowTest = {};
const hook = registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    const stubs = {
      'skin-assets.js': 'export const skinSaved=(...a)=>globalThis.__inventoryFlowTest.saved(...a), downloadSkin=(...a)=>globalThis.__inventoryFlowTest.download(...a), loadSkin=async()=>{};',
      'team-loadout.js': 'export const setTeamSkin=(...a)=>globalThis.__inventoryFlowTest.commit(...a), getTeamLoadout=()=>({}), equippedSkinId=()=>"", skinsForWeapon=()=>[];',
      'agent-arms.js': 'export const loadGloveArms=async()=>{};',
      'player-assets.js': 'export const loadAgent=async()=>{};',
      'agent-menu.js': 'export const readAgentLoadout=()=>({}), saveAgentLoadout=()=>{};',
      'morph-icons.js': 'export const mountMorphIcons=()=>{};',
      'persistence.js': 'export const preferences={getItem:()=>null,setItem:()=>{}};',
    };
    const source = url.includes('/client/') && stubs[url.split('/').at(-1)];
    return source ? { format: 'module', source, shortCircuit: true } : next(url, context);
  },
});
const { InventoryView } = await import('../client/inventory-view.js');
const { LoadoutView } = await import('../client/loadout-view.js');
hook.deregister();

function viewOf(Type) {
  return Object.assign(Object.create(Type.prototype), {
    busy: false, activeTeam: 'CT', downloaded: new Set(), equipState: new Map(),
    error: '', detail: null, onEquipServer: async () => {},
    render() {}, renderDetail() {}, renderInventory() {}, note() {}, invStatus() {},
  });
}

test('真实库存下载流程进入 downloading，完成后 ready，重复点击不再下载', async () => {
  const view = viewOf(InventoryView);
  const skin = { ...getSkin('awp-gungnir'), downloadRequired: true };
  let finish;
  let downloads = 0;
  io.saved = async () => false;
  io.download = () => { downloads++; return new Promise(resolve => { finish = resolve; }); };
  io.commit = () => assert.fail('下载阶段不能保存装备');
  const pending = view.equip(skin, 'CT');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.equipState.get(skin.id), 'downloading');
  await view.equip(skin, 'CT');
  assert.equal(downloads, 1);
  finish(true);
  await pending;
  assert.equal(view.equipState.get(skin.id), 'ready');
  assert.equal(view.busy, false);
});

for (const Type of [InventoryView, LoadoutView]) {
  test(`${Type.name} 真实装备方法：服务器拒绝不保存，重试成功才提交`, async () => {
    const view = viewOf(Type);
    const skin = getSkin('awp-gungnir');
    const events = [];
    io.saved = async () => true;
    io.commit = () => events.push('commit');
    view.onEquipServer = async () => { events.push('reject'); throw Error('拒绝'); };
    await view.equip(skin, 'CT');
    assert.deepEqual(events, ['reject']);
    assert.equal(view.busy, false);
    view.onEquipServer = async () => events.push('confirm');
    await view.equip(skin, 'CT');
    assert.deepEqual(events, ['reject', 'confirm', 'commit']);
  });

  test(`${Type.name} 拒绝跨阵营武器，离线确认后可以保存`, async () => {
    const view = viewOf(Type);
    const events = [];
    io.saved = async () => true;
    io.commit = (...args) => events.push(args);
    view.activeTeam = 'T';
    await view.equip(getSkin('m4a1-blue-phosphor'), 'T');
    assert.deepEqual(events, []);
    view.activeTeam = 'CT';
    await view.equip(getSkin('awp-gungnir'), 'CT');
    assert.deepEqual(events, [['CT', 'awp', 'awp-gungnir']]);
  });
}

test('真实库存下载失败保留失败物品标识，释放 busy 后可重试', async () => {
  const view = viewOf(InventoryView);
  const skin = { ...getSkin('awp-gungnir'), downloadRequired: true };
  io.saved = async () => false;
  io.download = async () => false;
  io.commit = () => assert.fail('保存失败时不能装备');
  await view.equip(skin, 'CT');
  assert.equal(view.equipState.get(skin.id), 'failed');
  assert.equal(view.errorSkinId, skin.id);
  assert.equal(view.busy, false);
  io.download = async () => true;
  await view.equip(skin, 'CT');
  assert.equal(view.equipState.get(skin.id), 'ready');
  assert.equal(view.error, '');
});
