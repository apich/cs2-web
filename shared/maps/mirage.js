// Mirage descriptor — 1:1 from the user's own CS2 install.
//
// Render geometry and textures: Source 2 Viewer 20.0 export of de_mirage.vpk,
// WebP + Meshopt packaged by scripts/map-optimize-{textures,geometry}.mjs and
// scripts/build-mobile-map.py.
// Collision, nav and spawn points: awpy-data release 2000905 (build 25175329).
// Radar image and overview calibration: MurkyYT/cs2-map-icons pinned commit,
// whose de_mirage.txt is byte-identical to the game's resource/overviews file —
// the spawn/site positions below were derived from it and independently
// cross-checked against the bombsite decal geometry in the render export
// (agreement within 0.15 m, see scripts/extract-map-ladders.mjs).
//
// The two ladder volumes are the only ones whose props touch walkable nav at
// both ends; scripts/map-build.py prunes the rest. Verify both in game.
import data from './generated/de-mirage-data.js';

export const MIRAGE = {
  id: 'de_mirage',
  name: 'Mirage',
  nameZh: '荒漠迷城',
  tagline: 'A 点的每一个箱子，<br>都是一次博弈。',
  version: data.version,
  sourceBuild: data.sourceBuild,
  metersPerSourceUnit: data.metersPerSourceUnit,
  bounds: data.bounds,
  spawns: data.spawns,
  sites: data.sites,
  nav: data.nav,
  labels: data.labels,
  overview: data.overview,
  geometryInfo: data.geometryInfo,
  ladders: data.ladders,

  assets: {
    geometryUrl: '/assets/maps/de_mirage/positions.f32',
    penetrationUrl: '/assets/maps/de_mirage/penetration-materials.u8',
    renderDesktop: '/assets/maps/de_mirage/render/de_mirage-web.gltf',
    renderMobile: '/assets/maps/de_mirage/mobile/de_mirage-mobile.gltf',
    renderVersionDesktop: '',
    radarImage: data.overview?.image || '/assets/valve-mirage/de_mirage_radar_psd.png',
  },

  skyUrl: '/assets/sky/daylight.hdr?v=5244534e9cf5',

  // Mirage shipped no 16:9 capture from Source 2 Viewer, so its own radar stands
  // in behind the shade rather than borrowing Dust II's photo.
  backdrop: data.overview?.image || '/assets/valve-mirage/de_mirage_radar_psd.png',

  // Mirage is a single-level map of a comparable footprint to Dust II, so the
  // Dust II lighting block is a sound starting point; tune in game if needed.
  lighting: {
    fogColor: 0xb9c2c4, fogNear: 150, fogFar: 320,
    hemisphereSky: 0xd6e6f2, hemisphereGround: 0x9a8767, hemisphereIntensity: 2.2,
    sunColor: 0xfff2e2, sunIntensity: 3.3,
    sunDirection: { x: -0.43, y: -0.84, z: -0.33 },
    sunCenter: { x: -8, y: 0, z: 14 },
    sunOffset: 110,
    shadowExtent: 88, shadowNear: 1, shadowFar: 240, shadowMapSize: 2048,
    shadowNormalBias: 0.035, shadowBias: -0.00012,
    backgroundIntensity: 0.8, backgroundRotationY: 1.2,
  },

  locationNames: {
    'T SPAWN': 'T 出生点', 'CT SPAWN': 'CT 出生点', A: 'A 包点', B: 'B 包点',
    MID: '中路', 'A RAMP': 'A 坡', PALACE: '宫殿', CONNECTOR: '连接通道',
    WINDOW: '窗口', MARKET: '商店',
  },

  // Bot tactical waypoints still live in server/bot-tactics.js, which is
  // written against Dust II callout coordinates. Until a Mirage table exists,
  // bots fall back to the generic nav-driven behaviour rather than to Dust II
  // positions, which would send them into Mirage geometry that is not there.
  botWaypoints: null,
};
