// Dust II bot tactical waypoints, in gameplay space.
//
// These are the literal coordinate tables that used to live inline in
// server/bot-tactics.js, moved here unchanged so Dust II bot behaviour is
// identical. Keys are the route/waypoint names bot-tactics.js refers to.
export const DUST2_BOT_WAYPOINTS = {
  // Route anchors: `raw` in bot-tactics.js.
  long:    { x: 40,  y: 0,   z: -31 },
  short:   { x: 7,   y: 2.5, z: -48 },
  mid:     { x: -11, y: 0,   z: -31 },
  doors:   { x: -11, y: -1,  z: -48 },
  tunnels: { x: -43, y: 0,   z: -27 },
  bEntry:  { x: -42, y: 0,   z: -53 },

  // Hold positions per site, indexed by seat. `hold()` in bot-tactics.js.
  holdA: [
    { x: 27, y: 2.5, z: -67 },
    { x: 36, y: 2.8, z: -66 },
    { x: 23, y: 2.5, z: -62 },
    { x: 31, y: 3,   z: -72 },
  ],
  holdB: [
    { x: -46, y: 0.8, z: -69 },
    { x: -38, y: 0.3, z: -68 },
    { x: -34, y: 0.4, z: -70 },
    { x: -43, y: 0.3, z: -65 },
  ],

  // Sightline watch positions per site and team. `watchPoints()` in bot-tactics.js.
  watchA_T: [{ x: 28, y: 3, z: -68 }, { x: 35, y: 3, z: -64 }, { x: 18, y: 0, z: -57 }],
  watchA_CT: [{ x: 39, y: 1.6, z: -40 }, { x: 8, y: 4, z: -53 }, { x: 15, y: 2, z: -59 }],
  watchB_T: [{ x: -46, y: 2, z: -69 }, { x: -30, y: 3, z: -66 }, { x: -28, y: 1, z: -56 }],
  watchB_CT: [{ x: -43, y: 1.5, z: -57 }, { x: -30, y: 3, z: -66 }, { x: -28, y: 1, z: -56 }],

  // T attack routes, and the CT role->route mapping.
  attackRoutes: {
    A_split: ['mid', 'short', 'A'],
    A_long: ['long', 'A'],
    B_split: ['mid', 'doors', 'B'],
    B_long: ['tunnels', 'bEntry', 'B'],
  },
  ctRoleLane: { short: 'short', mid: 'doors', rotator: 'short' },
  ctRoles: ['anchor-b', 'anchor-a', 'short', 'mid', 'rotator'],
};
