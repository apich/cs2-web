import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAccountStore } from '../server/accounts.js';

function tempStore(t) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'dust2-accounts-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  return { dataDir, store: createAccountStore({ dataDir }) };
}

test('accounts', async t => {
  await t.test('注册成功并返回令牌与档案', async t => {
    const { store } = tempStore(t);
    const result = store.register('Alice', 'secret1');
    assert.equal(result.ok, true);
    assert.ok(result.token.length >= 16);
    assert.equal(result.account.username, 'Alice');
    assert.equal(result.account.name, 'Alice');
    assert.equal(result.account.stats.level, 1);
    assert.equal(store.size, 1);
  });

  await t.test('用户名大小写不敏感地唯一', async t => {
    const { store } = tempStore(t);
    assert.equal(store.register('bob', 'pass1').ok, true);
    const dup = store.register('Bob', 'pass2');
    assert.equal(dup.ok, false);
    assert.equal(dup.code, 'AUTH_TAKEN');
  });

  await t.test('密码与用户名校验', async t => {
    const { store } = tempStore(t);
    assert.equal(store.register('x', 'pass1').code, 'AUTH_USERNAME');
    assert.equal(store.register('goodname', 'abc').code, 'AUTH_PASSWORD');
  });

  await t.test('登录：正确密码通过、错误密码拒绝', async t => {
    const { store } = tempStore(t);
    store.register('carol', 'right-pass');
    const ok = store.login('Carol', 'right-pass');
    assert.equal(ok.ok, true);
    assert.equal(ok.account.username, 'carol');
    const bad = store.login('carol', 'wrong-pass');
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'AUTH_BAD_CREDENTIALS');
    assert.equal(store.login('ghost', 'whatever').ok, false);
  });

  await t.test('磁盘上不保存明文密码', async t => {
    const { dataDir, store } = tempStore(t);
    store.register('dave', 'super-secret');
    const raw = readFileSync(path.join(dataDir, 'accounts.json'), 'utf8');
    assert.ok(!raw.includes('super-secret'));
    assert.ok(raw.includes('scrypt'));
  });

  await t.test('令牌登录与吊销', async t => {
    const { store } = tempStore(t);
    const { token } = store.register('erin', 'pass-ok');
    const again = store.loginToken(token);
    assert.equal(again.ok, true);
    assert.equal(again.account.username, 'erin');
    store.logoutToken(token);
    assert.equal(store.loginToken(token).ok, false);
    assert.equal(store.loginToken('short').ok, false);
  });

  await t.test('saveProfile 合并写入皮肤/探员/设置/名字', async t => {
    const { store } = tempStore(t);
    const { accountId } = store.register('frank', 'pass-ok');
    store.saveProfile(accountId, { name: '法兰克', skins: { ct: { ak47: 'ak47-vulcan' } }, agents: { T: 't-phoenix' }, settings: { volume: 0.5, cs: { sensitivity: 2 } } });
    store.saveProfile(accountId, { skins: { t: { ak47: 'ak47-red-laminate' } }, settings: { brightness: 110 } });
    const profile = store.getPublic(accountId);
    assert.equal(profile.name, '法兰克');
    assert.equal(profile.skins.ct.ak47, 'ak47-vulcan');
    assert.equal(profile.skins.t.ak47, 'ak47-red-laminate');
    assert.equal(profile.agents.T, 't-phoenix');
    assert.equal(profile.settings.volume, 0.5);
    assert.equal(profile.settings.brightness, 110);
    assert.equal(profile.settings.cs.sensitivity, 2);
  });

  await t.test('战绩累计与等级公式', async t => {
    const { store } = tempStore(t);
    const { accountId } = store.register('grace', 'pass-ok');
    store.recordMatch(accountId, { kills: 5, deaths: 3, win: true });
    store.recordMatch(accountId, { kills: 2, deaths: 4, win: false });
    store.recordSkirmish(accountId, { kills: 1, deaths: 1 });
    const { stats } = store.getPublic(accountId);
    assert.equal(stats.kills, 8);
    assert.equal(stats.deaths, 8);
    assert.equal(stats.matches, 2);
    assert.equal(stats.wins, 1);
    assert.equal(stats.xp, 5 + 10 + 2 + 1);
    assert.equal(stats.level, 1 + Math.floor(Math.sqrt(stats.xp)));
  });

  await t.test('重启后仍可读（原子落盘）', async t => {
    const { dataDir, store } = tempStore(t);
    const { token } = store.register('helen', 'pass-ok');
    const reopened = createAccountStore({ dataDir });
    assert.equal(reopened.size, 1);
    assert.equal(reopened.loginToken(token).ok, true);
    assert.equal(reopened.login('helen', 'pass-ok').ok, true);
    assert.ok(existsSync(path.join(dataDir, 'accounts.json')));
  });

  await t.test('两个进程共用数据目录不会互相覆盖账户', async t => {
    const { dataDir, store } = tempStore(t);
    const other = createAccountStore({ dataDir }); // 模拟另一个服务器进程（各自持有自己的状态）
    store.register('proc-a', 'pass-a');
    other.register('proc-b', 'pass-b');
    const file = JSON.parse(readFileSync(path.join(dataDir, 'accounts.json'), 'utf8'));
    const names = Object.values(file.accounts).map(a => a.username).sort();
    assert.deepEqual(names, ['proc-a', 'proc-b']);
    assert.equal(store.login('proc-b', 'pass-b').ok, true);
    assert.equal(other.login('proc-a', 'pass-a').ok, true);
  });
});
