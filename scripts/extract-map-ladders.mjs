// Harvest data that only exists in the *raw* Source 2 Viewer export, before
// scripts/map-optimize-textures.py strips every materials/tools/* primitive.
//
// Two things are mined here, both authoritative because they come from the map
// source rather than from an estimate:
//
//   1. Ladder volumes. CS2 ladders are invisible brushes textured
//      materials/tools/toolsinvisibleladder{,_wood}.vmat. That geometry is the
//      exact climbable volume, so we box-fit it instead of hand-placing rails.
//   2. Bombsite centres. materials/decals/bombsite_{a,b}.vmat are the sprays
//      painted on the ground inside each site, which pins A and B far better than
//      guessing from the nav mesh.
//
// Coordinates end up in gameplay space, applying the same +90 deg Y rotation
// client/map-scene.js applies to the render group: (x, y, z) -> (z, y, -x).
import fs from 'node:fs';
import path from 'node:path';
import {createReader, Logger} from './lib/gltf-transform.mjs';

const input = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
// Source 2 Viewer 20.0 does NOT export the invisible toolsinvisibleladder brush
// (it has no renderable shader), so the climb volume has to come from the
// *visible* ladder prop instead. Its rails and rungs occupy exactly the
// climbable space, so box-fitting them gives the same volume. Both rules are
// tried: if a future S2V does export the brush, that answer wins.
const LADDER_BRUSH = /materials\/tools\/toolsinvisibleladder/i;
const LADDER_PROP = /ladder/i;
const SITE_MATERIALS = { A: /materials\/decals\/bombsite_a\.vmat/i, B: /materials\/decals\/bombsite_b\.vmat/i };
const isLadderMatch = (material, mesh, node) =>
  LADDER_BRUSH.test(material) || LADDER_PROP.test(node) || LADDER_PROP.test(mesh) || LADDER_PROP.test(material);

const io = createReader();
const doc = await io.read(input);
doc.setLogger(new Logger(Logger.Verbosity.ERROR));
const root = doc.getRoot();
const vmatName = material => material?.getExtras()?.vmat?.Name || material?.getName() || ''
  || (material?.getExtras()?.vmat && JSON.stringify(material.getExtras().vmat)) || '';

const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Gameplay-space triangles of every primitive whose material or node matches.
 * `m` is gltf-transform's column-major world matrix, so
 *   x' = m0x + m4y + m8z + m12, y' = m1x + m5y + m9z + m13, z' = m2x + m6y + m10z + m14.
 * The render group then turns +90 deg about Y, which maps (x,y,z) -> (z,y,-x).
 */
function collectTriangles(match) {
  const triangles = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const primitives = mesh.listPrimitives().filter(prim => match(vmatName(prim.getMaterial()), mesh.getName(), node.getName()));
    if (!primitives.length) continue;
    const m = node.getWorldMatrix();
    for (const prim of primitives) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      const source = position.getArray();
      const indices = prim.getIndices()?.getArray() || null;
      const count = indices ? indices.length : position.getCount();
      for (let i = 0; i + 2 < count; i += 3) {
        const at = k => {
          const j = (indices ? indices[i + k] : i + k) * 3;
          const x = source[j], y = source[j + 1], z = source[j + 2];
          const gameX = m[2] * x + m[6] * y + m[10] * z + m[14];
          const gameY = m[1] * x + m[5] * y + m[9] * z + m[13];
          const sourceX = m[0] * x + m[4] * y + m[8] * z + m[12];
          return [gameX, gameY, -sourceX];
        };
        triangles.push([at(0), at(1), at(2)]);
      }
    }
  }
  return triangles;
}

/** Merge triangles into boxes by proximity, so one ladder is one volume. */
function clusterBoxes(triangles, gap = 1.0) {
  const boxes = [];
  for (const triangle of triangles) {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const point of triangle) {
      for (let axis = 0; axis < 3; axis++) {
        if (point[axis] < min[axis]) min[axis] = point[axis];
        if (point[axis] > max[axis]) max[axis] = point[axis];
      }
    }
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < boxes.length; i++) {
        const other = boxes[i];
        const near = min[0] - gap <= other.max[0] && max[0] + gap >= other.min[0] &&
                     min[1] - gap <= other.max[1] && max[1] + gap >= other.min[1] &&
                     min[2] - gap <= other.max[2] && max[2] + gap >= other.min[2];
        if (near) {
          other.min = other.min.map((v, axis) => Math.min(v, min[axis]));
          other.max = other.max.map((v, axis) => Math.max(v, max[axis]));
          boxes.splice(i, 1);
          min = other.min; max = other.max;
          merged = true;
          break;
        }
      }
    }
    boxes.push({ min, max });
  }
  return boxes;
}

// A visible prop is thinner than the climbable space it represents: real rungs
// are only a couple of decimetres. Widen the footprint to these floors so a
// player can mount from anywhere along the ladder, and keep the raw measurement
// for the audit trail.
const MIN_HALF_DEPTH = 0.75;
const MIN_HALF_WIDTH = 0.45;

/**
 * Fit a ladder volume to a box: thin along its face normal, wide along the
 * tangent. `yaw` uses the project convention where normal = (-sin yaw, -cos yaw).
 */
function volumeFromBox(box, index) {
  const size = box.max.map((v, axis) => v - box.min[axis]);
  const centre = box.max.map((v, axis) => (v + box.min[axis]) / 2);
  const normalAlongX = size[0] <= size[2];
  return {
    id: `ladder.${index}`,
    x: round(centre[0]), z: round(centre[2]),
    bottom: round(box.min[1]), top: round(box.max[1]),
    halfDepth: round(Math.max(Math.max(size[0], size[2]) / 2, MIN_HALF_DEPTH)),
    halfWidth: round(Math.max(Math.min(size[0], size[2]) / 2, MIN_HALF_WIDTH)),
    yaw: round(normalAlongX ? -Math.PI / 2 : 0, 4),
    _debug: { rawHalfDepth: round(Math.max(size[0], size[2]) / 2), rawHalfWidth: round(Math.min(size[0], size[2]) / 2), size: size.map(v => round(v)) },
  };
}

// --- ladders ---------------------------------------------------------------
const ladderTriangles = collectTriangles(isLadderMatch);
const ladderBoxes = clusterBoxes(ladderTriangles)
  // A ladder is tall and narrow; discard flat decal-sized or wall-sized junk.
  .filter(box => {
    const size = box.max.map((v, axis) => v - box.min[axis]);
    return size[1] > 1.5 && Math.min(size[0], size[2]) > 0.05 && Math.min(size[0], size[2]) < 2.5;
  })
  .sort((a, b) => a.min[2] - b.min[2]);
const ladders = ladderBoxes.map(volumeFromBox);

// --- bombsite centres ------------------------------------------------------
const sites = {};
for (const [site, pattern] of Object.entries(SITE_MATERIALS)) {
  const triangles = collectTriangles(name => pattern.test(name));
  if (!triangles.length) { console.error(`WARNING: no ${site} bombsite decal matched`); continue; }
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const triangle of triangles) for (const point of triangle) for (let axis = 0; axis < 3; axis++) {
    if (point[axis] < min[axis]) min[axis] = point[axis];
    if (point[axis] > max[axis]) max[axis] = point[axis];
  }
  const size = max.map((v, axis) => v - min[axis]);
  sites[site] = {
    x: round((min[0] + max[0]) / 2), y: round((min[1] + max[1]) / 2), z: round((min[2] + max[2]) / 2),
    // The spray is a flat decal, so this is its footprint, not a playable radius.
    radius: round(Math.max(4, Math.max(size[0], size[2]) / 2)),
    _debug: { footprint: size.slice(0, 3).map(v => round(v)) },
  };
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({ ladders, sites }, null, 2)}\n`);

// A silent zero is the dangerous outcome: the map ships with nothing to climb and
// nobody notices until players get stuck. State the count loudly either way.
console.error(`\n!! ${ladders.length} ladder volume(s) matched toolsinvisibleladder. ` +
  'If the map is known to have ladders, inspect the report before continuing.');
console.error(`   bombsite decals: ${Object.entries(sites).map(([k, v]) => `${k}@(${v.x}, ${v.z})`).join(' ') || 'none'}\n`);
console.log(JSON.stringify({ source: path.relative(process.cwd(), input), ladderCount: ladders.length, ladders, sites }, null, 2));
