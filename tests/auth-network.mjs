import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { startGameServer } from '../server/index.js';

async function peer(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), messages = [], listeners = new Set();
  ws.on('message', data => { const msg = JSON.parse(data.toString()); messages.push(msg); for (const fn of listeners) fn(); });
  await once(ws, 'open');
  return { ws, send: m => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    waitFor(predicate, timeout = 4000) { return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error('WebSocket message timeout')); }, timeout);
      const check = () => { const i = messages.findIndex(predicate); if (i >= 0) { clearTimeout(timer); listeners.delete(check); resolve(messages.splice(i, 1)[0]); } };
      listeners.add(check); check();
    }); },
    async close() { if (ws.readyState === WebSocket.CLOSED) return; const done = once(ws, 'close'); ws.close(); await done; },
  };
}

test('account auth over WebSocket keeps identity across reconnects', { timeout: 60000 }, async t => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'dust2-auth-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const app = await startGameServer({ port: 0, host: '127.0.0.1', dataDir });
  t.after(() => app.close());
  const clients = [];
  t.after(async () => { for (const client of clients) await client.close(); });

  let token = '', roomCode = '';
  await t.test('注册返回令牌，重复名与错误密码被拒绝', async () => {
    const c = await peer(app.port); clients.push(c);
    c.send({ type: 'register', username: 'tester', password: 'pass-1234' });
    const ok = await c.waitFor(m => m.type === 'authOk' || m.type === 'error');
    assert.equal(ok.type, 'authOk');
    assert.ok(ok.token.length >= 16);
    assert.equal(ok.account.username, 'tester');
    assert.equal(ok.account.name, 'tester');
    token = ok.token;

    const bad = await peer(app.port); clients.push(bad);
    bad.send({ type: 'login', username: 'tester', password: 'wrong-pass' });
    const rejected = await bad.waitFor(m => m.type === 'error');
    assert.equal(rejected.code, 'AUTH_BAD_CREDENTIALS');

    const dup = await peer(app.port); clients.push(dup);
    dup.send({ type: 'register', username: 'TESTER', password: 'another1' });
    const taken = await dup.waitFor(m => m.type === 'error');
    assert.equal(taken.code, 'AUTH_TAKEN');
    await bad.close(); await dup.close();
  });

  await t.test('登录后进房：名字以账户为准，伪造名字被忽略', async () => {
    const c = await peer(app.port); clients.push(c);
    c.send({ type: 'loginToken', token });
    const auth = await c.waitFor(m => m.type === 'authOk');
    assert.equal(auth.account.username, 'tester');

    c.send({ type: 'join', name: '冒名顶替', room: 'AUTH01', mode: 'deathmatch', team: 'CT', bots: 0, skins: { ak47: 'ak47-fire-serpent' }, agents: { CT: 'ct-ava', T: 't-miami' } });
    const welcome = await c.waitFor(m => m.type === 'welcome');
    roomCode = welcome.room;
    const snap = await c.waitFor(m => m.type === 'snapshot');
    const me = snap.players.find(p => p.id === welcome.id);
    assert.equal(me.name, 'tester');
    assert.notEqual(me.name, '冒名顶替');
  });

  await t.test('对局内换肤写回账户', async () => {
    const c = clients[clients.length - 1];
    c.send({ type: 'equipSkin', weapon: 'ak47', skin: 'ak47-vulcan', team: 'CT' });
    const ack = await c.waitFor(m => m.type === 'skinEquipped');
    assert.equal(ack.skin, 'ak47-vulcan');
  });

  await t.test('新连接用令牌登录即可读到账户皮肤', async () => {
    const c = await peer(app.port); clients.push(c);
    c.send({ type: 'loginToken', token });
    const auth = await c.waitFor(m => m.type === 'authOk');
    assert.equal(auth.account.skins.ct.ak47, 'ak47-vulcan');
  });

  await t.test('比赛结束写入战绩', async () => {
    const room = app.rooms.get(roomCode);
    assert.ok(room, '房间应仍在');
    const me = [...room.players.values()].find(p => !p.bot && p.accountId);
    assert.ok(me, '应有已登录玩家在房');
    me.kills = 5; me.deaths = 2;
    room.endMatch('A', '测试结束');
    const c = await peer(app.port); clients.push(c);
    c.send({ type: 'loginToken', token });
    const auth = await c.waitFor(m => m.type === 'authOk');
    assert.equal(auth.account.stats.matches, 1);
    assert.equal(auth.account.stats.kills, 5);
    assert.equal(auth.account.stats.deaths, 2);
  });

  await t.test('saveProfile 保存设置并可被下次登录读到', async () => {
    const c = await peer(app.port); clients.push(c);
    c.send({ type: 'loginToken', token });
    await c.waitFor(m => m.type === 'authOk');
    c.send({ type: 'saveProfile', name: '测试员', settings: { volume: 0.42, cs: { sensitivity: 3.5 } } });
    const saved = await c.waitFor(m => m.type === 'profileSaved');
    assert.equal(saved.account.name, '测试员');
    assert.equal(saved.account.settings.volume, 0.42);

    const c2 = await peer(app.port); clients.push(c2);
    c2.send({ type: 'login', username: 'tester', password: 'pass-1234' });
    const again = await c2.waitFor(m => m.type === 'authOk');
    assert.equal(again.account.name, '测试员');
    assert.equal(again.account.settings.cs.sensitivity, 3.5);
  });

  await t.test('未登录 saveProfile 被拒绝', async () => {
    const c = await peer(app.port); clients.push(c);
    c.send({ type: 'saveProfile', name: '游客' });
    const rejected = await c.waitFor(m => m.type === 'error');
    assert.equal(rejected.code, 'NOT_AUTHED');
  });
});
