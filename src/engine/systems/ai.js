/**
 * @file ai.js
 * @description Yuka-backed steering (chase/flee/wander — Article VII's
 * catalog footnote requires these ride on Yuka, not hand-rolled math) and
 * A* grid pathfinding, built on Yuka's own Graph/NavNode/AStar classes.
 *
 * Integration approach: each AI-driven entity gets one Yuka Vehicle, synced
 * FROM its Rapier kinematic body's current position every frame (so
 * steering never drifts from the real game world), then Yuka computes one
 * step of steering + position integration, and the RESULTING DELTA is
 * applied back to the Rapier body via physics.moveKinematicTo — exactly the
 * same "one write path onto a kinematic body" pattern motion.js's
 * patrol-between already uses. Yuka contributes the behavior math; Rapier
 * still owns collision-aware movement.
 * Ticket P5-2/P5-3. Phase 5.
 */

import * as YUKA from 'yuka';
// No physics import here — every function takes a `phys` adapter, same
// reasoning as motion.js: one implementation, works for 2D and 3D games.

/**
 * @typedef {Object} AiState
 * @property {Map<string, any>} vehicles  entityId -> Yuka.Vehicle
 */

/** @returns {AiState} */
export function createAiState() {
  return { vehicles: new Map() };
}

/**
 * @param {AiState} state
 * @param {string} entityId
 * @param {{x: number, y: number}} pos
 * @param {number} [maxSpeed]
 * @returns {any} the entity's Yuka.Vehicle, creating one on first use
 */
function ensureVehicle(state, entityId, pos, maxSpeed = 3) {
  let vehicle = state.vehicles.get(entityId);
  if (!vehicle) {
    vehicle = new YUKA.Vehicle();
    vehicle.maxSpeed = maxSpeed;
    vehicle.maxForce = maxSpeed * 2;
    state.vehicles.set(entityId, vehicle);
  }
  // steering runs on the GROUND PLANE: world (x,y) in 2D, world (x,z) in 3D
  // (height is held constant — these are walking enemies, not flying ones).
  // Yuka's own Vector3 is reused as a flat 2D-in-3-slots workspace either
  // way, exactly as it always was for 2D; the only change is which world
  // axis feeds Yuka's "y".
  const groundB = pos.z !== undefined ? pos.z : pos.y;
  vehicle.position.set(pos.x, groundB, 0);
  return vehicle;
}

/**
 * Advance one Yuka steering behavior and apply the resulting movement delta
 * to the entity's real (Rapier) kinematic body.
 * @param {any} vehicle
 * @param {any} session
 * @param {string} entityId
 * @param {number} dt
 */
function applySteering(vehicle, session, entityId, dt, phys) {
  const before = vehicle.position.clone();
  vehicle.update(dt);
  const dx = vehicle.position.x - before.x;
  const db = vehicle.position.y - before.y; // ground-plane delta (see ensureVehicle)
  const pos = phys.bodyPosition(session, entityId);
  if (!pos) return;
  if (pos.z !== undefined) phys.moveKinematicTo(session, entityId, pos.x + dx, pos.y, pos.z + db, dt);
  else phys.moveKinematicTo(session, entityId, pos.x + dx, pos.y + db, dt);
}

/* ------------------------------------------------------------------ */
/* DO — chase / flee / wander                                          */
/* ------------------------------------------------------------------ */

/**
 * Resolve a chase/flee target's current world position — either a named
 * entity (tracked live, so "chase the player" actually follows them) or an
 * explicit fixed point.
 * @param {any} params  {target?: string, x?: number, y?: number}
 * @param {any} session
 * @param {{entities: Array<any>}} scene
 * @returns {{x: number, y: number}|null}
 */
function resolveTargetPosition(params, session, scene, phys) {
  if (params.target) {
    const pos = phys.bodyPosition(session, params.target);
    if (pos) return pos; // {x,y} in 2D, {x,y,z} in 3D — same shape bodyPosition always returns
    const entity = scene.entities.find((e) => e.id === params.target);
    if (entity) {
      const p = entity.components.transform.p;
      return { x: p[0], y: p[1], z: p[2] };
    }
    return null;
  }
  if (params.x !== undefined && params.y !== undefined) return { x: params.x, y: params.y, z: params.z };
  return null;
}

/**
 * @param {any} entity
 * @param {any} params  {target?: string, x?, y?, speed?}
 * @param {any} session
 * @param {{entities: Array<any>}} scene
 * @param {number} dt
 * @param {AiState} state
 */
export function doChase(entity, params, session, scene, dt, state, phys) {
  const target = resolveTargetPosition(params, session, scene, phys);
  if (!target) return;
  const pos = phys.bodyPosition(session, entity.id);
  if (!pos) return;
  const is3D = pos.z !== undefined;
  const targetB = is3D ? (target.z !== undefined ? target.z : 0) : target.y;
  const vehicle = ensureVehicle(state, entity.id, pos, params.speed || 3);
  vehicle.steering.clear();
  vehicle.steering.add(new YUKA.SeekBehavior(new YUKA.Vector3(target.x, targetB, 0)));
  applySteering(vehicle, session, entity.id, dt, phys);
}

/**
 * @param {any} entity
 * @param {any} params  {target?: string, x?, y?, speed?}
 * @param {any} session
 * @param {{entities: Array<any>}} scene
 * @param {number} dt
 * @param {AiState} state
 */
export function doFlee(entity, params, session, scene, dt, state, phys) {
  const target = resolveTargetPosition(params, session, scene, phys);
  if (!target) return;
  const pos = phys.bodyPosition(session, entity.id);
  if (!pos) return;
  const is3D = pos.z !== undefined;
  const targetB = is3D ? (target.z !== undefined ? target.z : 0) : target.y;
  const vehicle = ensureVehicle(state, entity.id, pos, params.speed || 3);
  vehicle.steering.clear();
  vehicle.steering.add(new YUKA.FleeBehavior(new YUKA.Vector3(target.x, targetB, 0)));
  applySteering(vehicle, session, entity.id, dt, phys);
}

/**
 * @param {any} entity
 * @param {any} params  {speed?}
 * @param {any} session
 * @param {number} dt
 * @param {AiState} state
 */
export function doWander(entity, params, session, dt, state, phys) {
  const pos = phys.bodyPosition(session, entity.id);
  if (!pos) return;
  const vehicle = ensureVehicle(state, entity.id, pos, params.speed || 2);
  if (!vehicle.steering.behaviors.length) {
    vehicle.steering.add(new YUKA.WanderBehavior());
  }
  applySteering(vehicle, session, entity.id, dt, phys);
}

/**
 * Stop an entity's steering (the AI equivalent of motion.js's doStop).
 * @param {any} entity
 * @param {AiState} state
 */
export function doStopSteering(entity, state) {
  const vehicle = state.vehicles.get(entity.id);
  if (vehicle) vehicle.steering.clear();
}

/* ------------------------------------------------------------------ */
/* A* grid pathfinding                                                  */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} NavGrid
 * @property {any} graph  Yuka.Graph
 * @property {number} cell  world units per grid cell
 * @property {number} minX @property {number} minY  grid origin in world space
 * @property {number} cols @property {number} rows
 */

/**
 * Build a walkable navigation grid from a scene's solid geometry (tilemaps
 * and static/kinematic bodies) — one Yuka NavNode per open cell, edges to
 * the 4 orthogonal neighbors. Rebuilt whenever the level geometry changes;
 * cheap enough to do once per Play session start.
 * @param {{entities: Array<any>}} scene
 * @param {{cell?: number, minX?: number, minY?: number, cols?: number, rows?: number}} [opts]
 * @returns {NavGrid}
 */
export function buildNavGrid(scene, opts = {}) {
  const cell = opts.cell || 1;
  const minX = opts.minX !== undefined ? opts.minX : -15;
  const minY = opts.minY !== undefined ? opts.minY : -15;
  const cols = opts.cols || 30;
  const rows = opts.rows || 30;

  /** @type {Set<number>} blocked cell indices */
  const blocked = new Set();
  const idx = (cx, cy) => cy * cols + cx;
  const worldToCell = (x, y) => ({ cx: Math.floor((x - minX) / cell), cy: Math.floor((y - minY) / cell) });

  for (const entity of scene.entities) {
    if (entity.components.tilemap) {
      const t = entity.components.transform;
      const tmCell = entity.components.tilemap.cell || 1;
      for (const key of Object.keys(entity.components.tilemap.tiles)) {
        const [tx, ty] = key.split(',').map(Number);
        const wx = t.p[0] + (tx + 0.5) * tmCell;
        const wy = t.p[1] + (ty + 0.5) * tmCell;
        const { cx, cy } = worldToCell(wx, wy);
        if (cx >= 0 && cx < cols && cy >= 0 && cy < rows) blocked.add(idx(cx, cy));
      }
    } else if (entity.components.body && entity.components.body.type === 'static') {
      const t = entity.components.transform;
      const { cx, cy } = worldToCell(t.p[0], t.p[1]);
      if (cx >= 0 && cx < cols && cy >= 0 && cy < rows) blocked.add(idx(cx, cy));
    }
  }

  const graph = new YUKA.Graph();
  graph.digraph = false;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!blocked.has(idx(cx, cy))) graph.addNode(new YUKA.NavNode(idx(cx, cy)));
    }
  }
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (blocked.has(idx(cx, cy))) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        if (blocked.has(idx(nx, ny))) continue;
        graph.addEdge(new YUKA.Edge(idx(cx, cy), idx(nx, ny), 1));
      }
    }
  }

  return { graph, cell, minX, minY, cols, rows };
}

/**
 * Find a path between two world positions on a nav grid, returning it as a
 * list of world-space waypoints ready for motion.js's follow-path brick.
 * Returns an empty array (never throws) when no path exists — "never fails,
 * never guesses silently" applies here too: an empty path just means the
 * caller's follow-path brick has nothing to do this time.
 * @param {NavGrid} navGrid
 * @param {[number, number]} fromWorld
 * @param {[number, number]} toWorld
 * @returns {Array<[number, number]>}
 */
export function findPath(navGrid, fromWorld, toWorld) {
  const { graph, cell, minX, minY, cols, rows } = navGrid;
  const toCellIndex = (x, y) => {
    const cx = Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / cell)));
    const cy = Math.max(0, Math.min(rows - 1, Math.floor((y - minY) / cell)));
    return cy * cols + cx;
  };
  const fromIdx = toCellIndex(fromWorld[0], fromWorld[1]);
  const toIdx = toCellIndex(toWorld[0], toWorld[1]);
  if (!graph.hasNode(fromIdx) || !graph.hasNode(toIdx)) return [];

  const astar = new YUKA.AStar(graph, fromIdx, toIdx);
  astar.search();
  if (!astar.found) return [];

  return astar.getPath().map((nodeIndex) => {
    const cx = nodeIndex % cols;
    const cy = Math.floor(nodeIndex / cols);
    return [minX + (cx + 0.5) * cell, minY + (cy + 0.5) * cell];
  });
}
