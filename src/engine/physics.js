/**
 * @file physics.js
 * @description Rapier 2D wrapper: builds a physics world from scene entity
 * data, steps it, syncs bodies back to transforms, and drives the Stage's
 * Test Dummy via Rapier's kinematic character controller. DOM-free by design.
 * 3D bodies arrive with Phase 6 (rapier3d-compat is installed and waiting).
 * Tickets P2-7 / P2-8. Phase 2.
 *
 * API verified against @dimforge/rapier2d-compat 0.14.0:
 *   init(), World, RigidBodyDesc.fixed/dynamic/kinematicPositionBased,
 *   ColliderDesc.cuboid, EventQueue, world.debugRender(),
 *   world.createCharacterController().
 */

import RAPIER from '@dimforge/rapier2d-compat';

let ready = false;

/**
 * Initialize the Rapier WASM module (idempotent).
 * @returns {Promise<void>}
 */
export async function initPhysics() {
  if (ready) return;
  await RAPIER.init();
  ready = true;
}

/** Gravity for 2D play sessions. Data-tunable later; constant for P2. */
const GRAVITY = { x: 0, y: -18 };
const DUMMY_SPEED = 6;       // horizontal units/sec
const DUMMY_JUMP = 9.5;      // initial jump velocity
const DUMMY_SIZE = [0.6, 0.9]; // w, h

/**
 * @typedef {Object} PlaySession
 * @property {any} world
 * @property {any} queue
 * @property {Map<string, any>} bodiesByEntity  entityId -> rigid body (dynamic only)
 * @property {Map<string, any>} kinematicByEntity  entityId -> rigid body (motion-brick-driven: patrol, moving platforms)
 * @property {Map<number, string>} colliderToEntity  collider.handle -> entityId, for translating raw collision events into generic touched/bumped brick events
 * @property {any|null} dummy  {body, collider, vy, spawn:[x,y], respawn:[x,y]}
 * @property {string|null} dummyEntityId  real scene entity the dummy represents (Play mode's player), or null (Stage test-play)
 * @property {Array<any>} zones  live logic-zone descriptors for JS AABB checks
 * @property {Set<string>} insideZones  zone entity ids the dummy is currently inside
 */

/**
 * Build a 2D physics world from a scene's entity data.
 * - body components -> rigid body + cuboid collider (type static|dynamic)
 * - tilemap components -> one static cuboid per painted tile
 * - logic zones/points -> JS-side descriptors (checked by AABB during play;
 *   they are game DATA, not physics bodies — invisible in play per P2-6)
 * @param {{entities: Array<any>}} scene  a CLONE — play never mutates the cartridge
 * @returns {PlaySession}
 */
/**
 * @param {{entities: Array<any>}} scene
 * @param {{perspective?: 'side'|'top'}} [opts]  'top' zeroes gravity — a
 *   top-down game has no vertical axis to fall along
 * @returns {PlaySession}
 */
export function buildWorld(scene, opts = {}) {
  if (!ready) throw new Error('[physics] initPhysics() must resolve before buildWorld().');
  const perspective = opts.perspective || 'side';
  const world = new RAPIER.World(perspective === 'top' ? { x: 0, y: 0 } : GRAVITY);
  const queue = new RAPIER.EventQueue(true);
  const bodiesByEntity = new Map();
  const kinematicByEntity = new Map();
  /** collider.handle -> entityId, for translating collision events generically (runtime.js) */
  const colliderToEntity = new Map();
  /** entityId -> collider, forward lookup for toggling solidity (open/close doors) */
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
        y: t.p[1],
        w: (logic.size ? logic.size[0] : 1) * t.s[0],
        h: (logic.size ? logic.size[1] : 1) * t.s[1]
      });
      continue;
    }

    if (entity.components.tilemap) {
      const map = entity.components.tilemap;
      const cell = map.cell || 1;
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(t.p[0], t.p[1])
      );
      for (const key of Object.keys(map.tiles)) {
        const [cx, cy] = key.split(',').map(Number);
        const tileCollider = world.createCollider(
          RAPIER.ColliderDesc.cuboid(cell / 2, cell / 2)
            .setTranslation((cx + 0.5) * cell, (cy + 0.5) * cell),
          body
        );
        colliderToEntity.set(tileCollider.handle, entity.id);
      }
      continue;
    }

    if (entity.components.body) {
      if (Array.isArray(entity.components.tags) && entity.components.tags.includes('player')) continue; // the dummy is the player's physics
      registerEntityBody(world, entity, colliderToEntity, colliderByEntity, bodiesByEntity, kinematicByEntity);
    }
  }

  return {
    world, queue, bodiesByEntity, kinematicByEntity, colliderToEntity, colliderByEntity,
    dummy: null, dummyEntityId: null, zones, insideZones: new Set(), perspective
  };
}

/**
 * Effective collision size for a bodied entity: explicit body.size scaled by
 * the transform, falling back to the sprite size.
 * @param {any} entity
 * @returns {[number, number]}
 */
function sizeOf(entity) {
  const t = entity.components.transform;
  const spec = entity.components.body;
  const base = (spec && spec.size) || (entity.components.sprite && entity.components.sprite.size) || [1, 1];
  return [Math.max(0.05, Math.abs(base[0] * t.s[0])), Math.max(0.05, Math.abs(base[1] * t.s[1]))];
}

/** @param {number} deg @returns {number} */
function degToRad(deg) {
  return (deg || 0) * Math.PI / 180;
}

/* ------------------------------------------------------------------ */
/* the Test Dummy (P2-8)                                               */
/* ------------------------------------------------------------------ */
/* Stage tooling for test-play, NOT the Phase 3 motion system: bricks  */
/* and data-driven movement arrive with First Blood. The dummy exists  */
/* so "arranged and test-played" is honestly demonstrable in P2.       */

/**
 * Spawn/checkpoint markers mark where the dummy's FEET go (markers usually sit
 * on the floor line). Convert a marker position to a body-center position.
 * @param {[number, number]} marker
 * @returns {{x: number, y: number}}
 */
/**
 * @param {[number, number]} marker
 * @param {'side'|'top'} [perspective]
 * @returns {{x: number, y: number}}
 */
function markerToCenter(marker, perspective = 'side') {
  if (perspective === 'top') return { x: marker[0], y: marker[1] };
  return { x: marker[0], y: marker[1] + DUMMY_SIZE[1] / 2 + 0.02 };
}

/**
 * Spawn the Test Dummy / player character with its feet at a marker position.
 * When entityId is given, this body represents that real scene entity (the
 * tagged player, in a real Play session) rather than a synthetic Stage
 * test-dummy — bodyPosition/teleportBody then resolve it by entity id too.
 * @param {PlaySession} session
 * @param {[number, number]} pos
 * @param {string} [entityId]
 */
export function spawnDummy(session, pos, entityId) {
  const center = markerToCenter(pos, session.perspective);
  const body = session.world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y)
  );
  const collider = session.world.createCollider(
    RAPIER.ColliderDesc.cuboid(DUMMY_SIZE[0] / 2, DUMMY_SIZE[1] / 2),
    body
  );
  if (entityId) {
    collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    session.colliderToEntity.set(collider.handle, entityId);
  }
  const controller = session.world.createCharacterController(0.02);
  controller.enableSnapToGround(0.15);
  controller.setApplyImpulsesToDynamicBodies(true);
  controller.setCharacterMass(1.5);
  session.dummy = {
    body,
    collider,
    controller,
    vy: 0,
    grounded: false,
    spawn: [...pos],
    respawn: [...pos],
    facing: { x: 1, y: 0 } // arbitrary but sane before the first step
  };
  session.dummyEntityId = entityId || null;
}

/**
 * Advance the dummy one frame from input state.
 * @param {PlaySession} session
 * @param {{left: boolean, right: boolean, jump: boolean}} input
 * @param {number} dt
 */
function driveDummy(session, input, dt) {
  const d = session.dummy;
  if (!d) return;
  const rawX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  // remember which way you're walking — aimed shooting fires this way,
  // held from the last step you took while stationary (no vertical
  // movement axis exists in this scheme, so facing is horizontal-only)
  if (rawX) d.facing = { x: rawX, y: 0 };
  const dx = rawX * DUMMY_SPEED * dt;
  if (d.grounded && input.jump) d.vy = DUMMY_JUMP;
  d.vy += GRAVITY.y * dt;
  d.vy = Math.max(d.vy, -30);
  d.controller.computeColliderMovement(d.collider, { x: dx, y: d.vy * dt });
  const move = d.controller.computedMovement();
  d.grounded = d.controller.computedGrounded();
  if (d.grounded && d.vy < 0) d.vy = 0;
  const p = d.body.translation();
  d.body.setNextKinematicTranslation({ x: p.x + move.x, y: p.y + move.y });
}

/**
 * Teleport the dummy to its current respawn point and zero its motion.
 * Uses setTranslation (a hard teleport): setNextKinematicTranslation would be
 * overwritten by the next frame's drive before the world ever applied it.
 * Zone states reset so re-entering the same zone counts as a fresh entry.
 * @param {PlaySession} session
 */
function respawnDummy(session) {
  const d = session.dummy;
  d.vy = 0;
  d.grounded = false;
  d.body.setTranslation(markerToCenter(d.respawn, session.perspective), true);
  session.insideZones.clear();
}

/* ------------------------------------------------------------------ */
/* stepping                                                            */
/* ------------------------------------------------------------------ */

/**
 * Step the world one frame.
 * @param {PlaySession} session
 * @param {{left: boolean, right: boolean, jump: boolean}} input
 * @param {number} dt seconds
 * @param {(msg: string) => void} log  event sink (Deck log)
 * @returns {{dummyPos: [number, number]|null}}
 */
/**
 * Advance the player/dummy body from input, without the Stage-specific
 * zone/respawn logic in stepWorld. The real runtime (runtime.js) calls this,
 * then its own generic collision + zone handling, then stepPhysics.
 * @param {PlaySession} session
 * @param {{left: boolean, right: boolean, jump: boolean}} input
 * @param {number} dt
 */
/**
 * Top-down movement: free 4-directional walking, no gravity, no jump — a
 * bird's-eye game has no "down" to fall toward. Still routed through the
 * character controller so walls block movement the same way they do in
 * side-view.
 * @param {PlaySession} session
 * @param {{left: boolean, right: boolean, up: boolean, down: boolean}} input
 * @param {number} dt
 */
function driveDummyTopDown(session, input, dt) {
  const d = session.dummy;
  if (!d) return;
  const dx = ((input.right ? 1 : 0) - (input.left ? 1 : 0));
  const dy = ((input.up ? 1 : 0) - (input.down ? 1 : 0));
  const len = Math.hypot(dx, dy) || 1; // normalize diagonals to the same speed as cardinal directions
  // aimed shooting fires whichever of the 8 directions you last moved in,
  // held while standing still — a top-down player has no other "facing"
  if (dx || dy) d.facing = { x: dx / len, y: dy / len };
  const vx = (dx / len) * DUMMY_SPEED;
  const vy = (dy / len) * DUMMY_SPEED;
  d.controller.computeColliderMovement(d.collider, { x: vx * dt, y: vy * dt });
  const move = d.controller.computedMovement();
  const p = d.body.translation();
  d.body.setNextKinematicTranslation({ x: p.x + move.x, y: p.y + move.y });
}

/**
 * @param {PlaySession} session
 * @param {{left: boolean, right: boolean, jump: boolean, up?: boolean, down?: boolean}} input
 * @param {number} dt
 */
export function advancePlayerControls(session, input, dt) {
  if (session.perspective === 'top') driveDummyTopDown(session, input, dt);
  else driveDummy(session, input, dt);
}

/** Step the Rapier world only — no dummy, no zones. @param {PlaySession} session */
export function stepPhysics(session) {
  session.world.step(session.queue);
}

/**
 * Drain this frame's collision-start events, resolved to entity ids via
 * colliderToEntity, with a rough directional read (used for stomp-style
 * "bumped from above" detection). Collisions with unmapped colliders
 * (shouldn't normally happen — every collider is registered) are skipped.
 * @param {PlaySession} session
 * @param {{entities: Array<any>}} scene  for position/size lookups
 * @returns {Array<{a: string, b: string, aFrom: 'above'|'below'|'side'}>}
 */
export function drainTouchEvents(session, scene) {
  const touches = [];
  session.queue.drainCollisionEvents((h1, h2, started) => {
    if (!started) return;
    const a = session.colliderToEntity.get(h1);
    const b = session.colliderToEntity.get(h2);
    if (!a || !b || a === b) return;
    const posA = bodyPosition(session, a);
    const posB = bodyPosition(session, b);
    let aFrom = 'side';
    if (posA && posB) {
      const entA = scene.entities.find((e) => e.id === a);
      const halfA = entA && entA.components.body ? sizeOf(entA)[1] / 2 : 0.4;
      if (posA.y > posB.y + halfA * 0.5) aFrom = 'above';
      else if (posA.y < posB.y - halfA * 0.5) aFrom = 'below';
    }
    touches.push({ a, b, aFrom });
  });
  return touches;
}

/**
 * Move a kinematic body (patrol enemy, moving platform, teleport target) to
 * an exact position this frame. Motion-brick executors (motion.js) call this
 * directly — it is the one write path onto a kinematic body's transform.
 * @param {PlaySession} session
 * @param {string} entityId
 * @param {number} x
 * @param {number} y
 * @param {number} [angle] radians
 */
/**
 * Teleport whichever body an entity has (kinematic or dynamic) to an exact
 * position. Used by respawn-at-checkpoint and the teleport-to brick. Returns
 * false when the entity has no physics body at all — the caller (motion.js)
 * falls back to writing the transform component directly for visual-only
 * entities.
 * @param {PlaySession} session
 * @param {string} entityId
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function teleportBody(session, entityId, x, y) {
  const kin = session.kinematicByEntity.get(entityId);
  if (kin) { kin.setNextKinematicTranslation({ x, y }); return true; }
  const dyn = session.bodiesByEntity.get(entityId);
  if (dyn) { dyn.setTranslation({ x, y }, true); dyn.setLinvel({ x: 0, y: 0 }, true); return true; }
  if (session.dummy && session.dummyEntityId === entityId) {
    // Hard teleport, not setNextKinematicTranslation — a queued translation
    // gets silently overwritten by the next driveDummy() call before
    // world.step() applies it (the exact bug P2's respawn fix addressed).
    const center = markerToCenter([x, y], session.perspective);
    session.dummy.body.setTranslation(center, true);
    session.dummy.vy = 0;
    session.dummy.grounded = false;
    return true;
  }
  return false;
}

export function moveKinematicTo(session, entityId, x, y, angle) {
  const body = session.kinematicByEntity.get(entityId);
  if (!body) return;
  body.setNextKinematicTranslation({ x, y });
  if (angle !== undefined) body.setNextKinematicRotation(angle);
}

/**
 * Current position of a kinematic or dynamic body, or null if this entity
 * has no physics body (e.g. a pure-visual entity driving motion via
 * transform alone).
 * @param {PlaySession} session
 * @param {string} entityId
 * @returns {{x: number, y: number}|null}
 */
export function bodyPosition(session, entityId) {
  const body = session.kinematicByEntity.get(entityId) || session.bodiesByEntity.get(entityId);
  if (body) { const p = body.translation(); return { x: p.x, y: p.y }; }
  if (session.dummy && session.dummyEntityId === entityId) {
    const p = session.dummy.body.translation();
    return { x: p.x, y: p.y }; // center, consistent with every other entity type
  }
  return null;
}

/**
 * Feet position of the player/dummy (marker convention) — for spawn UI,
 * camera targets, and anything that wants "where is the player standing"
 * rather than their collider center.
 * @param {PlaySession} session
 * @returns {{x: number, y: number}|null}
 */
export function dummyFeetPosition(session) {
  if (!session.dummy) return null;
  const p = session.dummy.body.translation();
  return { x: p.x, y: p.y - DUMMY_SIZE[1] / 2 - 0.02 };
}

export function readBodies(session) {
  const out = [];
  for (const [id, body] of session.bodiesByEntity) {
    const p = body.translation();
    out.push({ id, x: p.x, y: p.y, angle: body.rotation(), kind: 'dynamic' });
  }
  for (const [id, body] of session.kinematicByEntity) {
    const p = body.translation();
    out.push({ id, x: p.x, y: p.y, angle: body.rotation(), kind: 'kinematic' });
  }
  if (session.dummy && session.dummyEntityId) {
    const pos = bodyPosition(session, session.dummyEntityId);
    if (pos) out.push({ id: session.dummyEntityId, x: pos.x, y: pos.y, angle: 0, kind: 'player' });
  }
  return out;
}

/**
 * Rapier's built-in debug geometry, ready for a THREE.LineSegments buffer.
 * @param {PlaySession} session
 * @returns {{vertices: Float32Array, colors: Float32Array}}
 */
export function debugLines(session) {
  const dbg = session.world.debugRender();
  return { vertices: dbg.vertices, colors: dbg.colors };
}

/**
 * Live collider/body counts for the Debug Deck.
 * @param {PlaySession} session
 * @returns {{bodies: number, colliders: number}}
 */
export function worldStats(session) {
  return { bodies: session.world.bodies.len(), colliders: session.world.colliders.len() };
}

/**
 * Tear a session down completely.
 * @param {PlaySession} session
 */
/**
 * Toggle whether an entity's collider participates in physics at all — an
 * open door lets the player walk straight through; a closed one blocks
 * them. Visual open/close (show-hide) is a separate, independent choice.
 * @param {PlaySession} session
 * @param {string} entityId
 * @param {boolean} enabled
 * @returns {boolean} true if the entity had a collider to toggle
 */
export function setEntityColliderEnabled(session, entityId, enabled) {
  const collider = session.colliderByEntity.get(entityId);
  if (!collider) return false;
  collider.setEnabled(enabled);
  return true;
}

/**
 * Create the Rapier body+collider for one entity's 'body' component and
 * register it in every relevant map. Shared by buildWorld (initial scene)
 * and addEntityToWorld (anything spawned mid-game — shoot, spawn-prefab).
 * @param {any} world
 * @param {any} entity
 * @param {Map<number, string>} colliderToEntity
 * @param {Map<string, any>} colliderByEntity
 * @param {Map<string, any>} bodiesByEntity
 * @param {Map<string, any>} kinematicByEntity
 */
function registerEntityBody(world, entity, colliderToEntity, colliderByEntity, bodiesByEntity, kinematicByEntity) {
  const t = entity.components.transform;
  const spec = entity.components.body;
  const size = sizeOf(entity);
  const desc = spec.type === 'dynamic'
    ? RAPIER.RigidBodyDesc.dynamic().setGravityScale(spec.gravityScale !== undefined ? spec.gravityScale : 1)
    : spec.type === 'kinematic'
      ? RAPIER.RigidBodyDesc.kinematicPositionBased()
      : RAPIER.RigidBodyDesc.fixed();
  desc.setTranslation(t.p[0], t.p[1]).setRotation(degToRad(t.r[2]));
  const body = world.createRigidBody(desc);
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2).setFriction(0.7),
    body
  );
  collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  colliderToEntity.set(collider.handle, entity.id);
  colliderByEntity.set(entity.id, collider);
  if (spec.type === 'dynamic') {
    bodiesByEntity.set(entity.id, body);
  } else if (spec.type === 'kinematic') {
    kinematicByEntity.set(entity.id, body);
  }
  return body;
}

/**
 * Give a newly-spawned entity (added to scene.entities AFTER buildWorld
 * already ran — e.g. via the shoot or spawn-prefab bricks) a real physics
 * body, exactly as if it had been there from the start. Without this, a
 * spawned entity is visually present but physically inert: no collisions,
 * no velocity, nothing. If the entity carries a `__spawnVelocity` (the
 * shoot brick sets this), that initial velocity is applied immediately.
 * @param {PlaySession} session
 * @param {any} entity
 */
export function addEntityToWorld(session, entity) {
  if (!entity.components.body) return;
  const body = registerEntityBody(
    session.world, entity,
    session.colliderToEntity, session.colliderByEntity,
    session.bodiesByEntity, session.kinematicByEntity
  );
  if (entity.__spawnVelocity && entity.components.body.type === 'dynamic') {
    body.setLinvel(entity.__spawnVelocity, true);
  }
}

/**
 * Remove an entity's physics body (and its collider) from the world
 * entirely — the counterpart to entities.removeEntity, which only removes
 * the DATA-level entity. Without this, a destroyed entity's Rapier body
 * keeps existing and keeps simulating: it can still collide with things,
 * it's just invisible and has no entity data anymore. Worse, a newly
 * spawned entity can reuse the same id (uniqueId only checks current
 * scene.entities) while the orphaned old body is still flying around
 * mapped to that same id in colliderToEntity — silently corrupting later
 * lookups. Always call this alongside entities.removeEntity, never instead.
 * @param {PlaySession} session
 * @param {string} entityId
 */
export function removeEntityFromWorld(session, entityId) {
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

export function destroyWorld(session) {
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
