// 名牌点击弹出账户面板：登录 / 注册 / 退出。状态文字随 onAccountChange 更新。
import { login, register, logout, currentAccount, onAccountChange } from './account.js';

export function mountAccountUI() {
  const chip = document.getElementById('account-chip');
  const panel = document.getElementById('account-panel');
  if (!chip || !panel) return;
  const statusEl = document.getElementById('account-status');
  const nameEl = document.getElementById('nameplate-name');
  const form = document.getElementById('account-form');
  const loggedIn = document.getElementById('account-logged-in');
  const usernameEl = document.getElementById('account-username');
  const userInput = document.getElementById('account-user');
  const passInput = document.getElementById('account-pass');
  const pass2Input = document.getElementById('account-pass2');
  const pass2Label = document.getElementById('account-pass2-label');
  const submitBtn = document.getElementById('account-submit');
  const toggleBtn = document.getElementById('account-toggle');
  const errorEl = document.getElementById('account-error');
  const closeBtn = document.getElementById('account-close');
  const logoutBtn = document.getElementById('account-logout');
  let mode = 'login';

  function showError(text) {
    if (!errorEl) return;
    errorEl.textContent = text || '';
    errorEl.hidden = !text;
  }

  function render() {
    const account = currentAccount();
    const logged = !!account;
    form.hidden = logged;
    loggedIn.hidden = !logged;
    if (statusEl) statusEl.textContent = logged ? `已登录 · ${account.username}` : '未登录 · 点击登录';
    if (nameEl) nameEl.textContent = logged && account.name ? account.name : 'Player';
    if (usernameEl && logged) usernameEl.textContent = account.username;
    chip.classList.toggle('is-logged-in', logged);
  }

  function setMode(next) {
    mode = next;
    if (submitBtn) submitBtn.textContent = mode === 'login' ? '登录' : '注册';
    if (toggleBtn) toggleBtn.textContent = mode === 'login' ? '没有账户？注册' : '已有账户？登录';
    if (pass2Label) pass2Label.hidden = mode !== 'register';
    if (pass2Input) pass2Input.hidden = mode !== 'register';
    showError('');
  }

  chip.addEventListener('click', () => {
    panel.hidden = false;
    setMode('login');
    render();
    userInput?.focus();
  });
  chip.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); }
  });
  closeBtn?.addEventListener('click', () => { panel.hidden = true; });
  logoutBtn?.addEventListener('click', () => {
    logout();
    render();
    panel.hidden = true;
  });
  toggleBtn?.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    showError('');
    const username = userInput?.value.trim() || '';
    const password = passInput?.value || '';
    if (!username || !password) { showError('请填写用户名和密码。'); return; }
    if (mode === 'register' && password !== (pass2Input?.value || '')) { showError('两次输入的密码不一致。'); return; }
    submitBtn.disabled = true;
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
      panel.hidden = true;
      render();
    } catch (error) {
      showError(error.message || '操作失败，请重试。');
    } finally {
      submitBtn.disabled = false;
    }
  });

  onAccountChange(render);
  render();
}
