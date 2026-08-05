/**
 * @file kitbay.js
 * @description Kit Bay: build a prop from primitive 3D parts — the full set
 * (box, sphere, cylinder, cone, wedge, plane, torus, capsule) — linked into
 * parent/child hierarchies (move a body, its wheels ride along), then save
 * the assembly as one prefab. The compound lives inside the prefab's model
 * component ({parts: [...]}); engine/meshes.js buildModelMesh renders it as
 * a nested THREE.Group, so the entity/prefab system stays single-entity.
 * The DOM lives in panels/kitbay-panel.js.
 * Ticket P6-4. Phase 6.
 */

import { saveAsPrefab } from '../engine/entities.js';

/** Every shape buildPartGeo (meshes.js) knows how to render. */
export const SHAPES = ['box', 'sphere', 'cylinder', 'cone', 'wedge', 'plane', 'torus', 'capsule'];

const SHAPE_LABELS = {
  box: 'Box', sphere: 'Sphere', cylinder: 'Cylinder', cone: 'Cone',
  wedge: 'Wedge', plane: 'Plane', torus: 'Ring', capsule: 'Capsule'
};

/** @param {string} shape @returns {string} */
export function labelFor(shape) {
  return SHAPE_LABELS[shape] || shape;
}

/**
 * @param {string} [shape]
 * @returns {any} one part: shape + color + size + local transform + parent
 *   (index into the prop's parts array, -1 = attached to the root)
 */
export function createPart(shape = 'box') {
  return { shape, swatch: '#6fb2dc', size: [1, 1, 1], p: [0, 0, 0], r: [0, 0, 0], parent: -1 };
}

/**
 * @param {string} [shape]
 * @returns {any} a blank, unsaved prop: one starting part
 */
export function createProp(shape = 'box') {
  return { parts: [createPart(shape)], solid: true };
}

/**
 * Add a part; new parts attach to the given parent (or the root).
 * @param {any} prop @param {string} shape @param {number} [parent]
 * @returns {number} the new part's index
 */
export function addPart(prop, shape, parent = -1) {
  const part = createPart(shape);
  part.parent = parent;
  // Spawn beside its parent so it doesn't hide inside it.
  part.p = [1.2, 0, 0];
  prop.parts.push(part);
  return prop.parts.length - 1;
}

/**
 * Remove a part; its children re-attach to its parent so the assembly never
 * silently loses limbs.
 * @param {any} prop @param {number} index
 * @returns {boolean}
 */
export function removePart(prop, index) {
  if (prop.parts.length <= 1 || index < 0 || index >= prop.parts.length) return false;
  const fallback = prop.parts[index].parent;
  prop.parts.splice(index, 1);
  for (const part of prop.parts) {
    if (part.parent === index) part.parent = fallback === index ? -1 : fallback;
    else if (part.parent > index) part.parent--;
  }
  return true;
}

/**
 * Axis-aligned bounding size of the whole assembly (coarse — local rotations
 * ignored; good enough for a physics box).
 * @param {any} prop
 * @returns {number[]} [w, h, d]
 */
export function boundingSize(prop) {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const worldPos = (i) => {
    let pos = [0, 0, 0], cur = i, guard = 0;
    while (cur >= 0 && guard++ < 64) {
      const part = prop.parts[cur];
      pos = [pos[0] + part.p[0], pos[1] + part.p[1], pos[2] + part.p[2]];
      cur = part.parent;
    }
    return pos;
  };
  prop.parts.forEach((part, i) => {
    const c = worldPos(i);
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], c[a] - part.size[a] / 2);
      max[a] = Math.max(max[a], c[a] + part.size[a] / 2);
    }
  });
  return [Math.max(0.1, max[0] - min[0]), Math.max(0.1, max[1] - min[1]), Math.max(0.1, max[2] - min[2])];
}

/**
 * Save a Kit Bay assembly as a prefab in the cartridge, ready to place from
 * the Warehouse like any other prefab.
 * @param {any} cartridge
 * @param {string} name
 * @param {any} prop  {parts, solid}
 * @returns {string} the prefab's slug
 */
export function savePropAsPrefab(cartridge, name, prop) {
  const components = {
    transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
    model: { asset: null, parts: prop.parts.map((part) => ({ ...part, size: [...part.size], p: [...part.p], r: [...part.r] })) }
  };
  if (prop.solid) {
    components.body = { type: 'static', size: boundingSize(prop) };
  }
  return saveAsPrefab(cartridge, { name, components }, name);
}
