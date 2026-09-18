// 统一的 Esc 弹层路由。
// 只接管 GameControls 闸门拦不住的弹层（首页弹层、房间面板、模式选择、联机大厅、素材来源）：
// 暂停菜单 / 购买菜单仍由 GameControls 的 menu 动作处理，避免同一按键两处响应。
// 监听必须在 GameControls 之前注册，这样按键录入（controls.capture）时 Esc 先被它取消录入。
const layers = [];
let blocked = () => false;
let installed = false;

/** 注册一个可被 Esc 关闭的层；priority 越大越先被关闭，同 id 重复注册则覆盖。 */
export function registerEscapeLayer({ id, element, priority = 0, close } = {}) {
  if (!id || !element || typeof close !== 'function') return;
  const entry = { id, element, priority, close };
  const index = layers.findIndex(layer => layer.id === id);
  if (index >= 0) layers[index] = entry; else layers.push(entry);
}

/** 关闭优先级最高且可见的层；返回是否真的关掉了东西。 */
export function closeTopEscapeLayer() {
  const open = layers.filter(layer => !layer.element.hidden).sort((a, b) => b.priority - a.priority);
  if (!open.length) return false;
  open[0].close();
  return true;
}

/** 安装全局 Esc 监听。isBlocked 为真时让出按键（例如玩家正在录入新按键）。 */
export function installEscapeStack({ isBlocked } = {}) {
  if (typeof isBlocked === 'function') blocked = isBlocked;
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', event => {
    if (event.code !== 'Escape' || event.repeat || event.isComposing || event.metaKey) return;
    if (blocked()) return;
    // 关掉弹层后必须吃掉这次按键：否则 GameControls 会紧接着按"无弹层"再打开暂停菜单。
    if (!closeTopEscapeLayer()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });
}
