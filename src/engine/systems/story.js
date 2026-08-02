/**
 * @file story.js
 * @description Dialogue cards, choice cards, and story flags. Story cards
 * are cartridge data (cartridge.story.cards); this module owns only the
 * LIVE state of which card is active during a Play session, and the
 * DO/IF/WHEN surface bricksheets use to drive it.
 * Ticket P4-1. Phase 4.
 */

/**
 * @typedef {Object} StoryCard
 * @property {string} id
 * @property {string} [speaker]
 * @property {string} text
 * @property {string|null} [next]  next card id, or null to end the sequence
 * @property {Array<{label: string, next: string|null}>} [choices]  when present, this is a choice card
 */

/**
 * @typedef {Object} StoryState
 * @property {string|null} activeCardId
 */

/** @returns {StoryState} */
export function createStoryState() {
  return { activeCardId: null };
}

/**
 * @param {any} cartridge
 * @param {string} cardId
 * @returns {StoryCard|null}
 */
export function findCard(cartridge, cardId) {
  return (cartridge.story.cards || []).find((c) => c.id === cardId) || null;
}

/* ------------------------------------------------------------------ */
/* DO — story                                                          */
/* ------------------------------------------------------------------ */

/**
 * DO say / DO show-choice-card: both just activate a card by id — whether
 * it plays as plain dialogue or shows choice buttons is decided by the
 * CARD's own data (does it have `choices`?), not by which brick revealed
 * it. Refuses to interrupt a card already showing (no overlapping dialogue).
 * @param {StoryState} storyState
 * @param {any} params  {card: string}
 * @param {any} cartridge
 * @param {{emit: Function}} bus
 */
export function doSay(storyState, params, cartridge, bus) {
  if (storyState.activeCardId) return; // one card at a time
  const card = findCard(cartridge, params.card);
  if (!card) return;
  storyState.activeCardId = card.id;
  bus.emit('storyCardReached', { entity: '*', card: card.id });
}

/** Same mechanic as doSay — see its doc. */
export const doShowChoiceCard = doSay;

/**
 * Advance past the current (non-choice) card to its `next`, or close the
 * sequence if there is none. No-op on a choice card — the caller must
 * pick one (see chooseCard).
 * @param {StoryState} storyState
 * @param {any} cartridge
 * @param {{emit: Function}} bus
 */
export function advanceCard(storyState, cartridge, bus) {
  const card = storyState.activeCardId ? findCard(cartridge, storyState.activeCardId) : null;
  if (!card || card.choices) return;
  storyState.activeCardId = card.next || null;
  if (storyState.activeCardId) {
    bus.emit('storyCardReached', { entity: '*', card: storyState.activeCardId });
  }
}

/**
 * Pick a choice on the current choice card, jumping to that choice's `next`.
 * @param {StoryState} storyState
 * @param {number} index
 * @param {any} cartridge
 * @param {{emit: Function}} bus
 */
export function chooseCard(storyState, index, cartridge, bus) {
  const card = storyState.activeCardId ? findCard(cartridge, storyState.activeCardId) : null;
  if (!card || !card.choices || !card.choices[index]) return;
  storyState.activeCardId = card.choices[index].next || null;
  if (storyState.activeCardId) {
    bus.emit('storyCardReached', { entity: '*', card: storyState.activeCardId });
  }
}

/**
 * @param {StoryState} storyState
 * @returns {{speaker: string, text: string, choices: Array<string>|null}|null}
 *   a UI-ready snapshot of the active card, or null when nothing is showing
 */
export function currentCardView(storyState, cartridge) {
  if (!storyState.activeCardId) return null;
  const card = findCard(cartridge, storyState.activeCardId);
  if (!card) return null;
  return {
    speaker: card.speaker || '',
    text: card.text,
    choices: card.choices ? card.choices.map((c) => c.label) : null
  };
}

/**
 * @param {any} saveState
 * @param {any} params  {flag: string, value?: boolean}
 */
export function doSetStoryFlag(saveState, params) {
  if (!saveState.flags) saveState.flags = {};
  saveState.flags[params.flag] = params.value !== false;
}
