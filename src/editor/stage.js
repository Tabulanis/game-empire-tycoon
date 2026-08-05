/**
 * @file stage.js
 * @description Level Stage logic: building renderable views from scene entity
 * data (mesh construction itself lives in engine/meshes.js, shared with the
 * real runtime), selection raycasting, grid/vertex snapping, and tile
 * painting math. The DOM lives in panels/stage-panel.js — this module
 * mirrors the warehouse.js / warehouse-panel.js split established in P0.
 * Play/Stop used to run its own simplified physics-only test session here
 * (P2-8); as of Phase 3 the Stage's Play button runs the real bricksheet-
 * driven game via engine/runtime.js instead — see stage-panel.js.
 * Tickets P2-2 .. P2-6. Phase 2.
 */

import * as THREE from 'three';
import {
  buildSceneView,
  syncTransform,
  readTransform
} from '../engine/meshes.js';

// Re-exported for panels/stage-panel.js — the implementation lives in
// engine/meshes.js now (shared with runtime.js), but the Stage's public
// surface hasn't moved.
export { buildSceneView, syncTransform, readTransform };

/** How close two bounding-box corners must be for vertex snap to bite. */
export const VERTEX_SNAP_RADIUS = 0.35;

/* ------------------------------------------------------------------ */
/* picking + ground plane                                              */
/* ------------------------------------------------------------------ */

const _raycaster = new THREE.Raycaster();
const _plane = new THREE.Plane();
const _hit = new THREE.Vector3();

/**
 * Raycast the content root and return the hit entity id, or null.
 * @param {any} engine
 * @param {{x: number, y: number}} ndc normalized device coords (-1..1)
 * @returns {string|null}
 */
export function pickEntity(engine, ndc) {
  _raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), engine.camera);
  const hits = _raycaster.intersectObjects(engine.contentRoot.children, true);
  for (const hit of hits) {
    let o = hit.object;
    while (o && !o.userData.entityId) o = o.parent;
    if (o && o.userData.entityId) return o.userData.entityId;
  }
  return null;
}

/**
 * Project a pointer position onto the editing ground plane:
 * z = 0 (XY plane) in 2D mode, y = 0 (XZ plane) in 3D mode.
 * @param {any} engine
 * @param {{x: number, y: number}} ndc
 * @returns {[number, number, number]|null}
 */
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

export function groundPoint(engine, ndc) {
  _raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), engine.camera);
  if (engine.mode === '2d') {
    _plane.set(new THREE.Vector3(0, 0, 1), 0);
  } else {
    _plane.set(new THREE.Vector3(0, 1, 0), 0);
  }
  const ok = _raycaster.ray.intersectPlane(_plane, _hit);
  return ok ? [round3(_hit.x), round3(_hit.y), round3(_hit.z)] : null;
}

/* ------------------------------------------------------------------ */
/* snapping (P2-3)                                                     */
/* ------------------------------------------------------------------ */

/**
 * Snap a moved object's bounding-box corners to the nearest corner of any
 * OTHER entity within VERTEX_SNAP_RADIUS. Returns the position delta to apply,
 * or null when nothing is in range.
 * @param {THREE.Object3D} moved
 * @param {SceneView} view
 * @param {string} movedId
 * @returns {THREE.Vector3|null}
 */
export function vertexSnapDelta(moved, view, movedId) {
  const movedBox = new THREE.Box3().setFromObject(moved);
  if (movedBox.isEmpty()) return null;
  const movedCorners = boxCorners(movedBox);

  let best = null;
  let bestDist = VERTEX_SNAP_RADIUS;
  for (const [id, obj] of view.objects) {
    if (id === movedId) continue;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) continue;
    for (const target of boxCorners(box)) {
      for (const corner of movedCorners) {
        const dist = corner.distanceTo(target);
        if (dist < bestDist) {
          bestDist = dist;
          best = new THREE.Vector3().subVectors(target, corner);
        }
      }
    }
  }
  return best;
}

/**
 * @param {THREE.Box3} box
 * @returns {THREE.Vector3[]}
 */
function boxCorners(box) {
  const { min, max } = box;
  return [
    new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(min.x, max.y, min.z), new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z), new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, max.z), new THREE.Vector3(max.x, max.y, max.z)
  ];
}

/* ------------------------------------------------------------------ */
/* tile painting math (P2-5)                                           */
/* ------------------------------------------------------------------ */

/**
 * World point -> integer cell coords inside a tilemap entity.
 * @param {any} entity tilemap-bearing entity
 * @param {[number, number, number]} point world ground point
 * @returns {{cx: number, cy: number}}
 */
export function cellAt(entity, point) {
  const t = entity.components.transform;
  const cell = entity.components.tilemap.cell || 1;
  return {
    cx: Math.floor((point[0] - t.p[0]) / cell),
    cy: Math.floor((point[1] - t.p[1]) / cell)
  };
}

/**
 * @param {any} map tilemap component
 * @param {number} cx
 * @param {number} cy
 * @param {{item: string, swatch: string}} brush
 * @returns {boolean} true when the map changed
 */
export function paintTile(map, cx, cy, brush) {
  const key = cx + ',' + cy;
  const cur = map.tiles[key];
  if (cur && cur.item === brush.item) return false;
  map.tiles[key] = { item: brush.item, swatch: brush.swatch };
  return true;
}

/**
 * @param {any} map tilemap component
 * @param {number} cx
 * @param {number} cy
 * @returns {boolean} true when the map changed
 */
export function eraseTile(map, cx, cy) {
  const key = cx + ',' + cy;
  if (!(key in map.tiles)) return false;
  delete map.tiles[key];
  return true;
}
