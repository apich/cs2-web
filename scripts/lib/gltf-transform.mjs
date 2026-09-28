// Shared access to the gltf-transform packages the map pipeline uses.
//
// map-optimize-geometry.mjs used to resolve these out of AppData/Local/npm-cache/_npx,
// which only exists on a machine that had happened to run the CLI through npx.
// They are devDependencies now, so resolve them like any other module.
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// scripts/lib/ -> scripts/ -> project root
const root = path.resolve(import.meta.dirname, '..', '..');

const load = async name => import(pathToFileURL(path.join(root, 'node_modules', name)).href);

export const [core, extensions, functions] = await Promise.all([
  load('@gltf-transform/core/dist/index.js'),
  load('@gltf-transform/extensions/dist/index.js'),
  load('@gltf-transform/functions/dist/index.js'),
]);

export const {NodeIO, Logger, Matrix4, Vector3, Box3} = core;
export const {ALL_EXTENSIONS} = extensions;

/** A reader that understands every extension the export may use. */
export function createReader() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}
