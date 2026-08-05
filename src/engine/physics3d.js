/**
 * @file physics3d.js
 * @description Rapier 3D wrapper — the 3D counterpart to physics.js. Mirrors
 * its proven shape deliberately (same function names and session structure
 * where sensible) rather than trying to make one module handle both 2D and
 * 3D geometry, which would tangle two genuinely different collision/gravity
 * models together. rapier3d-compat has sat in the dependency whitelist since
 * Phase 0, unused until now.
 *
 * Scope note: no tilemap support here — tilemaps are a 2D-only authoring
 * concept (the Stage's paint tool is 2D-specific too). A 3D level's ground
 * is a body component like everything else, typically one large static box.
 *
 * API verified against @dimforge/rapier3d-compat 0.14.0 — the same method
 * names as the 2D crate (createCharacterController, enableSnapToGround,
 * computeColliderMovement, computedMovement/computedGrounded), just with
 * {x,y,z} vectors instead of {x,y}.
 * Ticket P6-1. Phase 6.
 */

import RAPIER3D from '@dimforge/rapier3d-compat';
import { buildTerrainCollision } from './meshes.js';

let ready = false;

/** @returns {Promise<void>} */
export async function initPhysics3D() {
  if (ready) return;
  await RAPIER3D.init();
  ready = true;
}

const GRAVITY = { x: 0, y: -18, z: 0 };
const DUMMY_SPEED = 6;
const DUMMY_JUMP = 9.5;
const DUMMY_SIZE = [0.6, 0.9, 0.6]; // w, h, d

/**
 * @typedef {Object} PlaySession3D
 * @property {any} world @property {any} queue
 * @property {Map<string, any>} bodiesByEntity
 * @property {Map<string, any>} kinematicByEntity
 * @property {Map<number, string>} colliderToEntity
 * @property {Map<string, any>} colliderByEntity
 * @property {any|null} dummy
 * @property {string|null} dummyEntityId
 */

/**
 * @param {{entities: Array<any>}} scene
 * @returns {PlaySession3D}
 */
export function buildWorld3D(scene) {
  if (!ready) throw new Error('[physics3d] initPhysics3D() must resolve before buildWorld3D().');
  const world = new RAPIER3D.World(GRAVITY);
  const queue = new RAPIER3D.EventQueue(true);
  const bodiesByEntity = new Map();
  const kinematicByEntity = new Map();
  const colliderToEntity = new Map();
  const colliderByEntity = new Map();
  const zones = [];

  for (const entity of scene.entities) {
    const t = entity.components.transform || { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };

    if (entity.components.logic) {
      const logic = entity.components.logic;
      zones.push({
        id: entity.id,
        kind: logic.kind,
        x: t.p[0],
        y: t.p[1] || 0,
        z: t.p[2] || 0,
        w: (logic.size ? logic.size[0] : 1) * t.s[0],
        h: (logic.size ? logic.size[1] : 1) * t.s[1],
        d: (logic.size && logic.size[2] !== undefined ? logic.size[2] : (logic.size ? logic.size[1] : 1)) * (t.s[2] !== undefined ? t.s[2] : t.s[0])
      });
      continue;
    }

    if (!entity.components.body) continue;
    registerEntityBody3D(world, entity, colliderToEntity, colliderByEntity, bodiesByEntity, kinematicByEntity);
  }

  // painted/sculpted ground is solid: one fixed body carrying a base slab,
  // per-cell boxes (blocky) or an exact surface trimesh (smooth) — same data
  // the visual mesh is built from, so what you see is what you stand on
  if (scene.terrain) {
    const col = buildTerrainCollision(scene.terrain);
    const groundBody = world.createRigidBody(RAPIER3D.RigidBodyDesc.fixed());
    for (const b of col.boxes) {
      world.createCollider(
        RAPIER3D.ColliderDesc.cuboid(b.h[0], b.h[1], b.h[2])
          .setTranslation(b.c[0], b.c[1], b.c[2]).setFriction(0.7),
        groundBody
      );
    }
    if (col.trimesh) {
      world.createCollider(
        RAPIER3D.ColliderDesc.trimesh(col.trimesh.vertices, col.trimesh.indices).setFriction(0.7),
        groundBody
      );
    }
  }

  return {
    world, queue, bodiesByEntity, kinematicByEntity, colliderToEntity, colliderByEntity,
    dummy: null, dummyEntityId: null, zones, insideZones: new Set()
  };
}

/**
 * @param {any} entity
 * @returns {[number, number, number]}
 */
function sizeOf3D(entity) {
  const t = entity.components.transform;
  const spec = entity.components.body;
  const base = (spec && spec.size) || (entity.components.model && entity.components.model.size) || [1, 1, 1];
  const sx = base[0] || 1, sy = base[1] || 1, sz = base[2] !== undefined ? base[2] : sx;
  return [
    Math.max(0.05, Math.abs(sx * t.s[0])),
    Math.max(0.05, Math.abs(sy * t.s[1])),
    Math.max(0.05, Math.abs(sz * (t.s[2] !== undefined ? t.s[2] : t.s[0])))
  ];
}

function registerEntityBody3D(world, entity, colliderToEntity, colliderByEntity, bodiesByEntity, kinematicByEntity) {
  const t = entity.components.transform;
  const spec = entity.components.body;
  const [sx, sy, sz] = sizeOf3D(entity);
  const desc = spec.type === 'dynamic'
    ? RAPIER3D.RigidBodyDesc.dynamic().setGravityScale(spec.gravityScale !== undefined ? spec.gravityScale : 1)
    : spec.type === 'kinematic'
      ? RAPIER3D.RigidBodyDesc.kinematicPositionBased()
      : RAPIER3D.RigidBodyDesc.fixed();
  const py = t.p[1] !== undefined ? t.p[1] : 0;
  const pz = t.p[2] !== undefined ? t.p[2] : 0;
  desc.setTranslation(t.p[0], py, pz);
  const body = world.createRigidBody(desc);
  const collider = world.createCollider(
    RAPIER3D.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setFriction(0.7),
    body
  );
  collider.setActiveEvents(RAPIER3D.ActiveEvents.COLLISION_EVENTS);
  colliderToEntity.set(collider.handle, entity.id);
  colliderByEntity.set(entity.id, collider);
  if (spec.type === 'dynamic') bodiesByEntity.set(entity.id, body);
  else if (spec.type === 'kinematic') kinematicByEntity.set(entity.id, body);
  return body;
}

/**
 * @param {[number, number, number]} marker  feet position (x, y, z)
 * @returns {{x: number, y: number, z: number}}
 */
function markerToCenter3D(marker) {
  return { x: marker[0], y: marker[1] + DUMMY_SIZE[1] / 2 + 0.02, z: marker[2] || 0 };
}

/**
 * @param {PlaySession3D} session
 * @param {[number, number, number]} pos  feet marker
 * @param {string} [entityId]
 */
export function spawnDummy3D(session, pos, entityId) {
  const center = markerToCenter3D(pos);
  const body = session.world.createRigidBody(
    RAPIER3D.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z)
  );
  // capsule, not box: rounded feet glide over terrain triangle seams and
  // blocky cell edges where a box's sharp corners catch and stick
  const capRadius = DUMMY_SIZE[0] / 2;
  const capHalf = Math.max(0.01, DUMMY_SIZE[1] / 2 - capRadius);
  const collider = session.world.createCollider(
    RAPIER3D.ColliderDesc.capsule(capHalf, capRadius),
    body
  );
  if (entityId) {
    collider.setActiveEvents(RAPIER3D.ActiveEvents.COLLISION_EVENTS);
    session.colliderToEntity.set(collider.handle, entityId);
    session.colliderByEntity.set(entityId, collider);
  }
  const controller = session.world.createCharacterController(0.05);
  // hills yes, walls no: climb slopes to 50°, slide off anything past 65°,
  // auto-step knee-high ledges (one blocky terrain level = 0.5), and snap
  // down to the ground so walking downhill doesn't stutter into freefall
  controller.setMaxSlopeClimbAngle(50 * Math.PI / 180);
  controller.setMinSlopeSlideAngle(65 * Math.PI / 180);
  controller.enableAutostep(0.55, 0.2, true);
  controller.enableSnapToGround(0.35);
  controller.setApplyImpulsesToDynamicBodies(true);
  session.dummy = { body, collider, controller, vy: 0, grounded: false, spawn: [...pos], respawn: [...pos], yaw: 0 };
  session.dummyEntityId = entityId || null;
}

const TURN_SPEED = 2.5; // radians/sec

/**
 * FPS-style movement: left/right TURN the player (yaw) instead of
 * strafing; up/down move forward/backward relative to the CURRENT facing
 * direction. A separate function from advancePlayerControls3D (used by
 * Collect-a-thon's world-relative strafe scheme) rather than a shared one
 * with a mode flag — the two are genuinely different control feels, and
 * every existing 3D template already depends on the strafe behavior.
 * @param {PlaySession3D} session
 * @param {{left: boolean, right: boolean, up: boolean, down: boolean, jump: boolean}} input
 * @param {number} dt
 * @returns {number} the dummy's current yaw (radians) — the caller uses this to orient the camera
 */
export function advancePlayerControlsFPS3D(session, input, dt) {
  const d = session.dummy;
  if (!d) return 0;
  if (input.left) d.yaw += TURN_SPEED * dt;
  if (input.right) d.yaw -= TURN_SPEED * dt;
  const forward = ((input.up ? 1 : 0) - (input.down ? 1 : 0)) * DUMMY_SPEED * dt;
  const dx = -Math.sin(d.yaw) * forward;
  const dz = -Math.cos(d.yaw) * forward;
  if (d.grounded && input.jump) d.vy = DUMMY_JUMP;
  d.vy += GRAVITY.y * dt;
  d.vy = Math.max(d.vy, -30);
  d.controller.computeColliderMovement(d.collider, { x: dx, y: d.vy * dt, z: dz });
  const move = d.controller.computedMovement();
  d.grounded = d.controller.computedGrounded();
  if (d.grounded && d.vy < 0) d.vy = 0;
  const p = d.body.translation();
  d.body.setNextKinematicTranslation({ x: p.x + move.x, y: p.y + move.y, z: p.z + move.z });
  return d.yaw;
}

/**
 * Drive the 3D dummy: left/right -> X, up/down -> Z (a top-down-style input
 * mapping reused for 3D free movement — forward is -Z, matching the
 * default camera facing), jump -> Y with gravity.
 * @param {PlaySession3D} session
 * @param {{left: boolean, right: boolean, up: boolean, down: boolean, jump: boolean}} input
 * @param {number} dt
 */
export function advancePlayerControls3D(session, input, dt) {
  const d = session.dummy;
  if (!d) return;
  const dx = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * DUMMY_SPEED * dt;
  const dz = ((input.down ? 1 : 0) - (input.up ? 1 : 0)) * DUMMY_SPEED * dt;
  if (d.grounded && input.jump) d.vy = DUMMY_JUMP;
  d.vy += GRAVITY.y * dt;
  d.vy = Math.max(d.vy, -30);
  d.controller.computeColliderMovement(d.collider, { x: dx, y: d.vy * dt, z: dz });
  const move = d.controller.computedMovement();
  d.grounded = d.controller.computedGrounded();
  if (d.grounded && d.vy < 0) d.vy = 0;
  const p = d.body.translation();
  d.body.setNextKinematicTranslation({ x: p.x + move.x, y: p.y + move.y, z: p.z + move.z });
}

/** @param {PlaySession3D} session */
function respawnDummy3D(session) {
  const d = session.dummy;
  d.vy = 0;
  d.grounded = false;
  const center = markerToCenter3D(d.respawn);
  d.body.setTranslation(center, true);
}

/** @param {PlaySession3D} session */
export function stepPhysics3D(session) {
  session.world.step(session.queue);
}

/**
 * @param {PlaySession3D} session
 * @param {{entities: Array<any>}} scene
 * @returns {Array<{a: string, b: string, aFrom: 'above'|'below'|'side'}>}
 */
export function drainTouchEvents3D(session, scene) {
  const touches = [];
  session.queue.drainCollisionEvents((h1, h2, started) => {
    if (!started) return;
    const a = session.colliderToEntity.get(h1);
    const b = session.colliderToEntity.get(h2);
    if (!a || !b || a === b) return;
    const posA = bodyPosition3D(session, a);
    const posB = bodyPosition3D(session, b);
    let aFrom = 'side';
    if (posA && posB) {
      const entA = scene.entities.find((e) => e.id === a);
      const halfA = entA && entA.components.body ? sizeOf3D(entA)[1] / 2 : 0.4;
      if (posA.y > posB.y + halfA * 0.5) aFrom = 'above';
      else if (posA.y < posB.y - halfA * 0.5) aFrom = 'below';
    }
    touches.push({ a, b, aFrom });
  });
  return touches;
}

/**
 * @param {PlaySession3D} session
 * @param {string} entityId
 * @param {number} x @param {number} y @param {number} z
 * @returns {boolean}
 */
export function teleportBody3D(session, entityId, x, y, z) {
  const kin = session.kinematicByEntity.get(entityId);
  if (kin) { kin.setNextKinematicTranslation({ x, y, z }); return true; }
  const dyn = session.bodiesByEntity.get(entityId);
  if (dyn) { dyn.setTranslation({ x, y, z }, true); dyn.setLinvel({ x: 0, y: 0, z: 0 }, true); return true; }
  if (session.dummy && session.dummyEntityId === entityId) {
    const center = markerToCenter3D([x, y, z]);
    session.dummy.body.setTranslation(center, true);
    session.dummy.vy = 0;
    session.dummy.grounded = false;
    return true;
  }
  return false;
}

/**
 * @param {PlaySession3D} session
 * @param {string} entityId
 * @param {number} x @param {number} y @param {number} z
 */
export function moveKinematicTo3D(session, entityId, x, y, z) {
  const body = session.kinematicByEntity.get(entityId);
  if (!body) return;
  body.setNextKinematicTranslation({ x, y, z });
}

/**
 * @param {PlaySession3D} session
 * @param {string} entityId
 * @returns {{x: number, y: number, z: number}|null}
 */
export function bodyPosition3D(session, entityId) {
  const body = session.kinematicByEntity.get(entityId) || session.bodiesByEntity.get(entityId);
  if (body) { const p = body.translation(); return { x: p.x, y: p.y, z: p.z }; }
  if (session.dummy && session.dummyEntityId === entityId) {
    const p = session.dummy.body.translation();
    return { x: p.x, y: p.y, z: p.z };
  }
  return null;
}

/**
 * @param {PlaySession3D} session
 * @returns {Array<{id: string, x: number, y: number, z: number, kind: string}>}
 */
export function readBodies3D(session) {
  const out = [];
  for (const [id, body] of session.bodiesByEntity) {
    const p = body.translation();
    out.push({ id, x: p.x, y: p.y, z: p.z, kind: 'dynamic' });
  }
  for (const [id, body] of session.kinematicByEntity) {
    const p = body.translation();
    out.push({ id, x: p.x, y: p.y, z: p.z, kind: 'kinematic' });
  }
  if (session.dummy && session.dummyEntityId) {
    const pos = bodyPosition3D(session, session.dummyEntityId);
    if (pos) out.push({ id: session.dummyEntityId, x: pos.x, y: pos.y, z: pos.z, kind: 'player' });
  }
  return out;
}

/**
 * @param {PlaySession3D} session
 * @returns {{bodies: number, colliders: number}}
 */
export function worldStats3D(session) {
  return { bodies: session.world.bodies.len(), colliders: session.world.colliders.len() };
}

/**
 * @param {PlaySession3D} session
 * @param {any} entity
 */
export function addEntityToWorld3D(session, entity) {
  if (!entity.components.body) return;
  const body = registerEntityBody3D(
    session.world, entity,
    session.colliderToEntity, session.colliderByEntity,
    session.bodiesByEntity, session.kinematicByEntity
  );
  if (entity.__spawnVelocity3D && entity.components.body.type === 'dynamic') {
    body.setLinvel(entity.__spawnVelocity3D, true);
  }
}

/**
 * @param {PlaySession3D} session
 * @param {string} entityId
 */
export function removeEntityFromWorld3D(session, entityId) {
  const collider = session.colliderByEntity.get(entityId);
  if (!collider) return;
  const body = collider.parent();
  if (body) session.world.removeRigidBody(body);
  session.bodiesByEntity.delete(entityId);
  session.kinematicByEntity.delete(entityId);
  session.colliderByEntity.delete(entityId);
  for (const [handle, id] of session.colliderToEntity) {
    if (id === entityId) session.colliderToEntity.delete(handle);
  }
}

/** @param {PlaySession3D} session */
export function destroyWorld3D(session) {
  session.queue.free();
  session.world.free();
  session.bodiesByEntity.clear();
  session.kinematicByEntity.clear();
  session.colliderToEntity.clear();
  session.colliderByEntity.clear();
  session.zones.length = 0;
  session.insideZones.clear();
  session.dummy = null;
}

/** exported for the kill-zone/respawn built-in behavior, mirroring physics.js */
export { respawnDummy3D as respawnDummy3D_internal };
