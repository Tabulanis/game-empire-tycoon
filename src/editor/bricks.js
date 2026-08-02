/**
 * @file bricks.js
 * @description Brick Workshop data/logic: loading the brick + Codex
 * catalogs, and CRUD over cartridge.bricksheets (create/rename/delete a
 * sheet; add/remove/reorder cards; edit a card's WHEN, IF list, DO list).
 * The DOM lives in panels/bricks-panel.js — mirrors the stage.js /
 * stage-panel.js split from Phase 2.
 * Ticket P3-7. Phase 3.
 */

/** @type {Array<any>|null} */
let brickCatalogCache = null;
/** @type {Array<any>|null} */
let codexCatalogCache = null;

/**
 * Load the brick catalog (cached after first call).
 * @returns {Promise<Array<any>>}
 */
export async function loadBrickCatalog() {
  if (brickCatalogCache) return brickCatalogCache;
  const res = await fetch(new URL('../data/bricks/catalog.json', import.meta.url));
  const data = await res.json();
  brickCatalogCache = data.bricks;
  return brickCatalogCache;
}

/**
 * Load the Codex catalog (cached after first call).
 * @returns {Promise<Array<any>>}
 */
export async function loadCodexCatalog() {
  if (codexCatalogCache) return codexCatalogCache;
  const res = await fetch(new URL('../data/codex/catalog.json', import.meta.url));
  const data = await res.json();
  codexCatalogCache = data.entries;
  return codexCatalogCache;
}

/**
 * @param {Array<any>} catalog
 * @param {string} id
 * @returns {any|null}
 */
export function findBrick(catalog, id) {
  return catalog.find((b) => b.id === id) || null;
}

/**
 * Build the default params object for a brick from its catalog definition.
 * @param {any} brickDef
 * @returns {any}
 */
export function defaultParams(brickDef) {
  const out = {};
  for (const p of brickDef.params) out[p.name] = p.default;
  return out;
}

/* ------------------------------------------------------------------ */
/* bricksheet CRUD                                                      */
/* ------------------------------------------------------------------ */

/**
 * @param {any} cartridge
 * @returns {string[]} every bricksheet id, sorted
 */
export function listSheets(cartridge) {
  return Object.keys(cartridge.bricksheets).sort();
}

/**
 * Create a new, empty bricksheet with a unique id derived from a name.
 * @param {any} cartridge
 * @param {string} name
 * @returns {string} the new sheet id
 */
export function createSheet(cartridge, name) {
  const slug = String(name || 'sheet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sheet';
  let id = slug, n = 2;
  while (cartridge.bricksheets[id]) { id = slug + '-' + n; n++; }
  cartridge.bricksheets[id] = [];
  return id;
}

/**
 * @param {any} cartridge
 * @param {string} id
 * @returns {boolean}
 */
export function deleteSheet(cartridge, id) {
  if (!cartridge.bricksheets[id]) return false;
  delete cartridge.bricksheets[id];
  return true;
}

/**
 * Rename a sheet, updating every entity that references it so nothing goes
 * silently unattached.
 * @param {any} cartridge
 * @param {{scenes: Array<any>}} liveCartridgeForEntities  same object, named separately for clarity at call sites
 * @param {string} oldId
 * @param {string} newName
 * @returns {string|null} the new id, or null if the name collided
 */
export function renameSheet(cartridge, oldId, newName) {
  const slug = String(newName || oldId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug || slug === oldId) return null;
  if (cartridge.bricksheets[slug]) return null; // collision — caller should warn, not overwrite
  cartridge.bricksheets[slug] = cartridge.bricksheets[oldId];
  delete cartridge.bricksheets[oldId];
  for (const scene of cartridge.scenes) {
    for (const entity of scene.entities) {
      if (entity.components.bricks && entity.components.bricks.sheet === oldId) {
        entity.components.bricks.sheet = slug;
      }
    }
  }
  return slug;
}

/* ------------------------------------------------------------------ */
/* card CRUD                                                           */
/* ------------------------------------------------------------------ */

/**
 * A blank card: no WHEN chosen yet, empty IF and DO lists.
 * @returns {any}
 */
export function createBlankCard() {
  return { when: null, if: [], do: [] };
}

/**
 * @param {any} cartridge
 * @param {string} sheetId
 * @returns {any} the new card
 */
export function addCard(cartridge, sheetId) {
  const card = createBlankCard();
  cartridge.bricksheets[sheetId].push(card);
  return card;
}

/**
 * @param {any} cartridge
 * @param {string} sheetId
 * @param {number} index
 */
export function removeCard(cartridge, sheetId, index) {
  cartridge.bricksheets[sheetId].splice(index, 1);
}

/**
 * Move a card one slot earlier or later in the sheet (the "outline" ordering
 * Article IX calls for — implemented as up/down rather than free drag for a
 * first cut; cards fire in this order when several match the same event).
 * @param {any} cartridge
 * @param {string} sheetId
 * @param {number} index
 * @param {number} direction  -1 (up) or 1 (down)
 */
export function moveCard(cartridge, sheetId, index, direction) {
  const cards = cartridge.bricksheets[sheetId];
  const target = index + direction;
  if (target < 0 || target >= cards.length) return;
  const [card] = cards.splice(index, 1);
  cards.splice(target, 0, card);
}

/**
 * Set a card's WHEN brick, resetting its params to the new brick's defaults
 * (switching WHEN types starting over with fresh params avoids leftover
 * fields from the old brick leaking into the new one).
 * @param {any} card
 * @param {any} brickDef  the WHEN brick's catalog definition
 */
export function setCardWhen(card, brickDef) {
  card.when = brickDef.id;
  const params = defaultParams(brickDef);
  for (const [key, value] of Object.entries(params)) card[key] = value;
}

/**
 * @param {any} card
 * @param {any} brickDef  an IF brick's catalog definition
 */
export function addCondition(card, brickDef) {
  card.if.push({ check: brickDef.id, ...defaultParams(brickDef) });
}

/**
 * @param {any} card
 * @param {number} index
 */
export function removeCondition(card, index) {
  card.if.splice(index, 1);
}

/**
 * @param {any} card
 * @param {any} brickDef  a DO brick's catalog definition
 */
export function addAction(card, brickDef) {
  card.do.push({ do: brickDef.id, ...defaultParams(brickDef) });
}

/**
 * @param {any} card
 * @param {number} index
 */
export function removeAction(card, index) {
  card.do.splice(index, 1);
}

/**
 * @param {any} card
 * @param {number} index
 * @param {number} direction  -1 (up) or 1 (down)
 */
export function moveAction(card, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= card.do.length) return;
  const [action] = card.do.splice(index, 1);
  card.do.splice(target, 0, action);
}
