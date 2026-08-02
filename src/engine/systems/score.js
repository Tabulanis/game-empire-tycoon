/**
 * @file score.js
 * @description Counters, points, inventory, and win/lose conditions — the
 * save vault's live state during a Play session. Dialogue, choice cards, and
 * story flags are Phase 4 (story.js); this module only owns the
 * score/inventory half of Article VII's "DO — story & score" category.
 * Ticket P3-4. Phase 3.
 */

/**
 * @typedef {Object} SaveState
 * @property {Record<string, number>} counters   named counters (coins, etc.) — Determinism Law: the only mutable "variables" bricks may touch
 * @property {Record<string, number>} inventory   item id -> count
 * @property {Record<string, boolean>} flags   named story flags (Phase 4)
 * @property {[number, number]|null} checkpoint   last checkpoint marker position
 * @property {{result: 'win'|'lose', message?: string}|null} ended
 */

/**
 * Build the live save state for a fresh Play session, seeded from the
 * cartridge's saveSchema template (Constitution Article VI). Play sessions
 * never write this back into the edit cartridge — same non-mutation rule the
 * Stage's test-play already follows.
 * @param {any} saveSchema  cartridge.saveSchema, e.g. {coins: 0, checkpoint: null}
 * @returns {SaveState}
 */
export function createSaveState(saveSchema) {
  const counters = {};
  for (const [key, value] of Object.entries(saveSchema || {})) {
    if (typeof value === 'number') counters[key] = value;
  }
  return { counters, inventory: {}, flags: {}, checkpoint: null, ended: null };
}

/* ------------------------------------------------------------------ */
/* DO — score & inventory                                               */
/* ------------------------------------------------------------------ */

/**
 * @param {SaveState} saveState
 * @param {any} params  {key, amount}
 * @param {{emit: Function}} bus
 */
export function doAwardPoints(saveState, params, bus) {
  const key = params.key || 'score';
  saveState.counters[key] = (saveState.counters[key] || 0) + (params.amount || 1);
  bus.emit('counterChanged', { entity: '*', key, value: saveState.counters[key] });
}

/**
 * @param {SaveState} saveState
 * @param {any} params  {key, value}
 * @param {{emit: Function}} bus
 */
export function doSetCounter(saveState, params, bus) {
  const key = params.key || 'score';
  saveState.counters[key] = params.value || 0;
  bus.emit('counterChanged', { entity: '*', key, value: saveState.counters[key] });
}

/**
 * @param {SaveState} saveState
 * @param {any} params  {item, amount}
 * @param {{emit: Function}} bus
 */
export function doGiveItem(saveState, params, bus) {
  const item = params.item;
  saveState.inventory[item] = (saveState.inventory[item] || 0) + (params.amount || 1);
  bus.emit('itemCollected', { entity: '*', item });
}

/**
 * @param {SaveState} saveState
 * @param {any} params  {item, amount}
 */
export function doTakeItem(saveState, params) {
  const item = params.item;
  saveState.inventory[item] = Math.max(0, (saveState.inventory[item] || 0) - (params.amount || 1));
}

/**
 * @param {SaveState} saveState
 * @param {any} params  {result: 'win'|'lose', message?}
 */
export function doEndGame(saveState, params) {
  if (saveState.ended) return; // first ending wins — no double-firing win then lose in the same frame
  saveState.ended = { result: params.result === 'lose' ? 'lose' : 'win', message: params.message || '' };
}

/**
 * DO set-checkpoint: called both by the checkpoint logic-zone's built-in
 * behavior and directly as a brick. Position is a marker (feet), matching
 * every other spawn-style position in the cartridge.
 * @param {SaveState} saveState
 * @param {[number, number]} position
 */
export function doSetCheckpoint(saveState, position) {
  saveState.checkpoint = [...position];
}
