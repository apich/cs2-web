// Dust II descriptor. A thin wrapper over the generated map-data.js so the
// geometry values keep exactly one source of truth. The added fields are the
// per-map configuration that client/map-scene.js and client/hud.js used to
// hardcode; moving them here is what makes a second map possible.
import { MAP } from '../map-data.js';
import { DUST2_BOT_WAYPOINTS } from './bot-waypoints.js';

export const DUST2 = {
  id: 'de_dust2',
  name: MAP.name,
  nameZh: '炙热沙城 II',
  tagline: '中门的每一条视线，<br>都值得你多看一眼。',
  version: MAP.version,
  sourceBuild: MAP.sourceBuild,
  metersPerSourceUnit: MAP.metersPerSourceUnit,
  bounds: MAP.bounds,
  spawns: MAP.spawns,
  sites: MAP.sites,
  nav: MAP.nav,
  labels: MAP.labels,
  overview: MAP.overview,
  geometryInfo: MAP.geometryInfo,

  // Floors that read as sand in the map source but carry no material id. These
  // are Dust II's Pit; without a per-map patch, shared physics claims this box
  // on every map, so Mirage gets sand footsteps where it has none.
  groundPatches: [
    { material: 'sand', min: { x: 22, y: -Infinity, z: -18 }, max: { x: Infinity, y: -1.5, z: Infinity } },
  ],

  // No functional ladder on Dust II: its vmap never references
  // materials/tools/toolsinvisibleladder*.vmat. dust_kasbah_ladder is a
  // decorative prop only, so the ladder system has nothing to mount here.
  ladders: [],

  assets: {
    // Dust II keeps its historical layout; newer maps use public/assets/maps/<id>/.
    geometryUrl: MAP.geometryUrl,
    penetrationUrl: '/assets/map/penetration-materials.u8',
    renderDesktop: '/assets/map-cs2/dust2-web.gltf',
    renderMobile: '/assets/map-mobile/dust2-mobile.gltf',
    // Only the desktop render URL carries a cache-busting query, matching the
    // behaviour before this became per-map data. loading.js canonicalises the
    // path for its blob cache, so this is only a plain-fetch fallback.
    renderVersionDesktop: 'e4f2b2d3903c',
    radarImage: MAP.overview?.image || '/assets/valve-dust2/de_dust2_radar_psd.png',
  },

  // Shared across maps; kept per-descriptor so a future map can swap its sky.
  skyUrl: '/assets/sky/daylight.hdr?v=5244534e9cf5',

  // Lobby/loading backdrop. Per-map so a room never loads behind another map's
  // photo; a map without one shows the plain shade instead.
  backdrop: '/assets/valve-dust2/de_dust2_1_png.png',

  lighting: {
    fogColor: 0xc9d8de, fogNear: 140, fogFar: 300,
    hemisphereSky: 0xd5e9ff, hemisphereGround: 0x99805f, hemisphereIntensity: 2.15,
    sunColor: 0xfff0d7, sunIntensity: 3.3,
    // Kept from the exported S2V sun; map-scene.js overrides it when the original
    // directional light resolves to a usable direction.
    sunDirection: { x: -0.43, y: -0.84, z: -0.33 },
    sunCenter: { x: -5, y: 0, z: -25 },
    sunOffset: 110,
    shadowExtent: 78, shadowNear: 1, shadowFar: 230, shadowMapSize: 2048,
    shadowNormalBias: 0.035, shadowBias: -0.00012,
    backgroundIntensity: 0.8, backgroundRotationY: 1.2,
  },

  // Radar/location callout labels, Chinese where a known translation exists.
  locationNames: {
    'T SPAWN': 'T 出生点', 'CT SPAWN': 'CT 出生点', A: 'A 包点', B: 'B 包点',
    MID: '中路', 'LONG A': 'A 大道', TUNNELS: 'B 洞', CATWALK: 'A 小道',
  },

  // Native Dust II tactical geometry, moved verbatim from server/bot-tactics.js.
  botWaypoints: DUST2_BOT_WAYPOINTS,
};
