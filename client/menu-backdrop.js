// 首页背景图池：CS2 自带的 1080p 地图截图（panorama/images/map_icons/
// screenshots/1080p），由 scripts/extract-map-backdrops.mjs 只读抽取并转成
// WebP。每次回到首页随机换一张，与玩家选哪张地图无关——选图只决定加载过场。
//
// 修改图池请同时改脚本里的 SHOTS，两边保持一致。
const POOL = [
  'assets/map-backgrounds/de_dust2_1.webp',
  'assets/map-backgrounds/de_dust2_2.webp',
  'assets/map-backgrounds/de_mirage_1.webp',
  'assets/map-backgrounds/de_mirage_2.webp',
  'assets/map-backgrounds/de_inferno_1.webp',
  'assets/map-backgrounds/de_nuke_1.webp',
  'assets/map-backgrounds/de_train_1.webp',
  'assets/map-backgrounds/de_overpass_1.webp',
  'assets/map-backgrounds/de_anubis_1.webp',
  'assets/map-backgrounds/de_ancient_1.webp',
  'assets/map-backgrounds/de_vertigo_1.webp',
  'assets/map-backgrounds/de_cache_1.webp',
  'assets/map-backgrounds/cs_italy_0.webp',
  'assets/map-backgrounds/cs_office_1.webp',
  'assets/map-backgrounds/de_boulder.webp',
  'assets/map-backgrounds/de_fachwerk.webp',
  'assets/map-backgrounds/cs_shelter.webp',
  'assets/map-backgrounds/rush_001_1.webp',
];

let lastIndex = -1;

/**
 * 随机挑一张首页背景并写入 --menu-backdrop；同一轮会话内不连续重复同一张。
 * 文件缺失时浏览器拿不到图，菜单退回纯色底（与没有背景图时一致）。
 */
export function randomMenuBackdrop() {
  if (!POOL.length) return null;
  let index = lastIndex;
  while (POOL.length > 1 && index === lastIndex) index = (Math.random() * POOL.length) | 0;
  lastIndex = index;
  const url = new URL(POOL[index], document.baseURI).href;
  document.documentElement.style.setProperty('--menu-backdrop', `url('${url}')`);
  return url;
}
