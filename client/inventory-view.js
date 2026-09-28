// 「库存」视图（参考图 4）：搜索 / 筛选 / 排序 + 稀有度色条网格 + 展示品 + 详情侧栏。
// 皮肤数据复用 shared/skins.js；装备走 team-loadout（CT/T 各一套），下载走 skin-assets 管线。
import { SKINS, getSkin } from '../shared/skins.js';
import { getWeapon } from '../shared/weapons.js';
import { AGENT_CATALOG, getAgent } from '../shared/agents.js';
import { getTeamLoadout, setTeamSkin, equippedSkinId } from './team-loadout.js';
import { loadSkin, skinSaved, downloadSkin } from './skin-assets.js';
import { rarityOf, rarityKeyOf, RARITY_NAME, rarityRank } from './skin-rarity.js';
import { mountMorphIcons } from './morph-icons.js';
import './inventory.css';

const weaponName = id => getWeapon(id)?.name || id;
const agentPreview = id => `assets/characters-cs2/previews/${id}.webp`;

// 展示品（不可装备，仅陈列）：用现有 CS2 图标 + CSS 绘制
const SHOWCASE = [
  { id: 'coin-veteran', name: '5 年老兵硬币', kind: 'coin', flavor: '五年生涯纪念' },
  { id: 'graffiti-heart', name: '涂鸦 | 心 [藕色]', kind: 'graffiti', flavor: '艺术作品' },
  { id: 'c4-display', name: 'C4 炸弹', kind: 'c4', flavor: '展示品' },
  { id: 'charm-keychain', name: '挂件 | 拆卸器', kind: 'charm', flavor: '挂件' },
];

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'gear', label: '装备' },
  { key: 'agents', label: '探员' },
  { key: 'showcase', label: '展示品' },
  { key: 'art', label: '艺术作品', locked: true },
  { key: 'crates', label: '武器箱', locked: true },
  { key: 'tradeup', label: '汰换合同', locked: true },
];

export class InventoryView {
  constructor({ root, onEquipServer = async () => {}, onOpenAgents = () => {} }) {
    this.root = root;
    this.onEquipServer = onEquipServer;
    this.onOpenAgents = onOpenAgents;
    this.busy = false;
    this.downloaded = new Set();
    this.filter = 'all';
    this.sort = 'latest';
    this.query = '';
    this.detail = null;
    root.innerHTML = `
      <div class="inv-screen">
        <div class="inv-main">
          <header class="inv-topbar">
            <label class="inv-search"><span class="mi" data-icon="filter"></span><input id="inv-search" type="search" placeholder="搜索武器或皮肤…" maxlength="30"></label>
            <nav class="inv-filters" aria-label="物品筛选"></nav>
            <select class="inv-sort" id="inv-sort" aria-label="排序">
              <option value="latest">最新</option>
              <option value="name">名称</option>
              <option value="rarity">稀有度</option>
            </select>
          </header>
          <div class="inv-body">
            <div class="inv-grid" id="inv-full-grid"></div>
            <aside class="inv-detail" hidden>
              <button type="button" class="inv-detail-close" aria-label="关闭">×</button>
              <div class="inv-detail-art"></div>
              <h3 class="inv-detail-title"></h3>
              <p class="inv-detail-sub"></p>
              <ul class="inv-detail-meta"></ul>
              <div class="inv-detail-actions"></div>
            </aside>
          </div>
          <div class="inv-foot"><span class="inv-count"></span><span class="inv-hint">点击卡片查看详情 · 在详情里装备到 CT / T</span></div>
        </div>
      </div>`;
    mountMorphIcons(root);
    const filters = root.querySelector('.inv-filters');
    for (const f of FILTERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inv-filter-tab' + (f.key === 'all' ? ' selected' : '') + (f.locked ? ' locked' : '');
      b.textContent = f.label;
      if (f.locked) { b.disabled = true; b.title = '暂未开放'; }
      else b.addEventListener('click', () => { this.filter = f.key; this.detail = null; this.render(); });
      filters.append(b);
    }
    root.querySelector('#inv-search').addEventListener('input', e => {
      this.query = e.target.value.trim().toLowerCase();
      this.render();
    });
    root.querySelector('#inv-sort').addEventListener('change', e => {
      this.sort = e.target.value;
      this.render();
    });
    root.querySelector('.inv-detail-close').addEventListener('click', () => { this.detail = null; this.render(); });
    this.render();
    this.refreshDownloads();
  }

  async refreshDownloads() {
    for (const skin of SKINS.filter(s => s.downloadRequired)) {
      if (await skinSaved(skin)) this.downloaded.add(skin.id);
      else this.downloaded.delete(skin.id);
    }
    if (this.detail) this.renderDetail();
    else this.render();
  }

  /** 过滤 + 排序后的物品列表 */
  items() {
    let list = [];
    if (this.filter === 'showcase') {
      list = SHOWCASE.map(s => ({ showcase: s }));
    } else if (this.filter === 'agents') {
      list = AGENT_CATALOG.map(a => ({ agent: a }));
    } else if (this.filter === 'gear') {
      list = SKINS.map(s => ({ skin: s }));
    } else {
      list = [...SKINS.map(s => ({ skin: s })), ...AGENT_CATALOG.map(a => ({ agent: a })), ...SHOWCASE.map(s => ({ showcase: s }))];
    }
    if (this.query) {
      list = list.filter(({ skin, agent, showcase }) => {
        const text = skin ? `${skin.name} ${skin.englishName || ''} ${weaponName(skin.weapon)}` : agent ? `${agent.name} ${agent.id}` : `${showcase.name}`;
        return text.toLowerCase().includes(this.query);
      });
    }
    if (this.sort === 'name') {
      const label = it => it.skin ? it.skin.name : it.agent ? it.agent.name : it.showcase.name;
      list.sort((a, b) => label(a).localeCompare(label(b), 'zh-Hans-CN'));
    } else if (this.sort === 'rarity') {
      list.sort((a, b) => (b.skin ? rarityRank(b.skin) : -1) - (a.skin ? rarityRank(a.skin) : -1));
    }
    return list;
  }

  render() {
    // 筛选 tab 高亮
    for (const b of this.root.querySelectorAll('.inv-filter-tab')) {
      b.classList.toggle('selected', b.textContent === (FILTERS.find(f => f.key === this.filter)?.label));
    }
    const grid = this.root.querySelector('#inv-full-grid');
    grid.replaceChildren();
    const equipped = getTeamLoadout('CT');
    const list = this.items();
    for (const entry of list) grid.append(this.cardFor(entry, equipped));
    this.root.querySelector('.inv-count').textContent = `共 ${list.length} 件`;
    this.renderDetail();
  }

  cardFor(entry, equipped) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'inv-card';
    if (entry.skin) {
      const skin = entry.skin;
      card.classList.toggle('is-equipped', equipped[skin.weapon] === skin.id);
      card.innerHTML = `
        <span class="inv-thumb"><img src="${skin.preview}" alt="${skin.name}" loading="lazy"><i class="rarity-bar" style="background:${rarityOf(skin)}"></i></span>
        <b>${weaponName(skin.weapon)}</b><small>${skin.name}</small>`;
      card.addEventListener('click', () => { this.detail = { skin }; this.render(); });
    } else if (entry.agent) {
      const agent = entry.agent;
      card.innerHTML = `
        <span class="inv-thumb inv-thumb-agent"><img src="${agentPreview(agent.id)}" alt="${agent.name}" loading="lazy"><i class="rarity-bar" style="background:#4b69ff"></i></span>
        <b>探员</b><small>${agent.name}</small>`;
      card.addEventListener('click', () => { this.detail = { agent }; this.render(); });
    } else {
      const show = entry.showcase;
      card.className += ' inv-card-showcase';
      card.innerHTML = `
        <span class="inv-thumb inv-thumb-showcase"><i class="showcase-art art-${show.kind}"></i><i class="rarity-bar" style="background:#b0c3d9"></i></span>
        <b>展示品</b><small>${show.name}</small>`;
      card.addEventListener('click', () => { this.detail = { showcase: show }; this.render(); });
    }
    return card;
  }

  renderDetail() {
    const panel = this.root.querySelector('.inv-detail');
    const d = this.detail;
    if (!d) { panel.hidden = true; return; }
    panel.hidden = false;
    const art = panel.querySelector('.inv-detail-art');
    const title = panel.querySelector('.inv-detail-title');
    const sub = panel.querySelector('.inv-detail-sub');
    const meta = panel.querySelector('.inv-detail-meta');
    const actions = panel.querySelector('.inv-detail-actions');
    actions.replaceChildren();
    meta.replaceChildren();
    if (d.skin) {
      const skin = d.skin;
      art.innerHTML = `<img src="${skin.preview}" alt="${skin.name}"><i class="rarity-bar" style="background:${rarityOf(skin)}"></i>`;
      title.textContent = `${weaponName(skin.weapon)} | ${skin.name}`;
      sub.textContent = skin.englishName || '';
      const rows = [
        ['品质', RARITY_NAME[rarityKeyOf(skin)]],
        ['外观', skin.condition || '崭新出厂'],
        ['类别', weaponName(skin.weapon)],
      ];
      if (skin.downloadRequired) rows.push(['资源', this.downloaded.has(skin.id) ? '已下载' : '需下载']);
      for (const [k, v] of rows) {
        const li = document.createElement('li');
        li.innerHTML = `<span>${k}</span><b>${v}</b>`;
        meta.append(li);
      }
      for (const team of ['CT', 'T']) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'inv-equip' + (equippedSkinId(team, skin.weapon) === skin.id ? ' is-on' : '');
        btn.textContent = equippedSkinId(team, skin.weapon) === skin.id ? `已装备 ${team}` : `装备到 ${team}`;
        btn.addEventListener('click', () => this.equip(skin, team));
        actions.append(btn);
      }
    } else if (d.agent) {
      art.innerHTML = `<img class="art-agent" src="${agentPreview(d.agent.id)}" alt="${d.agent.name}">`;
      title.textContent = d.agent.name;
      sub.textContent = '探员 · 只改变外观，战斗属性一致';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inv-equip';
      btn.textContent = '打开探员仓库';
      btn.addEventListener('click', () => this.onOpenAgents());
      actions.append(btn);
    } else {
      const show = d.showcase;
      art.innerHTML = `<i class="showcase-art art-${show.kind}"></i>`;
      title.textContent = show.name;
      sub.textContent = show.flavor;
      const note = document.createElement('p');
      note.className = 'inv-detail-note';
      note.textContent = '展示品 · 仅陈列，不可装备。';
      actions.append(note);
    }
    mountMorphIcons(panel);
  }

  async equip(skin, team) {
    if (this.busy) return;
    this.busy = true;
    this.renderDetail();
    try {
      if (skin.downloadRequired && !await skinSaved(skin)) {
        const saved = await downloadSkin(skin, { onProgress: p => this.note(`正在下载 ${skin.name} · ${(p.loaded / 1048576).toFixed(1)} MB`) });
        if (!saved) throw Error('浏览器未能保存资源，请释放本地存储空间后重试');
        this.downloaded.add(skin.id);
        this.note('下载完成。再次点击即可装备。');
        return;
      }
      await loadSkin(skin.id, { onProgress: p => {
        const bytes = typeof p === 'number' ? p : p?.bytes || p?.loaded || 0;
        this.note(`下载 ${skin.name} · ${Math.min(100, Math.round(bytes / skin.bytes * 100))}%`);
      }});
      setTeamSkin(team, skin.weapon, skin.id);
      await this.onEquipServer(skin);
      this.note(`已装备 ${skin.name}（${team}）`);
    } catch (error) {
      this.note(`未能装备：${error.message}`);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  note(text) {
    const el = this.root.querySelector('.inv-hint');
    if (el) el.textContent = text;
  }
}
