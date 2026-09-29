// 账户存储：用户名+密码注册/登录，皮肤、探员、设置、战绩保留到 data/accounts.json。
// 零依赖：scrypt 哈希密码，令牌只存哈希；写盘用临时文件+rename 保证原子。
// 每次变更都「读磁盘 → 改 → 写回」，多个服务器进程共用一个数据目录时不会互相覆盖记录。
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { normalizeSkinLoadout } from '../shared/skins.js';
import { normalizeAgentLoadout } from '../shared/agents.js';

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_SESSIONS = 20;
const scryptOpts = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
// 控制字符 + 尖括号（运行时拼，避免源码里出现转义序列）
const STRIP_RE = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + '<>]', 'g');
const clampText = (value, max) => String(value ?? '').replace(STRIP_RE, '').trim().slice(0, max);
const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const safeJSON = (v, limit = 8192) => { try { const text = JSON.stringify(v); return text.length <= limit ? v : null; } catch { return null; } };

function levelFor(xp) { return 1 + Math.floor(Math.sqrt(Math.max(0, xp))); }

export function createAccountStore({ dataDir }) {
  const file = path.join(dataDir, 'accounts.json');
  const tmp = `${file}.tmp`;

  function load() {
    try {
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        if (parsed && isPlainObject(parsed.accounts)) return { version: 1, accounts: parsed.accounts };
      }
    } catch { /* 损坏文件当作空库重来，避免整个服务器起不来。 */ }
    return { version: 1, accounts: {} };
  }

  // Windows 上目标文件可能被杀毒/编辑器短暂占住，rename 失败时重试，最后直接覆盖写。
  function persist(state) {
    mkdirSync(dataDir, { recursive: true });
    const json = JSON.stringify(state);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        writeFileSync(tmp, json);
        renameSync(tmp, file);
        return true;
      } catch { /* 重试一次；仍失败则尝试直接写目标文件。 */ }
    }
    try { writeFileSync(file, json); return true; } catch { return false; }
  }

  // 每次变更以磁盘内容为基准，改完立刻写回（实时落盘）。
  function mutate(fn) {
    const state = load();
    const result = fn(state);
    persist(state);
    return result;
  }

  const tokenHash = token => createHash('sha256').update(String(token)).digest('hex');

  function findByName(state, usernameLower) {
    for (const account of Object.values(state.accounts)) if (account.usernameLower === usernameLower) return account;
    return null;
  }

  function pruneSessions(account, now = Date.now()) {
    account.sessions = (account.sessions || []).filter(s => s.expiresAt > now).slice(-MAX_SESSIONS);
  }

  function makeToken(account) {
    const token = randomBytes(24).toString('hex');
    const now = Date.now();
    pruneSessions(account, now);
    account.sessions.push({ hash: tokenHash(token), createdAt: now, expiresAt: now + SESSION_TTL_MS });
    return token;
  }

  function publicProfile(account) {
    return {
      username: account.username,
      name: account.name,
      skins: { ct: { ...account.skins.ct }, t: { ...account.skins.t } },
      agents: { ...account.agents },
      settings: JSON.parse(JSON.stringify(account.settings)),
      stats: { ...account.stats },
    };
  }

  function authFailure(code, message) { return { ok: false, code, message }; }
  function authSuccess(account, token) { return { ok: true, token, accountId: account.id, account: publicProfile(account) }; }

  function register(rawUsername, rawPassword) {
    const username = clampText(rawUsername, 16);
    const password = typeof rawPassword === 'string' ? rawPassword : '';
    if (username.length < 2 || username.length > 16) return authFailure('AUTH_USERNAME', '用户名需为 2–16 个字符。');
    if (password.length < 4 || password.length > 72) return authFailure('AUTH_PASSWORD', '密码需为 4–72 个字符。');
    const usernameLower = username.toLowerCase();
    return mutate(state => {
      if (findByName(state, usernameLower)) return authFailure('AUTH_TAKEN', '该用户名已被注册，请换一个。');
      const salt = randomBytes(16);
      const account = {
        id: `a_${randomBytes(6).toString('hex')}`,
        username,
        usernameLower,
        scrypt: { salt: salt.toString('hex'), hash: scryptSync(password, salt, 64, scryptOpts).toString('hex') },
        name: username,
        skins: { ct: { ...normalizeSkinLoadout({}) }, t: { ...normalizeSkinLoadout({}) } },
        agents: { ...normalizeAgentLoadout({}) },
        settings: {},
        stats: { kills: 0, deaths: 0, wins: 0, matches: 0, xp: 0, level: 1 },
        sessions: [],
      };
      state.accounts[account.id] = account;
      return authSuccess(account, makeToken(account));
    });
  }

  function login(rawUsername, rawPassword) {
    const usernameLower = clampText(rawUsername, 16).toLowerCase();
    const password = typeof rawPassword === 'string' ? rawPassword : '';
    return mutate(state => {
      const account = findByName(state, usernameLower);
      // 用户不存在时也跑一次 scrypt，避免用响应时间区分用户名是否存在。
      const fallback = Buffer.alloc(64);
      const hash = account
        ? scryptSync(password, Buffer.from(account.scrypt.salt, 'hex'), 64, scryptOpts)
        : scryptSync(password, randomBytes(16), 64, scryptOpts);
      const expected = account ? Buffer.from(account.scrypt.hash, 'hex') : fallback;
      if (!account || expected.length !== hash.length || !timingSafeEqual(expected, hash)) return authFailure('AUTH_BAD_CREDENTIALS', '用户名或密码不正确。');
      return authSuccess(account, makeToken(account));
    });
  }

  function loginToken(rawToken) {
    const token = typeof rawToken === 'string' && rawToken.length >= 16 && rawToken.length <= 128 ? rawToken : '';
    if (!token) return authFailure('AUTH_BAD_TOKEN', '登录已过期，请重新登录。');
    const hash = tokenHash(token);
    return mutate(state => {
      const now = Date.now();
      for (const account of Object.values(state.accounts)) {
        pruneSessions(account, now);
        const hit = account.sessions.find(s => s.hash === hash);
        if (hit) return authSuccess(account, token);
      }
      return authFailure('AUTH_BAD_TOKEN', '登录已过期，请重新登录。');
    });
  }

  function logoutToken(rawToken) {
    const hash = tokenHash(String(rawToken || ''));
    return mutate(state => {
      for (const account of Object.values(state.accounts)) {
        const before = account.sessions.length;
        account.sessions = account.sessions.filter(s => s.hash !== hash);
        if (account.sessions.length !== before) return true;
      }
      return true;
    });
  }

  function getRecord(accountId) {
    const state = load();
    return state.accounts[accountId] || null;
  }

  function saveProfile(accountId, patch) {
    if (!isPlainObject(patch)) return null;
    return mutate(state => {
      const account = state.accounts[accountId];
      if (!account) return null;
      if (typeof patch.name === 'string') {
        const name = clampText(patch.name, 20);
        if (name) account.name = name;
      }
      if (isPlainObject(patch.skins)) {
        for (const side of ['ct', 't']) {
          if (isPlainObject(patch.skins[side])) account.skins[side] = normalizeSkinLoadout({ ...account.skins[side], ...patch.skins[side] });
        }
      }
      if (isPlainObject(patch.agents)) account.agents = normalizeAgentLoadout({ ...account.agents, ...patch.agents });
      if (isPlainObject(patch.settings)) {
        for (const [key, value] of Object.entries(patch.settings)) {
          if (value === undefined) continue;
          if (isPlainObject(value)) { const kept = safeJSON(value); if (kept) account.settings[key] = kept; }
          else if (typeof value === 'number' && Number.isFinite(value)) account.settings[key] = value;
          else if (typeof value === 'string') account.settings[key] = clampText(value, 120);
          else if (typeof value === 'boolean') account.settings[key] = value;
        }
      }
      return publicProfile(account);
    });
  }

  function updateSkin(accountId, side, weapon, skinId) {
    const key = side === 'T' || side === 't' ? 't' : side === 'CT' || side === 'ct' ? 'ct' : null;
    if (!key || typeof weapon !== 'string') return null;
    return mutate(state => {
      const account = state.accounts[accountId];
      if (!account) return null;
      account.skins[key] = normalizeSkinLoadout({ ...account.skins[key], [weapon]: skinId });
      return publicProfile(account);
    });
  }

  function updateAgent(accountId, team, agentId) {
    if (!['CT', 'T'].includes(team)) return null;
    return mutate(state => {
      const account = state.accounts[accountId];
      if (!account) return null;
      account.agents = normalizeAgentLoadout({ ...account.agents, [team]: agentId });
      return publicProfile(account);
    });
  }

  function addStats(accountId, { kills = 0, deaths = 0, win = false, countMatch = false }) {
    return mutate(state => {
      const account = state.accounts[accountId];
      if (!account) return null;
      const stats = account.stats;
      stats.kills += Math.max(0, kills | 0);
      stats.deaths += Math.max(0, deaths | 0);
      if (countMatch) { stats.matches += 1; if (win) stats.wins += 1; }
      stats.xp += Math.max(0, kills | 0) + (win && countMatch ? 10 : 0);
      stats.level = levelFor(stats.xp);
      return { ...stats };
    });
  }

  return {
    register,
    login,
    loginToken,
    logoutToken,
    getRecord,
    getPublic(accountId) { const account = getRecord(accountId); return account ? publicProfile(account) : null; },
    saveProfile,
    updateSkin,
    updateAgent,
    recordMatch(accountId, { kills = 0, deaths = 0, win = false } = {}) { return addStats(accountId, { kills, deaths, win, countMatch: true }); },
    recordSkirmish(accountId, { kills = 0, deaths = 0 } = {}) { return addStats(accountId, { kills, deaths, win: false, countMatch: false }); },
    flush() { return persist(load()); },
    get size() { return Object.keys(load().accounts).length; },
  };
}
