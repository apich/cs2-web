// Ladder volumes.
//
// CS2 marks climbable space with invisible brushes textured
// materials/tools/toolsinvisibleladder*.vmat. Source 2 Viewer exports those
// brushes, and scripts/extract-map-ladders.mjs harvests them into the records
// below before scripts/map-optimize-textures.py strips every tools material —
// so the climb volume and the collision geometry come from the same map source
// instead of being hand-estimated.
//
// Angles use the project's usual convention (see shared/aim.js): a horizontal
// forward vector is (-sin yaw, -cos yaw) and its perpendicular "right" is
// (cos yaw, -sin yaw). `yaw` here is the yaw a player would have facing the
// ladder, so the ladder's outward normal is the same expression.

export const LADDER_CLIMB_SPEED = 5.0;    // m/s upward
export const LADDER_DESCENT_SPEED = 7.5;  // m/s downward; Source descends faster
export const LADDER_MOUNT_DOT = 0.25;     // how hard you must push into the face
export const LADDER_LEAVE_DOT = 0.3;      // pushing this hard away from the face steps off
export const LADDER_GRAB_MARGIN = 0.35;   // volume slack when grabbing
export const LADDER_JUMP_SPEED = 0.62;    // fraction of JUMP_SPEED when jumping off
export const LADDER_JUMP_PUSH = 3.0;      // lateral m/s away from the face
export const LADDER_LEDGE_SWEEP = 0.6;    // downward sweep for a floor under the shaft
export const LADDER_LEDGE_REACH = 2.0;    // how far sideways a ladder can open onto a floor
// A ladder's `top` is the top of the climb volume, which overshoots the floor by
// up to the sweep distance. Its `bottom` is the floor you grab it on, so that
// end has almost no slack — a floor well below it is a different level, and
// dropping a climber onto one is how they end up under the map.
export const LADDER_BASE_TOLERANCE = 0.1;
export const LADDER_SNAP = 1e-6;

/** Outward normal of a ladder face, horizontal. */
export function ladderNormal(ladder) {
  return { x: -Math.sin(ladder.yaw), z: -Math.cos(ladder.yaw) };
}

export function findLadderById(ladders, id) {
  if (!Array.isArray(ladders) || !id) return null;
  return ladders.find(ladder => ladder.id === id) || null;
}

/**
 * Closest ladder volume containing the point. `margin` widens the volume, which
 * lets a player grab a ladder slightly before their hull is flush against it.
 * Vertical bounds test the player's feet (p.y), matching the map data.
 */
export function ladderVolumeAt(ladders, x, y, z, margin = 0) {
  if (!Array.isArray(ladders) || !ladders.length) return null;
  for (const ladder of ladders) {
    const dx = x - ladder.x, dz = z - ladder.z;
    // Project onto the ladder's tangent and normal.
    const along = dx * Math.cos(ladder.yaw) - dz * Math.sin(ladder.yaw);
    const against = -dx * Math.sin(ladder.yaw) - dz * Math.cos(ladder.yaw);
    const halfDepth = Number(ladder.halfDepth) || 0.5;
    const halfWidth = Number(ladder.halfWidth) || 0.5;
    if (Math.abs(along) > halfDepth + margin) continue;
    if (Math.abs(against) > halfWidth + margin) continue;
    if (y < (Number(ladder.bottom) || 0) - margin) continue;
    if (y > (Number(ladder.top) || 0) + margin) continue;
    return ladder;
  }
  return null;
}

/**
 * Climb direction while on a ladder, taken from the forward axis rather than the
 * view: hold W to climb, hold S to descend, hold neither to hang. That is how
 * every ladder in a shooter reads once you are already on it, and it leaves the
 * view free - you can watch the wall, the drop, or over your shoulder while
 * climbing. The dead band keeps stick drift or a resting key from creeping a
 * player up a shaft they meant to stop on.
 */
export function ladderClimbRate(forward) {
  const value = Math.max(-1, Math.min(1, Number(forward) || 0));
  if (value > 0.05) return 1;
  if (value < -0.05) return -1;
  return 0;
}

/**
 * True when the player's horizontal wish direction walks into the face. The
 * normal points away from the wall toward the player, so approaching it is a
 * negative dot product — the sign is easy to get backwards; tests/ladders.mjs
 * pins it.
 */
export function ladderWantsMount(ladder, direction) {
  if (!ladder || !direction) return false;
  const normal = ladderNormal(ladder);
  return direction.x * normal.x + direction.z * normal.z < -LADDER_MOUNT_DOT;
}

/** True when the player is leaning off the face rather than into it. */
export function ladderWantsLeave(ladder, direction) {
  if (!ladder || !direction) return false;
  const normal = ladderNormal(ladder);
  return direction.x * normal.x + direction.z * normal.z > LADDER_LEAVE_DOT;
}
