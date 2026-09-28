// The map-pool picker in the lobby. Players choose which maps they are willing to
// play; the server picks the specific one, so this never names a map to the room.
//
// The same picker is rendered in two places — the desktop map showcase and the
// mobile room-setup card — and CSS shows exactly one of them at a time, so both
// hosts are kept in sync from this single source of selection state.
import { listMaps, DEFAULT_MAP } from '../shared/maps/registry.js';
import { preferences } from './persistence.js';

const STORAGE_KEY = 'dust2.maps.v1';

function read() {
  let saved = null;
  try { saved = JSON.parse(preferences.getItem(STORAGE_KEY) || 'null'); } catch {}
  const pool = Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : [];
  return pool.length ? [...new Set(pool)] : null;
}

export function selectedMapPool() {
  return read() || listMaps().map(m => m.id);
}

function hosts(selector) {
  return [...document.querySelectorAll(selector)];
}

/** Render the picker into every host and wire persistence. */
export function mountMapPool() {
  const groups = hosts('.map-pool');
  const statuses = hosts('.map-pool-status');
  const maps = listMaps();
  let selection = read() || maps.map(m => m.id);

  const render = () => {
    for (const container of groups) {
      container.textContent = '';
      for (const map of maps) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.mapId = map.id;
        button.className = 'map-pool-choice';
        button.setAttribute('aria-pressed', String(selection.includes(map.id)));
        const badge = map.overview?.image
          ? `<img src="${new URL(map.overview.image.replace(/^\//, ''), document.baseURI).href}" alt="${map.name} 雷达">`
          : '';
        button.innerHTML = `<span class="map-pool-badge">${badge}</span><span class="map-pool-name"><b>${map.name}</b><small>${map.id}</small></span><i>✓</i>`;
        button.addEventListener('click', () => { toggle(map.id); });
        container.append(button);
      }
    }
    const message = selection.length === 1
      ? `固定进入 ${maps.find(m => m.id === selection[0])?.name || selection[0]}`
      : `将从 ${selection.length} 张地图中随机抽取`;
    for (const status of statuses) status.textContent = message;
  };

  const toggle = id => {
    if (selection.includes(id)) {
      // Never let the pool empty out: the last map cannot be unselected.
      if (selection.length === 1) return;
      selection = selection.filter(m => m !== id);
    } else {
      selection = [...selection, id];
    }
    preferences.setItem(STORAGE_KEY, JSON.stringify(selection));
    render();
  };

  render();
  return { get pool() { return selection; }, refresh: render };
}

export { DEFAULT_MAP };
