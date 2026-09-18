// 大厅 / 模式选择 / 加载过场 的统一界面状态管理。
// 状态机：HOME（大厅）→ MODE_SELECT（模式选择）→ LOADING（加载过场）→ GAME（对局）。
// 只负责界面显隐、切换动画与视觉进度；真实资源下载与建连流程仍由 main.js 的 start()/connect() 驱动。
const $ = id => document.getElementById(id);
const STORAGE_KEY = 'dust2.selectedFaction.v1';
const AGENT_PREVIEW = {
  CT: 'assets/characters-cs2/previews/ct-sas.webp',   // TODO: replace with CT character asset
  T: 'assets/characters-cs2/previews/t-phoenix.webp', // TODO: replace with T character asset
};
const FACTION_NAME = { CT: '反恐精英 CT', T: '恐怖分子 T' };

// 页面状态机：HOME（大厅）→ MODE_SELECT（模式选择）→ LOADING（加载过场）→ GAME（对局）。
export const GameState = Object.freeze({ HOME: 'HOME', MODE_SELECT: 'MODE_SELECT', LOADING: 'LOADING', GAME: 'GAME' });
export let currentGameState = GameState.HOME;

// 游戏模式数据。key 与服务端协议 / select#mode 的值保持一致（defuse/deathmatch），避免额外转换层。
export const GAME_MODES = Object.freeze({
  defuse: { name: '爆破模式', description: '进攻方安放炸弹，防守方阻止爆破', detail: '13 回合获胜 · 换边加时 · 完整经济系统' },
  deathmatch: { name: '团队死斗', description: '快速交战，在时间结束前获得更高击杀数', detail: '先到 100 击杀 · 自动重生 · 节奏更快' },
});
// 当前选中模式（真实值的唯一来源仍是隐藏的 select#mode，创建房间时从那里读取）。
export let selectedGameMode = 'defuse';

let selectedFaction = readFaction();
let overlayImg = null, swapTimeout = null;
let msgTimer = null, msgIndex = -1, msgEl = null;
let rafId = 0, lastTick = 0, visualPercent = 0, targetPercent = 0;
let fillEl = null, pctEl = null, completeTimer = null;

// 随机"准备中"短句，加载期间 700~1500ms 随机切换、不与上一句重复。
const LOADING_MESSAGES = [
  '正在检查武器装备……',
  '弹药装填中……',
  '正在同步战场数据……',
  '正在部署作战单位……',
  '地图资源加载中……',
  '正在检查通讯设备……',
  '战术装备准备中……',
  '正在建立战场连接……',
  '队伍正在集结……',
  '作战区域确认中……',
  '雷达系统启动中……',
  '防弹装备检查中……',
  '正在同步玩家数据……',
  '战术地图准备中……',
];

function readFaction() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'CT' || saved === 'T') return saved;
  } catch {}
  return $('team')?.value === 'CT' ? 'CT' : 'T';
}

export function getFaction() { return selectedFaction; }

// ---- 大厅警匪切换：按钮高亮 + 立绘交叉淡入淡出 + localStorage 记忆 ----
export function setFaction(faction, animate = true) {
  if (faction !== 'CT' && faction !== 'T') return;
  const changed = faction !== selectedFaction;
  selectedFaction = faction;
  try { localStorage.setItem(STORAGE_KEY, faction); } catch {}
  document.querySelectorAll('[data-faction]').forEach(btn => {
    const on = btn.dataset.faction === faction;
    btn.classList.toggle('selected', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  const nameEl = $('lobby-faction-name');
  if (nameEl) nameEl.textContent = `当前阵营 · ${FACTION_NAME[faction]}`;
  new Image().src = AGENT_PREVIEW[faction === 'CT' ? 'T' : 'CT']; // 预载另一阵营立绘，切换不闪白
  swapCharacter(faction, animate && changed); // 首次初始化（changed=false）也需校正立绘 src
}

// 旧角色 opacity 1→0 / translateX 0→-20px，新角色 0→1 / 20px→0，320ms。
function swapCharacter(faction, animate) {
  const stage = $('lobby-character-stage');
  const img = $('lobby-character-img');
  if (!stage || !img) return;
  if (!animate) { img.src = AGENT_PREVIEW[faction]; return; }
  if (!overlayImg) {
    overlayImg = document.createElement('img');
    overlayImg.className = 'lobby-character-img lobby-character-overlay';
    overlayImg.alt = img.alt;
    stage.appendChild(overlayImg);
  }
  clearTimeout(swapTimeout);
  overlayImg.src = AGENT_PREVIEW[faction];
  const timing = { duration: 320, easing: 'ease-out' };
  img.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(-20px)' }], timing);
  overlayImg.animate([{ opacity: 0, transform: 'translateX(20px)' }, { opacity: 1, transform: 'translateX(0)' }], timing);
  swapTimeout = setTimeout(() => {
    img.src = AGENT_PREVIEW[faction];
    img.style.opacity = '';
    overlayImg.style.opacity = '';
  }, 320);
}

// ---- 模式选择面板 ----
export function showModeSelect() {
  if (currentGameState !== GameState.HOME && currentGameState !== GameState.MODE_SELECT) return;
  currentGameState = GameState.MODE_SELECT;
  const panel = $('mode-select');
  if (!panel) return;
  panel.hidden = false;
  panel.classList.remove('fade-out');
  panel.classList.add('fade-in');
  syncModeCards($('mode')?.value);
}
export function hideModeSelect() {
  const panel = $('mode-select');
  if (!panel || panel.hidden) return;
  panel.classList.remove('fade-in');
  panel.classList.add('fade-out');
  setTimeout(() => {
    if (panel.classList.contains('fade-out')) { panel.hidden = true; panel.classList.remove('fade-out'); }
  }, 240);
  if (currentGameState === GameState.MODE_SELECT) currentGameState = GameState.HOME;
}
function syncModeCards(mode) {
  document.querySelectorAll('[data-mode-card]').forEach(card => {
    const on = card.dataset.modeCard === mode;
    card.classList.toggle('selected', on);
    card.setAttribute('aria-pressed', String(on));
  });
}
// 与房间设置里的 select#mode 双向同步（手动触发 change 让 main.js 的 updateModeLabels 生效）。
function selectMode(mode) {
  if (!GAME_MODES[mode]) return;
  const sel = $('mode');
  if (sel && sel.value !== mode) {
    sel.value = mode;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  selectedGameMode = mode;
  syncModeCards(mode);
}

// ---- 加载过场：随机短句 + 视觉进度 ----
function nextMessage() {
  let i;
  do { i = (Math.random() * LOADING_MESSAGES.length) | 0; }
  while (i === msgIndex && LOADING_MESSAGES.length > 1);
  msgIndex = i;
  return LOADING_MESSAGES[i];
}
function cycleMessage() {
  if (currentGameState !== GameState.LOADING) return;
  msgEl?.classList.add('msg-out'); // 200ms 淡出
  msgTimer = setTimeout(() => {
    if (currentGameState !== GameState.LOADING) return;
    if (msgEl) { msgEl.textContent = nextMessage(); msgEl.classList.remove('msg-out'); } // 淡入
    scheduleMessage();
  }, 200);
}
function scheduleMessage() { msgTimer = setTimeout(cycleMessage, 700 + Math.random() * 800); }
function startMessages() {
  msgEl = $('loading-msg');
  if (!msgEl) return;
  stopMessages();
  msgIndex = -1;
  msgEl.textContent = nextMessage();
  scheduleMessage();
}
function stopMessages() { clearTimeout(msgTimer); msgTimer = null; msgEl?.classList.remove('msg-out'); }

// 视觉进度：rAF 平滑逼近目标，保持加载节奏（快→正常→稍慢→较慢→等待资源）。
function approachSpeed(p) { return p < 25 ? 170 : p < 60 ? 75 : p < 85 ? 30 : p < 95 ? 8 : 45; }
function tick(now) {
  rafId = requestAnimationFrame(tick);
  const dt = lastTick ? Math.min(.05, (now - lastTick) / 1000) : 0;
  lastTick = now;
  if (visualPercent >= targetPercent) return;
  visualPercent = Math.min(targetPercent, visualPercent + approachSpeed(visualPercent) * dt);
  if (fillEl) fillEl.style.transform = `scaleX(${visualPercent / 100})`;
  if (pctEl) pctEl.textContent = `${Math.floor(visualPercent)}%`;
}

export function startLoadingView() {
  currentGameState = GameState.LOADING;
  fillEl = $('load-fill');
  pctEl = $('load-percent');
  visualPercent = 0; targetPercent = 0; lastTick = 0;
  if (fillEl) { fillEl.style.transition = 'none'; fillEl.style.transform = 'scaleX(0)'; }
  if (pctEl) pctEl.textContent = '0%';
  const screen = $('loading-screen');
  if (screen) { screen.classList.remove('leave'); screen.style.opacity = ''; }
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
  const mapEl = $('loading-map-name');
  if (mapEl) mapEl.textContent = 'DUST II · 炙热沙城 II';
  const modeEl = $('loading-map-mode');
  if (modeEl && $('mode')) modeEl.textContent = $('mode').value === 'defuse' ? '爆破模式' : '团队死斗';
  startMessages();
}
// 真实进度目标（下载字节/文件数由 main.js 提供）；视觉最多自动爬到 95%，等资源真正完成。
export function setLoadingTarget(percent) {
  if (currentGameState !== GameState.LOADING) return;
  targetPercent = Math.max(targetPercent, Math.min(95, Math.max(0, percent || 0)));
}
// 资源全部就绪：视觉推进 100% → 停留 ~300ms → 整屏 550ms 淡出 → hidden，切入 GAME。
// 用 performance.now 时间轴驱动而非 rAF：后台标签页 rAF 会被浏览器节流，可能导致过场卡住。
export function completeLoading() {
  cancelAnimationFrame(rafId);
  rafId = 0;
  const startAt = performance.now();
  const startVal = visualPercent;
  const DURATION = 600; // 追到 100% 最多用 600ms
  const screen = $('loading-screen');
  const step = () => {
    const t = Math.min(1, (performance.now() - startAt) / DURATION);
    visualPercent = startVal + (100 - startVal) * t;
    if (fillEl) fillEl.style.transform = `scaleX(${visualPercent / 100})`;
    if (pctEl) pctEl.textContent = `${Math.floor(visualPercent)}%`;
    if (t < 1) { completeTimer = setTimeout(step, 50); return; }
    completeTimer = setTimeout(() => { // 停留在 100% 约 300ms 后淡出
      stopMessages();
      if (screen && !screen.hidden) { screen.classList.add('leave'); screen.style.opacity = ''; }
      completeTimer = setTimeout(() => {
        if (screen) { screen.hidden = true; screen.classList.remove('leave'); }
        currentGameState = GameState.GAME;
      }, 600);
    }, 300);
  };
  step();
}
// 中断/失败/返回大厅：清掉残留计时器与 rAF，避免内存泄漏。
export function stopLoadingView() {
  stopMessages();
  cancelAnimationFrame(rafId);
  rafId = 0;
  clearTimeout(completeTimer);
  completeTimer = null;
  const screen = $('loading-screen');
  if (screen) { screen.classList.remove('leave'); screen.style.opacity = ''; }
  currentGameState = GameState.HOME;
}

// 回到大厅：关掉模式选择、清掉加载定时器/rAF，状态归位 HOME。
export function showHome() {
  hideModeSelect();
  stopLoadingView();
  currentGameState = GameState.HOME;
}

// ---- 装配：模式卡 / 返回 / 进入 / 警匪按钮 ----
export function initLobbyUI({ onStart, onFaction } = {}) {
  // 桌面端房间设置面板（match-card）被视觉隐藏，把状态提示条挪到左侧信息栏底部保持可见；触屏端不移。
  const menuStatus = $('menu-status');
  if (menuStatus && window.matchMedia('(min-width:901px)').matches && !menuStatus.closest('.lobby-panel')) {
    document.querySelector('.lobby-panel')?.append(menuStatus);
  }
  selectedGameMode = $('mode')?.value === 'deathmatch' ? 'deathmatch' : 'defuse';
  document.querySelectorAll('[data-mode-card]').forEach(card => card.addEventListener('click', () => selectMode(card.dataset.modeCard)));
  $('mode-back')?.addEventListener('click', hideModeSelect);
  $('mode-start')?.addEventListener('click', () => onStart?.());
  // 大厅警匪按钮：只切换立绘与阵营记忆；阵营选择同步由 onFaction 复用 main.js 的 chooseTeam。
  document.querySelectorAll('[data-faction]').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.faction === selectedFaction) return;
    setFaction(btn.dataset.faction);
    onFaction?.(btn.dataset.faction);
  }));
  setFaction(selectedFaction, false);
}