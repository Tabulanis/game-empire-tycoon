/**
 * @file kitbay.js
 * @description Kit Bay: build a prop from a primitive 3D shape (box,
 * sphere, cylinder, cone), tune its size and color, and save it as a
 * reusable prefab — the 3D counterpart to how the Pixel Atelier turns
 * pixels into a sprite. Scope note: each prefab is a single primitive, not
 * a multi-part kitbash — the prefab system (entities.js) is single-entity
 * only, and extending it to compound assemblies is future work, not a
 * silent gap here.
 * Ticket P6-4. Phase 6.
 */

import { saveAsPrefab } from '../engine/entities.js';

/** Every shape buildModelMesh (meshes.js) knows how to render. */
export const SHAPES = ['box', 'sphere', 'cylinder', 'cone'];

const SHAPE_LABELS = { box: 'Box', sphere: 'Sphere', cylinder: 'Cylinder', cone: 'Cone' };

/** @param {string} shape @returns {string} */
export function labelFor(shape) {
  return SHAPE_LABELS[shape] || shape;
}

/**
 * @param {string} [shape]
 * @returns {any} a blank, unsaved prop
 */
export function createProp(shape = 'box') {
  return { shape, swatch: '#6fb2dc', size: [1, 1, 1], solid: true, shader: null };
}

/**
 * Save a Kit Bay prop as a prefab in the cartridge, ready to place from the
 * Warehouse like any other prefab.
 * @param {any} cartridge
 * @param {string} name
 * @param {any} prop  {shape, swatch, size, solid}
 * @returns {string} the prefab's slug
 */
export function savePropAsPrefab(cartridge, name, prop) {
  const components = {
    transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
    model: { asset: null, shape: prop.shape, swatch: prop.swatch, size: [...prop.size], shader: prop.shader || null }
  };
  if (prop.solid) {
    components.body = { type: 'static', size: [...prop.size] };
  }
  return saveAsPrefab(cartridge, { name, components }, name);
}
