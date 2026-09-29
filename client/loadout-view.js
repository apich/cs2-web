// 「武器装备」视图（对照录屏 20260928-0644-30）：
// 上方布局固定：左=CT（外缘槽位+人物）｜中=武器装备栏（始终在此）｜右=T（人物+外缘槽位）。
// 点警/匪人物只切换选中边（提亮），中间栏换显示该边的枪械，任何元素不移动。
// 下方库存网格可滚动、卡片加大；点枪械格按枪过滤，点物品即装备。
// 探员与枪械皮肤共用同一套底部库存卡片：点探员槽过滤出该边探员，点/拖即装备。
// 比赛可带枪械以 shared/weapons.js 的 TEAM_LOADOUTS 为准。
import { setTeamSkin, getTeamLoadout, equippedSkinId, skinsForWeapon } from './team-loadout.js';
import { getWeapon, TEAM_LOADOUTS } from '../shared/weapons.js';
import { getSkin, SKINS } from '../shared/skins.js';
import { AGENT_CATALOG, getAgent, normalizeAgentLoadout } from '../shared/agents.js';
import { GLOVES, getGlove, DEFAULT_GLOVE } from '../shared/gloves.js';
import { loadSkin, skinSaved, downloadSkin } from './skin-assets.js';
import { loadAgent } from './player-assets.js';
import { loadGloveArms } from './agent-arms.js';
import { readAgentLoadout, saveAgentLoadout } from './agent-menu.js';
import { mountMorphIcons } from './morph-icons.js';
import { rarityOf } from './skin-rarity.js';
import { preferences } from './persistence.js';
import './loadout.css';

const TEAM_LABEL = { CT: '反恐精英', T: '恐怖分子' };
const agentPreview = id => `assets/characters-cs2/previews/${id}.webp`;
const glovePreview = id => {
  const glove = getGlove(id);
  return glove?.preview || `assets/viewmodel/gloves/previews/${id}.webp`;
};
const weaponName = id => getWeapon(id)?.name || id;

const GLOVE_KEY = 'dust2.gloves.v1';
export function readGloveLoadout() {
  try {
    const id = JSON.parse(preferences.getItem(GLOVE_KEY) || 'null');
    return getGlove(id)?.id || DEFAULT_GLOVE;
  } catch { return DEFAULT_GLOVE; }
}
export function saveGloveLoadout(id) {
  try { preferences.setItem(GLOVE_KEY, JSON.stringify(getGlove(id)?.id || DEFAULT_GLOVE)); } catch { /* storage full */ }
}

function categoriesFor(team) {
  const groups = TEAM_LOADOUTS[team];
  const starter = team === 'CT' ? ['usp'] : ['pistol'];
  return [
    { key: 'starter', label: '起始手枪', weapons: starter },
    { key: 'secondary', label: '其他手枪', weapons: groups.pistols.filter(id => !starter.includes(id)) },
    { key: 'mid', label: '中级', weapons: groups.mid },
    { key: 'rifle', label: '步枪', weapons: groups.rifles },
  ];
}

const SLOTS = [
  { key: 'agent', label: '探员' },
  { key: 'gloves', label: '手套' },
  { key: 'knife', label: '刀' },
  { key: 'pistol', label: '手枪', locked: true },
  { key: 'graffiti', label: '涂鸦', locked: true },
  { key: 'coin', label: '徽章', locked: true },
  { key: 'wish', label: '愿望单', locked: true },
];

function slotsHTML(team, agents) {
  const agentId = agents[team] || (team === 'CT' ? 'ct-sas' : 't-phoenix');
  return `<div class="loadout-slots">${SLOTS.map(slot => {
    const img = slot.key === 'agent' ? agentPreview(agentId)
      : slot.key === 'gloves' ? glovePreview(readGloveLoadout())
      : slot.key === 'knife' ? (getSkin(equippedSkinId(team, 'knife'))?.preview || '') : '';
    return `<button type="button" class="loadout-slot${slot.locked ? ' slot-locked' : ''}" data-slot="${slot.key}" data-team="${team}"${slot.locked ? ' disabled' : ''}>
      ${img ? `<img src="${img}" alt="">` : `<span class="slot-placeholder">${slot.label}</span>`}
    </button>`;
  }).join('')}</div>`;
}

export class LoadoutView {
  constructor({ root, onEquipServer = async () => {}, onEquipAgent = async () => {} }) {
    this.root = root;
    this.onEquipServer = onEquipServer;
    this.onEquipAgent = onEquipAgent;
    this.busy = false;
    this.downloaded = new Set();
    this.activeTeam = 'CT';
    this.selection = null; // {weapon} | null
    root.innerHTML = `
      <div class="loadout-screen">
        <div class="loadout-upper">
          <section class="loadout-side side-ct" data-side="CT">
            <header class="loadout-side-head"><span class="loadout-team-chip">CT</span><div><b>反恐精英</b><small>装备 CT</small></div></header>
            <div class="loadout-side-body"></div>
          </section>
          <div class="loadout-center">
            <div class="loadout-ghosts" aria-hidden="true"></div>
            <div class="loadout-cats"></div>
            <div class="loadout-ghosts" aria-hidden="true"></div>
          </div>
          <section class="loadout-side side-t" data-side="T">
            <header class="loadout-side-head"><span class="loadout-team-chip">T</span><div><b>恐怖分子</b><small>装备 T</small></div></header>
            <div class="loadout-side-body"></div>
          </section>
        </div>
        <div class="loadout-inventory">
          <header class="inv-toolbar">
            <button type="button" class="inv-filter" id="inv-show-all"><span class="mi" data-icon="filter"></span><span class="inv-filter-label">所有物品</span></button>
            <button type="button" class="inv-sort"><span class="mi" data-icon="sort"></span><span>最新</span></button>
          </header>
          <div class="inv-grid"></div>
          <div class="inv-status" role="status"></div>
        </div>
      </div>`;
    mountMorphIcons(root);
    root.querySelector('#inv-show-all').addEventListener('click', () => { this.selection = null; this.statusMessage = ''; this.renderCenter(); this.renderInventory(); });
    for (const side of root.querySelectorAll('.loadout-side')) {
      side.addEventListener('click', () => {
        if (this.activeTeam === side.dataset.side) return;
        this.activeTeam = side.dataset.side;
        this.selection = null;
        this.statusMessage = '';
        this.render();
      });
    }
    this.render();
    this.renderInventory();
    this.refreshDownloads();
  }

  async refreshDownloads() {
    for (const skin of SKINS.filter(s => s.downloadRequired)) {
      if (await skinSaved(skin)) this.downloaded.add(skin.id);
      else this.downloaded.delete(skin.id);
    }
    this.renderInventory();
  }

  render() {
    // 两侧人物/槽位常驻，仅刷新装备预览；布局不动
    const agents = readAgentLoadout();
    for (const team of ['CT', 'T']) {
      const side = this.root.querySelector(`.loadout-side[data-side="${team}"]`);
      side.classList.toggle('is-selected', this.activeTeam === team);
      const body = side.querySelector('.loadout-side-body');
      body.innerHTML = `<img class="loadout-character" src="${agentPreview(agents[team] || (team === 'CT' ? 'ct-sas' : 't-phoenix'))}" alt="${TEAM_LABEL[team]} 探员">${slotsHTML(team, agents)}`;
    }
    this.root.querySelectorAll('.loadout-slot:not(.slot-locked)').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const team = btn.dataset.team;
        if (btn.dataset.slot === 'agent') {
          // 探员与枪械皮肤同款交互：点槽过滤底部库存，不再弹独立菜单
          this.activeTeam = team;
          this.selection = { kind: 'agent' };
          this.statusMessage = '';
          this.render();
          return;
        }
        if (btn.dataset.slot === 'gloves') {
          this.selection = { kind: 'gloves' };
          this.statusMessage = '';
          this.render();
          return;
        }
        // 刀槽：选中该边并过滤刀皮（布局不动）
        this.activeTeam = team;
        this.selection = { weapon: 'knife' };
        this.statusMessage = '';
        this.render();
      });
      if (btn.dataset.slot === 'knife') this.wireDropTarget(btn, 'knife');
      if (btn.dataset.slot === 'agent') this.wireAgentDropTarget(btn);
      if (btn.dataset.slot === 'gloves') this.wireGloveDropTarget(btn);
    });
    this.renderCenter();
    this.renderInventory();
  }

  /** 拖拽装备：把库存皮肤放到对应武器格/刀槽上即装备 */
  wireDropTarget(el, weapon) {
    el.addEventListener('dragover', e => {
      // dragover 期间 getData 受保护，改用实例上记录的拖拽对象
      const skin = getSkin(this.draggingSkinId);
      if (!skin || skin.weapon !== weapon) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const skin = getSkin(e.dataTransfer.getData('text/plain') || this.draggingSkinId);
      if (!skin) return;
      if (skin.weapon !== weapon) {
        this.statusMessage = `${skin.name} 不能装到 ${weaponName(weapon)} 上`;
        this.renderInventory();
        return;
      }
      this.equip(skin);
    });
  }

  /** 探员槽：接受底部探员卡片的拖拽 */
  wireAgentDropTarget(el) {
    el.addEventListener('dragover', e => {
      const agent = this.draggingAgentId ? getAgent(this.draggingAgentId) : null;
      if (!agent || agent.team !== el.dataset.team) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const agent = getAgent(this.draggingAgentId) || getAgent(e.dataTransfer.getData('text/plain'));
      if (!agent || agent.team !== el.dataset.team) return;
      this.equipAgent(agent);
    });
  }

  /** 手套槽：接受底部手套卡片的拖拽 */
  wireGloveDropTarget(el) {
    el.addEventListener('dragover', e => {
      if (!getGlove(this.draggingGloveId)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const glove = getGlove(this.draggingGloveId) || getGlove(e.dataTransfer.getData('text/plain'));
      if (glove) this.equipGlove(glove);
    });
  }

  /** 中间武器装备栏：始终在此，仅随选中边换内容 */
  renderCenter() {
    const team = this.activeTeam;
    for (const ghosts of this.root.querySelectorAll('.loadout-ghosts')) {
      ghosts.innerHTML = ['pistol', 'elite', 'knife', 'ak47', 'awp'].map(id => `<img src="assets/ui-cs2/${id}.svg" alt="">`).join('');
    }
    const cats = this.root.querySelector('.loadout-cats');
    cats.replaceChildren();
    const list = categoriesFor(team);
    for (const column of [[list[0], list[1]], [list[2]], [list[3]]]) {
      const colEl = document.createElement('div');
      colEl.className = 'loadout-col';
      for (const cat of column) {
        const box = document.createElement('div');
        box.className = 'loadout-cat';
        // 行高按枪数均分，避免「起始手枪」单格被撑满整列
        box.style.flexGrow = String(cat.weapons.length);
        box.style.flexBasis = '0';
        box.innerHTML = `<h3><span class="mi" data-icon="filter"></span>${cat.label}</h3>`;
        for (const weapon of cat.weapons) {
          const skin = getSkin(equippedSkinId(team, weapon));
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'loadout-item' + (this.selection?.weapon === weapon ? ' is-selected' : '');
          item.title = `${weaponName(weapon)} · ${skin?.name || ''}`;
          item.dataset.weapon = weapon;
          item.innerHTML = `<img src="${skin?.preview || ''}" alt=""><i class="rarity-bar" style="background:${rarityOf(skin)}"></i>`;
          item.addEventListener('click', () => { this.selection = { weapon }; this.statusMessage = ''; this.renderCenter(); this.renderInventory(); });
          this.wireDropTarget(item, weapon);
          box.append(item);
        }
        colEl.append(box);
      }
      cats.append(colEl);
    }
    mountMorphIcons(cats);
  }

  inventoryItems() {
    // 探员、手套与枪械皮肤共用同一套卡片，只是数据形状不同
    if (this.selection?.kind === 'agent') {
      return AGENT_CATALOG.filter(a => a.team === this.activeTeam).map(agent => ({ type: 'agent', agent }));
    }
    if (this.selection?.kind === 'gloves') {
      return GLOVES.map(glove => ({ type: 'glove', glove }));
    }
    if (this.selection?.weapon) return skinsForWeapon(this.selection.weapon).map(skin => ({ type: 'skin', skin }));
    const team = this.activeTeam;
    const weapons = [...new Set(categoriesFor(team).flatMap(c => c.weapons).concat(['knife']))];
    return SKINS.filter(s => weapons.includes(s.weapon)).map(skin => ({ type: 'skin', skin }));
  }

  renderInventory() {
    const grid = this.root.querySelector('.inv-grid');
    if (!grid) return;
    grid.replaceChildren();
    const equipped = getTeamLoadout(this.activeTeam);
    const agents = readAgentLoadout();
    const equippedGlove = readGloveLoadout();
    const list = this.inventoryItems();
    for (const item of list) {
      const card = document.createElement('button');
      card.type = 'button';
      card.disabled = this.busy;
      card.draggable = !this.busy;
      if (item.type === 'glove') {
        const glove = item.glove;
        card.className = 'inv-item inv-item-glove' + (equippedGlove === glove.id ? ' selected' : '');
        card.dataset.gloveId = glove.id;
        card.innerHTML = `
          <span class="inv-thumb"><img src="${glovePreview(glove.id)}" alt="${glove.name}" loading="lazy"><i class="rarity-bar" style="background:#c98b4a"></i></span>
          <b>${glove.family}</b><small>${glove.name}</small>`;
        card.addEventListener('click', () => this.equipGlove(glove));
        card.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/plain', glove.id);
          e.dataTransfer.effectAllowed = 'copy';
          this.draggingGloveId = glove.id;
          card.classList.add('dragging');
          this.statusMessage = `拖住 ${glove.name} — 放到手套槽上装备`;
          this.invStatus(this.statusMessage);
        });
        card.addEventListener('dragend', () => { this.draggingGloveId = null; card.classList.remove('dragging'); });
      } else if (item.type === 'agent') {
        const agent = item.agent;
        card.className = 'inv-item inv-item-agent' + (agents[agent.team] === agent.id ? ' selected' : '');
        card.dataset.agentId = agent.id;
        card.innerHTML = `
          <span class="inv-thumb"><img src="assets/characters-cs2/previews/${agent.id}.webp" alt="${agent.name}" loading="lazy"><i class="rarity-bar" style="background:#7d6cc4"></i></span>
          <b>${TEAM_LABEL[agent.team]}</b><small>${agent.name}</small>`;
        card.addEventListener('click', () => this.equipAgent(agent));
        card.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/plain', agent.id);
          e.dataTransfer.effectAllowed = 'copy';
          this.draggingAgentId = agent.id;
          card.classList.add('dragging');
          this.statusMessage = `拖住 ${agent.name} — 放到探员槽上装备`;
          this.invStatus(this.statusMessage);
        });
        card.addEventListener('dragend', () => { this.draggingAgentId = null; card.classList.remove('dragging'); });
      } else {
        const skin = item.skin;
        card.className = 'inv-item' + (equipped[skin.weapon] === skin.id ? ' selected' : '');
        card.dataset.skinId = skin.id;
        card.innerHTML = `
          <span class="inv-thumb"><img src="${skin.preview}" alt="${skin.name}" loading="lazy"><i class="rarity-bar" style="background:${rarityOf(skin)}"></i></span>
          <b>${weaponName(skin.weapon)}</b><small>${skin.name}</small>`;
        card.addEventListener('click', () => this.equip(skin));
        card.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/plain', skin.id);
          e.dataTransfer.effectAllowed = 'copy';
          this.draggingSkinId = skin.id;
          card.classList.add('dragging');
          this.statusMessage = `拖住 ${skin.name} — 放到对应武器格上装备`;
          this.invStatus(this.statusMessage);
        });
        card.addEventListener('dragend', () => { this.draggingSkinId = null; card.classList.remove('dragging'); });
      }
      grid.append(card);
    }
    const filterLabel = this.root.querySelector('.inv-filter-label');
    if (filterLabel) filterLabel.textContent = this.selection?.kind === 'agent' ? '探员'
      : this.selection?.kind === 'gloves' ? '手套'
      : this.selection?.weapon ? weaponName(this.selection.weapon) : '所有物品';
    this.invStatus(this.statusMessage || `共 ${list.length} 件 · 把物品拖到对应槽位上装备`);
  }

  invStatus(text) { this.statusMessage = text; const el = this.root.querySelector('.inv-status'); if (el) el.textContent = text; }

  async equip(skin) {
    if (this.busy) return;
    this.busy = true;
    this.renderInventory();
    const team = this.activeTeam;
    try {
      if (skin.downloadRequired && !await skinSaved(skin)) {
        const saved = await downloadSkin(skin, { onProgress: p => this.invStatus(`正在下载 ${skin.name} · ${(p.loaded / 1048576).toFixed(1)} MB`) });
        if (!saved) throw Error('浏览器未能保存资源，请释放本地存储空间后重试');
        this.downloaded.add(skin.id);
        this.invStatus('下载完成。再次点击即可装备。');
        return;
      }
      await loadSkin(skin.id, { onProgress: p => {
        const bytes = typeof p === 'number' ? p : p?.bytes || p?.loaded || 0;
        this.invStatus(`下载 ${skin.name} · ${Math.min(100, Math.round(bytes / skin.bytes * 100))}%`);
      }});
      setTeamSkin(team, skin.weapon, skin.id);
      await this.onEquipServer(skin, team);
      this.statusMessage = `已装备 ${skin.name}（${TEAM_LABEL[team]}）`;
      this.render();
    } catch (error) {
      this.statusMessage = `未能装备：${error.message}。点击物品可重试。`;
    } finally {
      this.busy = false;
      this.renderInventory();
    }
  }

  /** 探员与枪械皮肤同款交互：点卡片或拖到槽位即装备 */
  async equipAgent(agent) {
    if (this.busy) return;
    this.busy = true;
    this.renderInventory();
    const team = this.activeTeam;
    if (agent.team !== team) {
      this.statusMessage = `${agent.name} 只能装备给${TEAM_LABEL[agent.team]}`;
      this.busy = false;
      this.renderInventory();
      return;
    }
    try {
      await loadAgent(agent.id, { onProgress: update => {
        const bytes = typeof update === 'number' ? update : Number(update?.bytes ?? update?.loaded) || 0;
        const total = Number(update?.total) || 0;
        const percent = total > 0 ? Math.min(100, Math.max(0, Math.round(bytes / total * 100))) : null;
        this.invStatus(`${update?.cached ? '读取本机缓存' : '下载'} ${agent.name}${percent !== null ? ` · ${percent}%` : bytes > 0 ? ` · ${(bytes / 1048576).toFixed(1)} MB` : ''}`);
      }});
      const next = normalizeAgentLoadout({ ...readAgentLoadout(), [team]: agent.id });
      await this.onEquipAgent(agent, next);
      saveAgentLoadout(next);
      this.statusMessage = `已装备 ${agent.name}（${TEAM_LABEL[team]}）`;
      this.render();
    } catch (error) {
      this.statusMessage = `未能装备：${error?.message || '下载或连接失败'}。点击探员可重试。`;
    } finally {
      this.busy = false;
      this.renderInventory();
    }
  }

  /** 手套与枪械皮肤同款交互：点卡片或拖到槽位即装备。先下载第一人称手套模型，进局即可换上 */
  async equipGlove(glove) {
    if (this.busy) return;
    this.busy = true;
    this.renderInventory();
    try {
      await loadGloveArms(glove.id, { onProgress: update => {
        const bytes = typeof update === 'number' ? update : Number(update?.bytes ?? update?.loaded) || 0;
        const total = Number(update?.total) || 0;
        const percent = total > 0 ? Math.min(100, Math.max(0, Math.round(bytes / total * 100))) : null;
        this.invStatus(`${update?.cached ? '读取本机缓存' : '下载'} ${glove.name}${percent !== null ? ` · ${percent}%` : bytes > 0 ? ` · ${(bytes / 1048576).toFixed(1)} MB` : ''}`);
      }});
      saveGloveLoadout(glove.id);
      this.statusMessage = `已装备 ${glove.name}（${glove.family}）`;
      this.render();
    } catch (error) {
      this.statusMessage = `未能装备：${error?.message || '下载或连接失败'}。点击手套可重试。`;
    } finally {
      this.busy = false;
      this.renderInventory();
    }
  }
}
