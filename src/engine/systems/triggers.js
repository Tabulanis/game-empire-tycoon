/**
 * @file triggers.js
 * @description Zones, timers, messages, and the WHEN/IF half of the brick
 * grammar (Constitution Article VII). This module is deliberately DOM-free
 * and physics-free — it operates on plain data (events, entity snapshots,
 * save-vault state) so the interpreter is exactly as testable as physics.js
 * was in Phase 2.
 *
 * Convention: every event carries `entity` — the id of the entity the event
 * is ABOUT (the door that was touched, the zone that was entered). A card
 * attached to that entity's bricksheet asks "did this happen to ME?" — no
 * name-matching required. Global events (game start, messages) use
 * `entity: '*'`, matching every bricksheet.
 * Ticket P3-1. Phase 3.
 */

/**
 * @typedef {Object} BrickEvent
 * @property {string} type
 * @property {string} entity  '*' for global events
 * @property {any} [rest]
 */

/**
 * A tiny per-frame event queue. runtime.js drains it once per tick; every
 * system (motion, combat, score, physics collision translation) emits onto
 * the same bus so bricksheets never need to know which system raised what.
 * @returns {{emit: Function, drain: () => BrickEvent[]}}
 */
export function createEventBus() {
  /** @type {BrickEvent[]} */
  let queue = [];
  return {
    /**
     * @param {string} type
     * @param {Partial<BrickEvent>} [fields]
     */
    emit(type, fields = {}) {
      queue.push({ type, entity: '*', ...fields });
    },
    /** @returns {BrickEvent[]} this frame's events, then clears the queue */
    drain() {
      const out = queue;
      queue = [];
      return out;
    }
  };
}

/* ------------------------------------------------------------------ */
/* repeating timers (backs the "every N seconds" WHEN)                  */
/* ------------------------------------------------------------------ */

/**
 * @returns {{tick: Function, reset: Function}}
 */
export function createTimerManager() {
  /** @type {Map<string, {remaining: number, seconds: number}>} */
  const timers = new Map();

  /**
   * Advance every registered timer, emitting 'timerElapsed' on expiry and
   * auto-registering any new (key, seconds) pair the first time it's seen —
   * so a card never needs a separate "start timer" brick.
   * @param {Array<{key: string, seconds: number}>} declarations  this frame's every-N-seconds cards
   * @param {number} dt
   * @param {{emit: Function}} bus
   */
  function tick(declarations, dt, bus) {
    for (const { key, seconds } of declarations) {
      if (!timers.has(key)) timers.set(key, { remaining: seconds, seconds });
    }
    for (const [key, t] of timers) {
      t.remaining -= dt;
      if (t.remaining <= 0) {
        bus.emit('timerElapsed', { entity: '*', key });
        t.remaining += t.seconds;
      }
    }
  }

  function reset() {
    timers.clear();
  }

  return { tick, reset };
}

/* ------------------------------------------------------------------ */
/* zone membership (generalizes P2's Stage-only checkZones)             */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} AabbEntity
 * @property {string} id
 * @property {number} x @property {number} y
 * @property {number} w @property {number} h
 */

/**
 * Diff every tracked entity's zone membership against this frame's AABB
 * overlaps, emitting zoneEnter/zoneLeave per (entity, zone) pair. Mutates
 * `membership` in place so callers keep state across frames.
 * @param {AabbEntity[]} entities
 * @param {AabbEntity[]} zones
 * @param {Map<string, Set<string>>} membership  entityId -> Set<zoneId>
 * @param {{emit: Function}} bus
 */
/**
 * Check the player's position against every zone, emitting zoneEnter/
 * zoneLeave once per crossing. Only the player is tracked here — the brick
 * catalog only has "player enters/leaves zone" (no generic "entity enters
 * zone"), so zone membership is deliberately player-only, not general
 * entity-vs-entity overlap. The event's `entity` is the ZONE's id (not the
 * player's) so the zone's own bricksheet card — which lives on the zone
 * entity and asks "did the player just enter ME?" — matches it via the
 * same owner-centric convention every other WHEN uses.
 * @param {AabbEntity} player
 * @param {AabbEntity[]} zones
 * @param {Set<string>} membership  zone ids the player is currently inside
 * @param {{emit: Function}} bus
 */
export function updateZoneMembership(player, zones, membership, bus) {
  const seen = new Set();
  for (const zone of zones) {
    const inside =
      Math.abs(player.x - zone.x) <= (zone.w + player.w) / 2 &&
      Math.abs(player.y - zone.y) <= (zone.h + player.h) / 2 &&
      (player.z === undefined || zone.z === undefined || Math.abs(player.z - zone.z) <= ((zone.d || zone.h) + (player.d || player.h)) / 2);
    if (!inside) continue;
    seen.add(zone.id);
    if (!membership.has(zone.id)) {
      membership.add(zone.id);
      bus.emit('zoneEnter', { entity: zone.id, zoneKind: zone.kind });
    }
  }
  for (const id of [...membership]) {
    if (!seen.has(id)) {
      membership.delete(id);
      bus.emit('zoneLeave', { entity: id });
    }
  }
}

/**
 * AABB touch detection between one reference entity (the player) and every
 * other trackable entity. Rapier's collision-event queue only fires for
 * pairs involving at least one DYNAMIC body — verified empirically: a
 * kinematic player against a static coin or a kinematic patrol enemy never
 * generates a collision-start event, even with active events on both
 * colliders. Since the player is kinematic (character-controller-driven) and
 * most touchable things (coins, spikes, patrol enemies) are static or
 * kinematic, this AABB check is the reliable path for "touched" — the
 * physics event queue (drainTouchEvents in physics.js) stays reserved for
 * genuinely dynamic-body physics (pushable crates, projectile impacts).
 * @param {AabbEntity} player
 * @param {Array<AabbEntity & {tag?: string}>} others
 * @param {Set<string>} membership  ids the player is currently touching
 * @param {{emit: Function}} bus
 */
/**
 * Small tolerance added to touch AABB checks. Rapier's character controller
 * deliberately keeps a hair's-width gap (contact skin) between the player
 * and whatever it's resting on, to avoid interpenetration jitter — an
 * exact-boundary overlap check misses that as "not touching" even when the
 * player is standing squarely on top of something. Verified empirically:
 * the resting gap is ~0.02 units; 0.1 gives comfortable margin.
 */
const TOUCH_MARGIN = 0.1;

export function updateTouchMembership(player, others, membership, bus) {
  const seen = new Set();
  for (const other of others) {
    const inside =
      Math.abs(player.x - other.x) <= (other.w + player.w) / 2 + TOUCH_MARGIN &&
      Math.abs(player.y - other.y) <= (other.h + player.h) / 2 + TOUCH_MARGIN &&
      (player.z === undefined || other.z === undefined || Math.abs(player.z - other.z) <= ((other.d || other.h) + (player.d || player.h)) / 2 + TOUCH_MARGIN);
    if (!inside) continue;
    seen.add(other.id);
    if (!membership.has(other.id)) {
      membership.add(other.id);
      const from = player.y > other.y + other.h * 0.25
        ? 'above'
        : player.y < other.y - other.h * 0.25 ? 'below' : 'side';
      bus.emit('touched', { entity: other.id, byTag: 'player' });
      bus.emit('bumped', { entity: other.id, from });
    }
  }
  for (const id of [...membership]) {
    if (!seen.has(id)) membership.delete(id);
  }
}

/* ------------------------------------------------------------------ */
/* WHEN matching                                                        */
/* ------------------------------------------------------------------ */

/**
 * Does this event satisfy this card's WHEN clause, for the entity that owns
 * the card (ownerId)? cardKey is only needed for 'every-n-seconds' (it's
 * how a repeating timer is told apart from every other card).
 * @param {any} card  {when, by?, from?, action?, seconds?, ...}
 * @param {BrickEvent} event
 * @param {string} ownerId
 * @param {string} [cardKey]
 * @returns {boolean}
 */
export function matchWhen(card, event, ownerId, cardKey) {
  if (event.entity !== '*' && event.entity !== ownerId) return false;
  switch (card.when) {
    case 'game-start': return event.type === 'gameStart';
    case 'scene-start': return event.type === 'sceneStart';
    case 'spawned': return event.type === 'spawned';
    case 'key-pressed': return event.type === 'keyPressed' && event.action === card.action;
    case 'touched': return event.type === 'touched' && (!card.by || event.byTag === card.by);
    case 'bumped': return event.type === 'bumped' && (!card.from || event.from === card.from);
    case 'health-zero': return event.type === 'healthZero';
    case 'counter-reached':
      return event.type === 'counterChanged' && event.key === card.key &&
        compare(event.value, card.op || '>=', card.value);
    case 'item-collected': return event.type === 'itemCollected' && (!card.item || event.item === card.item);
    case 'enemy-defeated': return event.type === 'enemyDefeated' && (!card.tag || event.tag === card.tag);
    case 'every-n-seconds': return event.type === 'timerElapsed' && event.key === cardKey;
    case 'player-enters-zone': return event.type === 'zoneEnter';
    case 'player-leaves-zone': return event.type === 'zoneLeave';
    case 'message-received': return event.type === 'message' && event.name === card.message;
    case 'story-card-reached': return event.type === 'storyCardReached' && (!card.card || event.card === card.card);
    default: return false;
  }
}

/**
 * A stable per-card key for the timer manager (and anything else that needs
 * to tell one card instance apart from another). Not stored in the card's
 * own JSON — computed fresh each session so persisted data stays plain.
 * @param {string} entityId @param {string} sheetId @param {number} index
 * @returns {string}
 */
export function cardKey(entityId, sheetId, index) {
  return entityId + ':' + sheetId + ':' + index;
}

/* ------------------------------------------------------------------ */
/* IF evaluation                                                        */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} IfContext
 * @property {any} entity  the bricksheet-owning entity
 * @property {any} saveState  {counters, inventory, checkpoint, ended}
 * @property {Set<string>} zoneMembership  zone ids the PLAYER is currently inside (zone tracking is player-only — see updateZoneMembership)
 * @property {() => number} rng  seeded [0,1) — chance bricks MUST use this, never Math.random
 */

/**
 * All conditions on a card must pass (implicit AND — Constitution Article
 * VII's grammar has no OR/expressions, only named counters).
 * @param {Array<any>} conditions  card.if — may be undefined
 * @param {IfContext} ctx
 * @returns {boolean}
 */
export function evaluateIf(conditions, ctx) {
  if (!conditions || !conditions.length) return true;
  return conditions.every((cond) => evaluateOne(cond, ctx));
}

/**
 * @param {any} cond
 * @param {IfContext} ctx
 * @returns {boolean}
 */
function evaluateOne(cond, ctx) {
  switch (cond.check) {
    case 'has-item':
      return !!(ctx.saveState.inventory[cond.item] > 0) === (cond.value !== false);
    case 'counter-compare':
      return compare(ctx.saveState.counters[cond.key] || 0, cond.op, cond.value);
    case 'chance':
      return ctx.rng() < (cond.percent || 0) / 100;
    case 'facing':
      return cond.dir === 'left'
        ? ctx.entity.components.transform.s[0] < 0
        : ctx.entity.components.transform.s[0] >= 0;
    case 'in-zone':
      return ctx.zoneMembership.size > 0;
    case 'health-compare': {
      const health = ctx.entity.components.health;
      return compare(health ? health.current : 0, cond.op, cond.value);
    }
    case 'story-flag-set':
      return !!(ctx.saveState.flags && ctx.saveState.flags[cond.flag]) === (cond.value !== false);
    default:
      return true; // unknown condition never blocks — fail open, not silently locked out
  }
}

/**
 * @param {number} value @param {'>='|'<='|'='} op @param {number} target
 * @returns {boolean}
 */
function compare(value, op, target) {
  if (op === '>=') return value >= target;
  if (op === '<=') return value <= target;
  return value === target;
}
