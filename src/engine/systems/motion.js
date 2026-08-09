/**
 * @file motion.js
 * @description Movement bricks: patrol, teleport, face, stop. Walk/jump/dash
 * for the player are the platformer template's baseline controller (built
 * into runtime.js, same pattern as the Stage's Test Dummy) — these bricks
 * are for everything ELSE that moves: patrol enemies, moving platforms,
 * teleport pads. Chase/flee/wander ride on Yuka and arrive with Phase 5's
 * ai.js — not built here.
 * Ticket P3-2. Phase 3.
 */

/* No physics import here anymore — every function takes a `phys` adapter
 * (runtime.js's createPhysicsAdapter) so the SAME brick works for 2D and 3D
 * games alike. 3D-ness is detected from the shape bodyPosition hands back:
 * 2D returns {x,y}; 3D returns {x,y,z}. Ground-plane axes are (x,y) in 2D
 * and (x,z) in 3D — height (world y) is held constant in 3D, since these
 * are ground-walking patrols, not flying ones. */

/**
 * @typedef {Object} MotionState
 * @property {Map<string, {targetIndex: number}>} patrol  entityId -> patrol progress
 * @property {Map<string, number>} pathProgress  entityId -> follow-path index
 */

/** @returns {MotionState} */
export function createMotionState() {
  return { patrol: new Map(), pathProgress: new Map() };
}

/**
 * DO patrol-between: ping-pong a kinematic entity between waypoints.
 * Waypoints are always 2-element [a, b] pairs: in a 2D scene that's [x, y];
 * in a 3D scene it's [x, z] (ground-plane), with height held at whatever
 * the entity was placed at.
 * @param {any} entity
 * @param {any} params  {points: [[a,b], ...], speed}
 * @param {any} session  physics PlaySession
 * @param {number} dt
 * @param {MotionState} state
 * @param {any} phys  the runtime's physics adapter (2D or 3D)
 */
export function doPatrolBetween(entity, params, session, dt, state, phys) {
  const points = params.points;
  if (!points || points.length < 2) return;

  const pos = phys.bodyPosition(session, entity.id);
  if (!pos) return;
  const is3D = pos.z !== undefined;
  const groundB = is3D ? pos.z : pos.y;

  let progress = state.patrol.get(entity.id);
  if (!progress) {
    // Remember where this one started, so a route can be written as offsets.
    // Without this, points are absolute world coordinates -- which meant two
    // copies of the same patrolling enemy both walked to the same two spots
    // instead of each patrolling where it was placed.
    progress = { targetIndex: 1, origin: [pos.x, groundB] };
    state.patrol.set(entity.id, progress);
  }

  const rel = params.relative ? progress.origin : [0, 0];
  const raw = points[progress.targetIndex];
  const target = [raw[0] + rel[0], raw[1] + rel[1]];
  const dx = target[0] - pos.x, db = target[1] - groundB;
  const dist = Math.hypot(dx, db);
  const speed = params.speed || 2;

  if (dist < 0.05) {
    progress.targetIndex = (progress.targetIndex + 1) % points.length;
  } else {
    const nx = pos.x + (dx / dist) * speed * dt;
    const nb = groundB + (db / dist) * speed * dt;
    if (is3D) {
      phys.moveKinematicTo(session, entity.id, nx, pos.y, nb, dt);
    } else {
      phys.moveKinematicTo(session, entity.id, nx, nb, dt);
      // Face the direction of travel — 2D convention: transform.s[0] sign.
      entity.components.transform.s[0] = dx < 0
        ? -Math.abs(entity.components.transform.s[0])
        : Math.abs(entity.components.transform.s[0]);
    }
  }
}

/**
 * DO follow-path: walk a kinematic entity through an ordered list of points
 * once (not ping-ponging like patrol), then stop at the last one. Same
 * [a,b] waypoint convention as patrol-between (2D: x,y — 3D: x,z).
 * @param {any} entity
 * @param {any} params  {points: [[a,b], ...], speed}
 * @param {any} session
 * @param {number} dt
 * @param {MotionState} state
 * @param {any} phys
 */
export function doFollowPath(entity, params, session, dt, state, phys) {
  const points = params.points;
  if (!points || !points.length) return;
  let idx = state.pathProgress.get(entity.id);
  if (idx === undefined) { idx = 0; state.pathProgress.set(entity.id, idx); }
  if (idx >= points.length) return; // arrived — stays put

  const pos = phys.bodyPosition(session, entity.id);
  if (!pos) return;
  const is3D = pos.z !== undefined;
  const groundB = is3D ? pos.z : pos.y;
  const target = points[idx];
  const dx = target[0] - pos.x, db = target[1] - groundB;
  const dist = Math.hypot(dx, db);
  const speed = params.speed || 2;

  if (dist < 0.05) {
    state.pathProgress.set(entity.id, idx + 1);
  } else {
    const nx = pos.x + (dx / dist) * speed * dt;
    const nb = groundB + (db / dist) * speed * dt;
    if (is3D) phys.moveKinematicTo(session, entity.id, nx, pos.y, nb, dt);
    else phys.moveKinematicTo(session, entity.id, nx, nb, dt);
  }
}

/**
 * DO teleport-to: instant relocation. Works on any body type via the
 * physics adapter's teleportBody; falls back to writing the transform
 * directly for a visual-only entity with no physics body at all.
 * @param {any} entity
 * @param {any} params  {x, y, z?}
 * @param {any} session
 * @param {any} phys
 */
export function doTeleportTo(entity, params, session, phys) {
  const moved = phys.teleportBody(session, entity.id, params.x, params.y, params.z);
  if (!moved) {
    entity.components.transform.p[0] = params.x;
    entity.components.transform.p[1] = params.y;
    if (params.z !== undefined) entity.components.transform.p[2] = params.z;
  }
}

/**
 * DO face: set 2D facing directly (left/right), independent of movement.
 * @param {any} entity
 * @param {any} params  {dir: 'left'|'right'}
 */
export function doFace(entity, params) {
  const s = entity.components.transform.s;
  s[0] = params.dir === 'left' ? -Math.abs(s[0]) : Math.abs(s[0]);
}

/**
 * DO stop: halt patrol/follow-path progress for this entity (it stays where
 * it is until another motion brick moves it again).
 * @param {any} entity
 * @param {MotionState} state
 */
export function doStop(entity, state) {
  state.patrol.delete(entity.id);
  state.pathProgress.delete(entity.id);
}
