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

import { moveKinematicTo, bodyPosition, teleportBody } from '../physics.js';

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
 * @param {any} entity
 * @param {any} params  {points: [[x,y], ...], speed}
 * @param {any} session  physics PlaySession
 * @param {number} dt
 * @param {MotionState} state
 */
export function doPatrolBetween(entity, params, session, dt, state) {
  const points = params.points;
  if (!points || points.length < 2) return;
  let progress = state.patrol.get(entity.id);
  if (!progress) { progress = { targetIndex: 1 }; state.patrol.set(entity.id, progress); }

  const pos = bodyPosition(session, entity.id);
  if (!pos) return;
  const target = points[progress.targetIndex];
  const dx = target[0] - pos.x, dy = target[1] - pos.y;
  const dist = Math.hypot(dx, dy);
  const speed = params.speed || 2;

  if (dist < 0.05) {
    progress.targetIndex = (progress.targetIndex + 1) % points.length;
  } else {
    const nx = pos.x + (dx / dist) * speed * dt;
    const ny = pos.y + (dy / dist) * speed * dt;
    moveKinematicTo(session, entity.id, nx, ny);
    // Face the direction of travel — 2D convention: transform.s[0] sign.
    entity.components.transform.s[0] = dx < 0
      ? -Math.abs(entity.components.transform.s[0])
      : Math.abs(entity.components.transform.s[0]);
  }
}

/**
 * DO follow-path: walk a kinematic entity through an ordered list of points
 * once (not ping-ponging like patrol), then stop at the last one.
 * @param {any} entity
 * @param {any} params  {points: [[x,y], ...], speed}
 * @param {any} session
 * @param {number} dt
 * @param {MotionState} state
 */
export function doFollowPath(entity, params, session, dt, state) {
  const points = params.points;
  if (!points || !points.length) return;
  let idx = state.pathProgress.get(entity.id);
  if (idx === undefined) { idx = 0; state.pathProgress.set(entity.id, idx); }
  if (idx >= points.length) return; // arrived — stays put

  const pos = bodyPosition(session, entity.id);
  if (!pos) return;
  const target = points[idx];
  const dx = target[0] - pos.x, dy = target[1] - pos.y;
  const dist = Math.hypot(dx, dy);
  const speed = params.speed || 2;

  if (dist < 0.05) {
    state.pathProgress.set(entity.id, idx + 1);
  } else {
    moveKinematicTo(session, entity.id, pos.x + (dx / dist) * speed * dt, pos.y + (dy / dist) * speed * dt);
  }
}

/**
 * DO teleport-to: instant relocation. Works on any body type via
 * physics.teleportBody; falls back to writing the transform directly for a
 * visual-only entity with no physics body at all.
 * @param {any} entity
 * @param {any} params  {x, y}
 * @param {any} session
 */
export function doTeleportTo(entity, params, session) {
  const moved = teleportBody(session, entity.id, params.x, params.y);
  if (!moved) {
    entity.components.transform.p[0] = params.x;
    entity.components.transform.p[1] = params.y;
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
