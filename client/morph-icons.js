// morphicons + Lucide 图标接入（用户指定图标库：github.com/guillermolg00/morphicons）。
// morphicons 只负责描边图标渲染与形变，图标数据来自 lucide（IconNode）。
import { defineMorphIcon } from 'morphicons/element';
import { Home, Newspaper, Settings, Power, Users, Radio, Clock, Filter, ArrowUpDown } from 'lucide';

const ICONS = { home: Home, newspaper: Newspaper, settings: Settings, power: Power, users: Users, radio: Radio, clock: Clock, filter: Filter, sort: ArrowUpDown };

defineMorphIcon();

/** 把 <span class="mi" data-icon="…"> 占位填成 <morph-icon>。 */
export function mountMorphIcons(root = document) {
  for (const el of root.querySelectorAll('.mi[data-icon]')) {
    const icon = ICONS[el.dataset.icon];
    if (!icon) continue;
    const node = document.createElement('morph-icon');
    node.icon = icon;
    node.setAttribute('aria-hidden', 'true');
    el.replaceWith(node);
    node.className = el.className.replace(/\bmi\b/, '').trim() || 'morph-icon';
  }
}
