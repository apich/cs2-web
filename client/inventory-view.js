// 「库存」视图（参考图 4）：搜索 / 筛选 / 排序 + 稀有度色条网格 + 展示品 + 详情侧栏。
// 皮肤数据复用 shared/skins.js；装备走 team-loadout（CT/T 各一套），下载走 skin-assets 管线。
// 视觉层级参照本机 CS2 1.41.9.0 的 Panorama 库存页：顶部导航（搜索/分类/排序）→
// 物品网格 → 详情；卡片固定比例 + 图区下方稀有度通栏色条 + 右上角已装备圆点。
// 过滤/排序/装备状态推导放在 shared/inventory-query.js，便于 node:test 覆盖。
import { SKINS, skinTypeName, skinFinishName } from '../shared/skins.js';
import { GLOVES } from '../shared/gloves.js';
import { AGENT_CATALOG } from '../shared/agents.js';
import { getWeapon } from '../shared/weapons.js';
import { filterItems, equipStateOf, canEquipToTeam, EQUIP_STATE, SHOWCASE } from '../shared/inventory-query.js';
import { readGloveLoadout, saveGloveLoadout } from './loadout-view.js';
import { loadGloveArms } from './agent-arms.js';
import { getTeamLoadout, setTeamSkin, equippedSkinId } from './team-loadout.js';
import { skinSaved, downloadSkin } from './skin-assets.js';
import { rarityOf, rarityKeyOf, RARITY_NAME } from './skin-rarity.js';
import { mountMorphIcons } from './morph-icons.js';
import './inventory.css';

const weaponName = id => getWeapon(id)?.name || id;
// 刀类卡片标题用刀型名（蝴蝶刀/M9 刺刀…），不能落到武器槽名「爪子刀」上
const typeName = skin => skinTypeName(skin) || weaponName(skin?.weapon);
const agentPreview = id => `assets/characters-cs2/previews/${id}.webp`;

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'gear', label: '装备' },
  { key: 'art', label: '艺术作品' },
  { key: 'crates', label: '武器箱', locked: true },
  { key: 'showcase', label: '展示品' },
  { key: 'tradeup', label: '汰换合同', locked: true },
];

// 排序。shared/skins.js 没有可靠的获取时间字段，所以不提供"最新"——
// 用"默认顺序"诚实表达"按目录内置顺序"，名称/稀有度是真实可排序的。
const SORTS = [
  { key: 'default', label: '默认顺序' },
  { key: 'name', label: '名称' },
  { key: 'rarity', label: '稀有度' },
];

export class InventoryView {
  constructor({ root, onEquipServer = async () => {}, onOpenAgents = () => {} }) {
    this.root = root;
    this.onEquipServer = onEquipServer;
    this.onOpenAgents = onOpenAgents;
    this.busy = false;
    this.downloaded = new Set();
    this.filter = 'all';
    this.sort = 'default';
    this.query = '';
    this.detail = null;
    // 每个 skin.id 的装备进度，render() 不清理，只有明确成功/失败才改写，
    // 否则 renderDetail() 重绘会把"下载中/确认中"提示抹掉。
    this.equipState = new Map();
    this.error = '';
    root.innerHTML = `
      <div class="inv-screen">
        <div class="inv-main">
          <header class="inv-topbar">
            <button type="button" class="inv-search-toggle" aria-label="搜索库存" aria-expanded="false" aria-controls="inv-search-panel"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/></svg></button>
            <nav class="inv-filters" aria-label="物品筛选"></nav>
          </header>
          <div class="inv-search-panel" id="inv-search-panel" hidden>
            <label class="inv-search"><input id="inv-search" type="search" aria-label="搜索武器或皮肤" placeholder="搜索武器或皮肤…" maxlength="80" autocomplete="off"></label>
          </div>
          <div class="inv-list-toolbar">
            <select class="inv-kind" aria-label="装备分类" hidden><option value="gear">全部装备</option><option value="knives">刀</option><option value="agents">探员</option><option value="gloves">手套</option></select>
            <div class="inv-sort-wrap">
              <span class="mi" data-icon="sort"></span>
              <select class="inv-sort" id="inv-sort" aria-label="排序"></select>
            </div>
          </div>
          <div class="inv-body">
            <div class="inv-grid" id="inv-full-grid"></div>
            <div class="inv-empty" id="inv-empty" hidden>
              <span class="mi" data-icon="info"></span>
              <p class="inv-empty-text"></p>
              <button type="button" class="inv-empty-clear" id="inv-empty-clear">清空搜索</button>
            </div>
            <aside class="inv-detail" aria-label="物品详情" hidden>
              <button type="button" class="inv-detail-close" aria-label="关闭">×</button>
              <div class="inv-detail-art"></div>
              <h3 class="inv-detail-title"></h3>
              <p class="inv-detail-sub"></p>
              <ul class="inv-detail-meta"></ul>
              <div class="inv-detail-status" role="status" aria-live="polite" hidden></div>
              <div class="inv-detail-actions"></div>
            </aside>
          </div>
          <div class="inv-foot"><span class="inv-count"></span><span class="inv-hint">点击卡片查看详情 · 在详情里装备到 CT / T</span></div>
        </div>
      </div>`;
    mountMorphIcons(root);
    const searchToggle = root.querySelector('.inv-search-toggle');
    searchToggle.addEventListener('click', () => {
      const panel = root.querySelector('.inv-search-panel');
      panel.hidden = !panel.hidden;
      searchToggle.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) root.querySelector('#inv-search').focus();
      else {
        root.querySelector('#inv-search').value = '';
        this.query = '';
        this.render();
      }
    });
    root.querySelector('.inv-kind').addEventListener('change', e => {
      this.filter = e.target.value;
      this.detail = null;
      this.render();
    });
    root.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.detail) {
        e.stopPropagation();
        this.closeDetail();
      }
    });
    const filters = root.querySelector('.inv-filters');
    for (const f of FILTERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inv-filter-tab' + (f.key === 'all' ? ' selected' : '') + (f.locked ? ' locked' : '');
      b.textContent = f.label;
      b.dataset.filter = f.key;
      if (f.locked) { b.disabled = true; b.title = '暂未开放'; }
      else b.addEventListener('click', () => { this.filter = f.key; this.detail = null; this.render(); });
      filters.append(b);
    }
    const sort = root.querySelector('#inv-sort');
    for (const s of SORTS) {
      const o = document.createElement('option');
      o.value = s.key;
      o.textContent = s.label;
      sort.append(o);
    }
    root.querySelector('#inv-search').addEventListener('input', e => {
      this.query = e.target.value.trim().toLowerCase();
      this.render();
      // 全量重建列表后把焦点还给搜索框：清空搜索结果时不能打断继续输入
      e.target.focus();
    });
    sort.addEventListener('change', e => {
      this.sort = e.target.value;
      this.render();
    });
    root.querySelector('.inv-detail-close').addEventListener('click', () => this.closeDetail());
    root.querySelector('#inv-empty-clear').addEventListener('click', () => {
      const input = root.querySelector('#inv-search');
      input.value = '';
      this.query = '';
      this.render();
      input.focus();
    });
    this.render();
    this.refreshDownloads();
  }

  async refreshDownloads() {
    for (const skin of SKINS.filter(s => s.downloadRequired)) {
      if (await skinSaved(skin)) this.downloaded.add(skin.id);
      else this.downloaded.delete(skin.id);
    }
    // 只重绘列表与详情，不动 this.equipState / this.error，
    // 否则"下载中/确认中/失败可重试"的提示会被抹掉。
    this.render();
  }

  /** 从其他页面返回库存时调用：重新读取 team-loadout，刷新已装备标记。 */
  refresh() {
    this.error = '';
    this.render();
    this.refreshDownloads();
  }

  /** 过滤 + 排序后的物品列表 */
  items() {
    return filterItems(this.filter, this.query, this.sort);
  }

  /** 该物品当前的已装备状态：CT / T / 双阵营，并遵守武器阵营限制。 */
  equipStateOf(skin) {
    return equipStateOf(skin, { ct: getTeamLoadout('CT'), t: getTeamLoadout('T') });
  }

  render() {
    const gear = ['gear', 'knives', 'agents', 'gloves'].includes(this.filter);
    const kind = this.root.querySelector('.inv-kind');
    kind.hidden = !gear;
    if (gear) kind.value = this.filter;
    // 筛选 tab 高亮
    for (const b of this.root.querySelectorAll('.inv-filter-tab')) {
      const selected = b.dataset.filter === this.filter || (gear && b.dataset.filter === 'gear');
      b.classList.toggle('selected', selected);
      b.setAttribute('aria-pressed', String(selected));
    }
    const grid = this.root.querySelector('#inv-full-grid');
    const empty = this.root.querySelector('#inv-empty');
    const list = this.items();
    // 记住滚动位置：renderDetail() 等局部刷新不该把列表弹回顶部
    const scroll = grid.scrollTop;
    grid.replaceChildren();
    for (const entry of list) grid.append(this.cardFor(entry));
    grid.scrollTop = scroll;
    grid.hidden = list.length === 0;
    const emptyText = empty.querySelector('.inv-empty-text');
    const clear = empty.querySelector('#inv-empty-clear');
    if (this.query) {
      emptyText.textContent = `没有匹配「${this.query}」的物品。`;
      clear.hidden = false;
    } else {
      emptyText.textContent = '这个分类下暂时没有物品。';
      clear.hidden = true;
    }
    empty.hidden = list.length > 0;
    this.root.querySelector('.inv-count').textContent = `共 ${list.length} 件`;
    this.renderDetail();
  }

  cardFor(entry) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'inv-card';
    if (entry.skin) {
      const skin = entry.skin;
      const state = this.equipStateOf(skin);
      if (state.startsWith('equipped-')) {
        card.classList.add('is-equipped', `is-${state.replace('equipped-', '')}`);
      }
      if (state === EQUIP_STATE.BLOCKED) card.classList.add('is-blocked');
      card.innerHTML = `
        <span class="inv-thumb"><img src="${skin.preview}" alt="${skin.name}" loading="lazy"><i class="rarity-bar" style="background:${rarityOf(skin)}"></i><span class="inv-equipped-pair" aria-hidden="true"><i class="inv-equipped dot-ct"></i><i class="inv-equipped dot-t"></i></span></span>
        <b>${typeName(skin)}</b><small>${skinFinishName(skin)}</small>`;
      card.setAttribute('aria-label', `${typeName(skin)} | ${skinFinishName(skin)}${state.startsWith('equipped-') ? '（已装备）' : ''}`);
      card.addEventListener('click', () => this.openDetail({ skin }, card));
    } else if (entry.agent) {
      const agent = entry.agent;
      card.innerHTML = `
        <span class="inv-thumb inv-thumb-agent"><img src="${agentPreview(agent.id)}" alt="${agent.name}" loading="lazy"><i class="rarity-bar" style="background:#4b69ff"></i></span>
        <b>探员</b><small>${agent.name}</small>`;
      card.addEventListener('click', () => this.openDetail({ agent }, card));
    } else if (entry.glove) {
      const glove = entry.glove;
      const on = readGloveLoadout() === glove.id;
      card.classList.toggle('is-equipped', on);
      card.innerHTML = `
        <span class="inv-thumb inv-thumb-agent"><img src="${glove.preview}" alt="${glove.name}" loading="lazy"><i class="rarity-bar" style="background:#c98b4a"></i><i class="inv-equipped" aria-hidden="true"></i></span>
        <b>${glove.family}</b><small>${glove.name}</small>`;
      card.addEventListener('click', () => this.openDetail({ glove }, card));
    } else {
      const show = entry.showcase;
      card.className += ' inv-card-showcase';
      card.innerHTML = `
        <span class="inv-thumb inv-thumb-showcase"><i class="showcase-art art-${show.kind}"></i><i class="rarity-bar" style="background:#b0c3d9"></i></span>
        <b>展示品</b><small>${show.name}</small>`;
      card.addEventListener('click', () => this.openDetail({ showcase: show }, card));
    }
    return card;
  }

  openDetail(detail, card) {
    this.detail = detail;
    this.detailTrigger?.classList.remove('is-selected');
    this.detailTrigger = card;
    card.classList.add('is-selected');
    this.renderDetail();
    this.root.querySelector('.inv-detail-close').focus({ preventScroll: true });
  }

  closeDetail() {
    this.detail = null;
    this.renderDetail();
    this.detailTrigger?.classList.remove('is-selected');
    this.detailTrigger?.focus({ preventScroll: true });
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
    const status = panel.querySelector('.inv-detail-status');
    const actions = panel.querySelector('.inv-detail-actions');
    actions.replaceChildren();
    meta.replaceChildren();
    if (d.skin) {
      const skin = d.skin;
      art.innerHTML = `<img src="${skin.preview}" alt="${skin.name}"><i class="rarity-bar" style="background:${rarityOf(skin)}"></i>`;
      title.textContent = `${typeName(skin)} | ${skinFinishName(skin)}`;
      sub.textContent = skin.englishName || '';
      const rows = [
        ['品质', RARITY_NAME[rarityKeyOf(skin)]],
        ['外观', skin.condition || '未提供磨损信息'],
        ['类别', typeName(skin)],
      ];
      if (skin.downloadRequired) rows.push(['资源', this.downloaded.has(skin.id) ? '已下载' : '需下载']);
      for (const [k, v] of rows) {
        const li = document.createElement('li');
        li.innerHTML = `<span>${k}</span><b>${v}</b>`;
        meta.append(li);
      }
      const progress = this.equipState.get(skin.id) || (skin.downloadRequired && !this.downloaded.has(skin.id) ? EQUIP_STATE.NEED_DOWNLOAD : EQUIP_STATE.READY);
      for (const team of ['CT', 'T']) {
        if (!canEquipToTeam(skin, team)) continue; // 遵守武器阵营限制
        const equipped = equippedSkinId(team, skin.weapon) === skin.id;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'inv-equip' + (equipped ? ' is-on' : '');
        btn.dataset.team = team;
        btn.dataset.state = equipped ? `equipped-${team.toLowerCase()}` : (progress || EQUIP_STATE.READY);
        if (equipped) {
          btn.textContent = `已装备到 ${team}`;
          btn.disabled = true;
        } else if (progress === EQUIP_STATE.DOWNLOADING) {
          btn.textContent = `正在下载 ${skin.name}…`;
          btn.disabled = true;
        } else if (progress === EQUIP_STATE.CONFIRMING) {
          btn.textContent = `等待服务器确认（${team}）…`;
          btn.disabled = true;
        } else if (progress === EQUIP_STATE.NEED_DOWNLOAD) {
          btn.textContent = `下载后装备到 ${team}`;
        } else if (progress === EQUIP_STATE.FAILED) {
          btn.textContent = `重试 · 装备到 ${team}`;
        } else {
          btn.textContent = `装备到 ${team}`;
        }
        btn.addEventListener('click', () => this.equip(skin, team));
        btn.disabled ||= this.busy;
        actions.append(btn);
      }
      // 下载中/确认中的提示放在独立状态区，render() 重建列表不会冲掉它
      if (progress === EQUIP_STATE.DOWNLOADING || progress === EQUIP_STATE.CONFIRMING) {
        status.hidden = false;
        status.textContent = progress === EQUIP_STATE.DOWNLOADING ? '正在下载资源，完成后即可装备。' : '已发送装备请求，等待服务器确认。';
      } else if (this.error && this.errorSkinId === skin.id) {
        status.hidden = false;
        status.textContent = this.error;
      } else {
        status.hidden = true;
        status.textContent = '';
      }
    } else {
      // 非皮肤物品没有下载/确认流程，清掉状态区避免上一项提示残留
      status.hidden = true;
      status.textContent = '';
      if (d.agent) {
        art.innerHTML = `<img class="art-agent" src="${agentPreview(d.agent.id)}" alt="${d.agent.name}">`;
        title.textContent = d.agent.name;
        sub.textContent = '探员 · 只改变外观，战斗属性一致';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'inv-equip';
        btn.textContent = '打开探员仓库';
        btn.addEventListener('click', () => this.onOpenAgents());
        actions.append(btn);
      } else if (d.glove) {
        const glove = d.glove;
        art.innerHTML = `<img class="art-agent" src="${glove.preview}" alt="${glove.name}"><i class="rarity-bar" style="background:#c98b4a"></i>`;
        title.textContent = `${glove.family} | ${glove.name}`;
        sub.textContent = '手套 · 只改变外观，战斗属性一致';
        for (const [k, v] of [['品质', glove.family], ['外观', '崭新出厂']]) {
          const li = document.createElement('li');
          li.innerHTML = `<span>${k}</span><b>${v}</b>`;
          meta.append(li);
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'inv-equip' + (readGloveLoadout() === glove.id ? ' is-on' : '');
        btn.textContent = readGloveLoadout() === glove.id ? '已装备' : '装备';
        btn.addEventListener('click', () => this.equipGlove(glove));
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
    }
    mountMorphIcons(panel);
  }

  async equip(skin, team) {
    if (this.busy || !canEquipToTeam(skin, team)) return;
    const progress = this.equipState.get(skin.id);
    // 下载中/确认中禁止重复提交；已装备也无须再点
    if (progress === EQUIP_STATE.DOWNLOADING || progress === EQUIP_STATE.CONFIRMING) return;
    if (equippedSkinId(team, skin.weapon) === skin.id) return;
    this.busy = true;
    this.error = '';
    try {
      if (skin.downloadRequired && !await skinSaved(skin)) {
        // 需要下载：先下载，不提前写 loadout。完成后提示再次点击。
        this.equipState.set(skin.id, EQUIP_STATE.DOWNLOADING);
        this.renderDetail();
        const saved = await downloadSkin(skin, { onProgress: p => this.note(`正在下载 ${skin.name} · ${(p.loaded / 1048576).toFixed(1)} MB`) });
        if (!saved) throw Error('浏览器未能保存资源，请释放本地存储空间后重试');
        this.downloaded.add(skin.id);
        this.equipState.set(skin.id, EQUIP_STATE.READY);
        this.note('下载完成。再次点击即可装备。');
        this.render();
        return;
      }
      // 先让服务端确认，再写本地配置：拒绝/超时时 loadout 与已装备标记保持原状。
      this.equipState.set(skin.id, EQUIP_STATE.CONFIRMING);
      this.renderDetail();
      if (this.onEquipServer) await this.onEquipServer(skin, team);
      setTeamSkin(team, skin.weapon, skin.id);
      this.equipState.delete(skin.id);
      this.note(`已装备 ${skin.name}（${team}）`);
    } catch (error) {
      // 本地配置未改动，标记为可重试
      this.equipState.set(skin.id, EQUIP_STATE.FAILED);
      this.errorSkinId = skin.id;
      this.error = `未能装备：${error.message}。本地配置未改动，可重试。`;
      this.note(this.error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  /** 手套装备：只改外观，本地持久化；先下载第一人称手套模型 */
  async equipGlove(glove) {
    if (this.busy) return;
    this.busy = true;
    this.renderDetail();
    try {
      await loadGloveArms(glove.id, { onProgress: p => {
        const bytes = typeof p === 'number' ? p : p?.bytes || p?.loaded || 0;
        this.note(`下载 ${glove.name} · ${(bytes / 1048576).toFixed(1)} MB`);
      }});
      saveGloveLoadout(glove.id);
      this.note(`已装备 ${glove.name}（${glove.family}）`);
    } catch (error) {
      this.note(`未能装备：${error?.message || '下载失败'}`);
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
