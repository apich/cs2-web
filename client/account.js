// 账户：注册/登录/令牌自动登录，把账户档案与 localStorage 读写打通。
// 未登录时全部行为为空操作，离线/游客照旧只用 localStorage。
import { preferences } from './persistence.js';
import { connectionTarget } from './connection-target.js';

const TOKEN_KEY = 'dust2.auth-token';
const RELOAD_GUARD = 'dust2.auth-reloaded';
// Node 单元测试会 import 本模块；location 只在真正发起连接时才需要。
const socketURL = () => connectionTarget(location.href, globalThis.__DUST2_PORTABLE__).socketURL;

let account = null;
const listeners = new Set();

export function currentAccount() { return account; }
export function isLoggedIn() { return !!account; }
export function onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of [...listeners]) fn(account); }

function readJSON(key) { try { return JSON.parse(preferences.getItem(key) || 'null'); } catch { return null; } }

/** 一次性 WebSocket 会话：登录后执行 fn(ws, wait)，然后关闭。 */
function withAuthedSocket(fn, timeout = 8000) {
  const token = preferences.getItem(TOKEN_KEY);
  if (!token) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(socketURL()); } catch (e) { reject(e); return; }
    const messages = [], listeners = new Set();
    const done = (fn2, value) => { clearTimeout(timer); try { ws.close(); } catch {} fn2(value); };
    const timer = setTimeout(() => done(reject, new Error('账户服务器连接超时。')), timeout);
    const wait = predicate => new Promise((res, rej) => {
      const check = () => {
        const i = messages.findIndex(predicate);
        if (i >= 0) { listeners.delete(check); res(messages.splice(i, 1)[0]); }
      };
      listeners.add(check); check();
      setTimeout(() => { listeners.delete(check); rej(new Error('账户操作超时。')); }, timeout);
    });
    ws.addEventListener('message', e => {
      let data; try { data = JSON.parse(e.data); } catch { return; }
      messages.push(data);
      // 只有仍然处于登录态时才刷新缓存，避免退出登录后被迟到的 authOk 复活
      if (data.type === 'authOk' && preferences.getItem(TOKEN_KEY)) account = data.account;
      if (data.type === 'error' && data.code === 'AUTH_BAD_TOKEN') preferences.removeItem(TOKEN_KEY);
      for (const fn2 of [...listeners]) fn2();
    });
    ws.addEventListener('error', () => done(reject, new Error('无法连接游戏服务器。')));
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'loginToken', token }));
      wait(m => m.type === 'authOk' || (m.type === 'error' && String(m.code || '').startsWith('AUTH')))
        .then(async first => {
          if (first.type !== 'authOk') throw new Error(first.message || '登录已过期，请重新登录。');
          const result = await fn(ws, wait);
          done(resolve, result);
        })
        .catch(error => done(reject, error));
    });
  });
}

/** 账户档案 → localStorage；返回是否有内容变化（变化时调用方可能需要刷新界面）。 */
function applyAccountToLocal(profile) {
  let changed = false;
  const set = (key, value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (preferences.getItem(key) !== text) { preferences.setItem(key, text); changed = true; }
  };
  set('dust2.name', profile.name || profile.username);
  set('dust2.loadout.v2', { ct: profile.skins?.ct || {}, t: profile.skins?.t || {} });
  set('dust2.agents.v1', { CT: profile.agents?.CT, T: profile.agents?.T });
  const s = profile.settings || {};
  if (s.cs) {
    set('dust2.cs-settings.v1', s.cs);
    if (s.cs.lobbyFaction) set('dust2.selectedFaction.v1', s.cs.lobbyFaction);
  }
  if (s.quality !== undefined && s.quality !== null) set('dust2.quality.v2', s.quality);
  if (s.brightness !== undefined && s.brightness !== null) set('dust2.brightness', s.brightness);
  if (s.volume !== undefined && s.volume !== null) set('dust2.volume', s.volume);
  if (s.musicKit !== undefined && s.musicKit !== null) set('dust2.music-kit', s.musicKit);
  if (s.musicVolume !== undefined && s.musicVolume !== null) set('dust2.music-volume', s.musicVolume);
  if (s.controls) set('dust2.controls.v1', s.controls);
  if (s.touch) set('dust2.touch.v1', s.touch);
  if (s.fullscreen) set('dust2.fullscreen.v1', s.fullscreen);
  return changed;
}

/** 本地 localStorage → 账户（防抖聚合快照）。未登录时为空操作。 */
let saveTimer = null;
export function queueProfileSave() {
  if (!preferences.getItem(TOKEN_KEY)) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushProfileSave().catch(() => {});
  }, 1000);
}

// 页面关闭/切后台时立刻补一次保存，减少丢失最近改动的窗口
if (typeof document !== 'undefined') {
  const flushNow = () => { clearTimeout(saveTimer); if (preferences.getItem(TOKEN_KEY)) flushProfileSave().catch(() => {}); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
  globalThis.addEventListener?.('pagehide', flushNow);
}

async function flushProfileSave() {
  const num = v => { if (v === null || v === undefined || v === '') return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; };
  const patch = {
    name: preferences.getItem('dust2.name') || undefined,
    skins: readJSON('dust2.loadout.v2') || undefined,
    agents: readJSON('dust2.agents.v1') || undefined,
    settings: {
      cs: readJSON('dust2.cs-settings.v1') || undefined,
      quality: preferences.getItem('dust2.quality.v2') || undefined,
      brightness: num(preferences.getItem('dust2.brightness')),
      volume: num(preferences.getItem('dust2.volume')),
      musicKit: preferences.getItem('dust2.music-kit') || undefined,
      musicVolume: num(preferences.getItem('dust2.music-volume')),
      controls: readJSON('dust2.controls.v1') || undefined,
      touch: readJSON('dust2.touch.v1') || undefined,
      fullscreen: readJSON('dust2.fullscreen.v1') || undefined,
    },
  };
  await withAuthedSocket(async (ws, wait) => {
    ws.send(JSON.stringify({ type: 'saveProfile', ...patch }));
    const reply = await wait(m => m.type === 'profileSaved' || m.type === 'error');
    if (reply.type === 'profileSaved') account = reply.account;
  });
}

async function authenticate(payload) {
  const ws = new WebSocket(socketURL());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('服务器连接超时。')); }, 8000);
    const done = (fn, value) => { clearTimeout(timer); try { ws.close(); } catch {} fn(value); };
    ws.addEventListener('message', e => {
      let data; try { data = JSON.parse(e.data); } catch { return; }
      if (data.type === 'authOk') { preferences.setItem(TOKEN_KEY, data.token); done(resolve, data.account); }
      else if (data.type === 'error') done(reject, Object.assign(new Error(data.message || '认证失败。'), { code: data.code }));
    });
    ws.addEventListener('error', () => done(reject, new Error('无法连接游戏服务器。')));
    ws.addEventListener('open', () => ws.send(JSON.stringify(payload)));
  });
}

/** 登录/注册成功后的统一处理：存 token、同步本地、必要时刷新一次页面。 */
function adoptAccount(profile) {
  account = profile;
  const changed = applyAccountToLocal(profile);
  const guarded = sessionStorage.getItem(RELOAD_GUARD) === '1';
  if (changed && !guarded) {
    sessionStorage.setItem(RELOAD_GUARD, '1');
    location.reload();
    return;
  }
  if (!changed) sessionStorage.removeItem(RELOAD_GUARD);
  notify();
}

export async function login(username, password) {
  const profile = await authenticate({ type: 'login', username, password });
  adoptAccount(profile);
  return profile;
}

export async function register(username, password) {
  const profile = await authenticate({ type: 'register', username, password });
  adoptAccount(profile);
  return profile;
}

/** 退出登录：单独通道撤销令牌（不走 loginToken，避免 authOk 把登录状态写回来）。 */
function sendLogout(token) {
  try {
    const ws = new WebSocket(socketURL());
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'logout', token }));
      setTimeout(() => { try { ws.close(); } catch {} }, 300);
    });
    ws.addEventListener('error', () => {});
  } catch { /* 离线也要能退出登录。 */ }
}

export function logout() {
  const token = preferences.getItem(TOKEN_KEY);
  if (token) sendLogout(token);
  preferences.removeItem(TOKEN_KEY);
  account = null;
  preferences.setItem('dust2.name', 'Player');
  sessionStorage.removeItem(RELOAD_GUARD);
  notify();
}

/** 页面加载：有令牌就自动登录并同步账户档案。失败静默（游客照旧）。 */
export async function restoreSession() {
  const token = preferences.getItem(TOKEN_KEY);
  if (!token) { notify(); return null; }
  try {
    const profile = await authenticate({ type: 'loginToken', token });
    adoptAccount(profile);
    return profile;
  } catch (error) {
    if (error?.code === 'AUTH_BAD_TOKEN' && preferences.getItem(TOKEN_KEY) === token) preferences.removeItem(TOKEN_KEY);
    notify();
    return null;
  }
}

/** 当前浏览器已登录时的令牌（供对局连接先鉴权再 join）。 */
export function authToken() { return preferences.getItem(TOKEN_KEY); }
