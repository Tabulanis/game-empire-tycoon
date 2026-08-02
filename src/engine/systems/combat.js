/**
 * @file combat.js
 * @description Damage, health, knockback, invincibility, projectiles, and
 * checkpoint respawn. Owns the `health` component's lifecycle — the only
 * system allowed to mutate `components.health` outside the Stage inspector.
 * Ticket P3-3. Phase 3.
 */

import { bodyPosition, teleportBody, moveKinematicTo } from '../physics.js';
import { createEntity, addEntity, removeEntity } from '../entities.js';

/**
 * @typedef {Object} CombatState
 * @property {Map<string, number>} invincibleUntil  entityId -> seconds remaining
 * @property {Map<string, {vx: number, vy: number, remaining: number}>} knockback  entityId -> decaying nudge (used for kinematic/player bodies a rapier impulse can't reach)
 */

/** @returns {CombatState} */
export function createCombatState() {
  return { invincibleUntil: new Map(), knockback: new Map() };
}

/**
 * Advance timers (invincibility countdown, knockback decay + application).
 * Call once per frame before evaluating bricksheets.
 * @param {CombatState} state
 * @param {any} session  physics PlaySession — knockback nudges kinematic/player bodies directly
 * @param {number} dt
 */
export function tickCombat(state, session, dt) {
  for (const [id, remaining] of state.invincibleUntil) {
    const next = remaining - dt;
    if (next <= 0) state.invincibleUntil.delete(id); else state.invincibleUntil.set(id, next);
  }
  for (const [id, kb] of state.knockback) {
    const pos = bodyPosition(session, id);
    if (pos) moveKinematicTo(session, id, pos.x + kb.vx * dt, pos.y + kb.vy * dt);
    kb.remaining -= dt;
    kb.vx *= 0.85; kb.vy *= 0.85; // simple exponential decay, tuned for a snappy platformer stomp/hit-back
    if (kb.remaining <= 0) state.knockback.delete(id);
  }
}

/** @param {string} entityId @param {CombatState} state @returns {boolean} */
export function isInvincible(entityId, state) {
  return state.invincibleUntil.has(entityId);
}

/**
 * Apply damage to an entity's health component, clamping at 0 and emitting
 * 'healthZero' the frame it crosses from alive to dead. No-op if the entity
 * is currently invincible or has no health component.
 * @param {any} entity
 * @param {number} amount
 * @param {CombatState} state
 * @param {{emit: Function}} bus
 */
export function applyDamage(entity, amount, state, bus) {
  const health = entity.components.health;
  if (!health || isInvincible(entity.id, state)) return;
  const was = health.current;
  health.current = Math.max(0, health.current - amount);
  if (was > 0 && health.current <= 0) {
    bus.emit('healthZero', { entity: entity.id });
  }
}

/* ------------------------------------------------------------------ */
/* DO — combat & health                                                 */
/* ------------------------------------------------------------------ */

/** @param {any} entity @param {any} params {amount} @param {CombatState} state @param {{emit: Function}} bus */
export function doDealDamage(entity, params, state, bus) {
  applyDamage(entity, params.amount || 1, state, bus);
}

/** @param {any} entity @param {any} params {amount} */
export function doHeal(entity, params) {
  const health = entity.components.health;
  if (!health) return;
  health.current = Math.min(health.max, health.current + (params.amount || 1));
}

/**
 * @param {any} entity @param {any} params {vx, vy}
 * @param {CombatState} state
 * @param {any} session  applies an immediate rapier impulse for dynamic bodies
 */
export function doKnockback(entity, params, state, session) {
  const vx = params.vx || 0, vy = params.vy || 4;
  const dyn = session.bodiesByEntity.get(entity.id);
  if (dyn) {
    dyn.applyImpulse({ x: vx, y: vy }, true);
  } else {
    // kinematic / player bodies aren't force-driven — nudge them directly
    // over the next few frames instead (see tickCombat).
    state.knockback.set(entity.id, { vx, vy, remaining: params.duration || 0.25 });
  }
}

/** @param {any} entity @param {any} params {seconds} @param {CombatState} state */
export function doInvincible(entity, params, state) {
  state.invincibleUntil.set(entity.id, params.seconds || 1);
}

/**
 * DO shoot: spawn a small dynamic projectile entity travelling in the
 * shooter's facing direction. Returns the new entity so the caller (runtime)
 * can add it to the render view — this system never touches THREE directly.
 * @param {any} entity  the shooter
 * @param {any} params  {speed, damage}
 * @param {{entities: Array<any>}} scene
 * @returns {any} the projectile entity (already added to scene.entities)
 */
/**
 * DO shoot: spawn a small dynamic projectile entity travelling in the
 * shooter's facing direction. Returns the new entity so the caller (runtime)
 * can add it to the render view AND give it a real physics body — this
 * system never touches THREE or Rapier directly.
 * @param {any} entity  the shooter
 * @param {any} params  {speed, sheet?} — sheet is the bricksheet the
 *   projectile itself gets attached to (e.g. "destroy self on any touch");
 *   templates define this, since different projectiles want different
 *   behavior (explode on contact, pierce through, etc).
 * @param {{entities: Array<any>}} scene
 * @param {[number, number, number]} [direction3D]  explicit 3D firing
 *   direction (unit-length not required) — used by 3D-FPS mode, which has
 *   a real yaw to aim with. Omitted for 2D, where facing comes from the
 *   entity's own transform.s[0] sign instead.
 * @returns {any} the projectile entity (already added to scene.entities)
 */
export function doShoot(entity, params, scene, direction3D) {
  const t = entity.components.transform;
  const speed = params.speed || 8;
  let velocity, spawnOffset;
  if (direction3D) {
    const len = Math.hypot(direction3D[0], direction3D[1], direction3D[2]) || 1;
    const nd = [direction3D[0] / len, direction3D[1] / len, direction3D[2] / len];
    velocity = { x: nd[0] * speed, y: nd[1] * speed, z: nd[2] * speed };
    spawnOffset = [t.p[0] + nd[0] * 0.9, (t.p[1] || 0) + nd[1] * 0.9, (t.p[2] || 0) + nd[2] * 0.9];
  } else {
    const facing = t.s[0] < 0 ? -1 : 1;
    velocity = { x: facing * speed, y: 0 };
    spawnOffset = [t.p[0] + facing * 0.9, t.p[1], t.p[2]];
  }
  const projectile = createEntity({
    name: 'Projectile',
    components: {
      transform: { p: spawnOffset, r: [0, 0, 0], s: [1, 1, 1] },
      sprite: { swatch: '#ff6b8b', size: [0.25, 0.25] },
      model: { shape: 'sphere', swatch: '#ff6b8b', size: [0.25, 0.25, 0.25] },
      body: { type: 'dynamic', shape: 'box', size: [0.25, 0.25, 0.25], gravityScale: 0 },
      tags: ['projectile'],
      ...(params.sheet ? { bricks: { sheet: params.sheet } } : {})
    }
  });
  if (direction3D) projectile.__spawnVelocity3D = velocity;
  else projectile.__spawnVelocity = velocity; // consumed once by physics.addEntityToWorld
  addEntity(scene, projectile);
  return projectile;
}

/**
 * DO explode: area damage against every entity with health inside a radius.
 * @param {any} entity  the origin
 * @param {any} params  {radius, damage}
 * @param {{entities: Array<any>}} scene
 * @param {CombatState} state
 * @param {{emit: Function}} bus
 */
export function doExplode(entity, params, scene, state, bus) {
  const origin = entity.components.transform.p;
  const radius = params.radius || 2;
  for (const other of scene.entities) {
    if (other.id === entity.id || !other.components.health) continue;
    const p = other.components.transform.p;
    const dist = Math.hypot(p[0] - origin[0], p[1] - origin[1]);
    if (dist <= radius) applyDamage(other, params.damage || 2, state, bus);
  }
}

/**
 * DO defeat-self: remove the entity from play. Emits 'enemyDefeated' when
 * the entity is tagged 'enemy' (the WHEN "enemy defeated" card listens for
 * exactly this).
 * @param {any} entity
 * @param {{entities: Array<any>}} scene
 * @param {{emit: Function}} bus
 * @returns {boolean} true if removed
 */
export function doDefeatSelf(entity, scene, bus) {
  const isEnemy = Array.isArray(entity.components.tags) && entity.components.tags.includes('enemy');
  const removed = removeEntity(scene, entity.id);
  if (removed && isEnemy) bus.emit('enemyDefeated', { entity: entity.id });
  return removed;
}

/**
 * DO respawn-at-checkpoint: teleport back to the save vault's checkpoint, or
 * the scene's original spawn point if none has been set yet, and restore
 * full health.
 * @param {any} entity
 * @param {any} session
 * @param {any} saveState  {checkpoint: [x,y]|null, ...}
 * @param {[number, number]} spawnFallback
 */
export function doRespawnAtCheckpoint(entity, session, saveState, spawnFallback) {
  const target = saveState.checkpoint || spawnFallback;
  teleportBody(session, entity.id, target[0], target[1]);
  if (entity.components.health) entity.components.health.current = entity.components.health.max;
}
