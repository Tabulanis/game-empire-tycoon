/**
 * @file schema.js
 * @description Cartridge schema: creation, validation, migration.
 * Authority: Constitution Article VI. This file is the ONLY place that decides
 * what a valid cartridge looks like. Everything else asks this module.
 * Phase 0.
 */

/** Current cartridge format version. */
export const GET_FORMAT = 1;

/**
 * @typedef {Object} Cartridge
 * @property {number} get
 * @property {Object} meta
 * @property {Object} settings
 * @property {Object} assets
 * @property {Array}  scenes
 * @property {Object} bricksheets
 * @property {Object} story
 * @property {Object} saveSchema
 */

/**
 * Create a blank cartridge exactly matching Article VI.
 * @param {string} [title]
 * @param {string} [author]
 * @returns {Cartridge}
 */
export function createCartridge(title = 'Untitled Game', author = '') {
  return {
    get: GET_FORMAT,
    meta: {
      title,
      author,
      created: new Date().toISOString(),
      era: 'garage',
      template: null
    },
    settings: {
      mode: '2d',
      perspective: 'side',
      controlScheme: 'strafe',
      palette: 'default',
      channels: [],
      tone: 'none',
      input: { jump: ['Space', 'GamepadA', 'TouchA'] }
    },
    assets: { sprites: [], models: [], songs: [], sfx: [], anims: [], effects: [], materials: [] },
    scenes: [],
    prefabs: {},
    bricksheets: {},
    story: { cards: [] },
    saveSchema: {}
  };
}

const OBJECT_KEYS = ['meta', 'settings', 'assets', 'prefabs', 'bricksheets', 'story', 'saveSchema'];
const ARRAY_KEYS = ['scenes'];

/**
 * Validate a parsed object as a cartridge. Non-destructive: returns a repaired
 * copy when fields are merely missing, and errors only for real violations.
 * @param {unknown} raw
 * @returns {{ok: boolean, errors: string[], cartridge: Cartridge|null}}
 */
export function validateCartridge(raw) {
  const errors = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Not a JSON object.'], cartridge: null };
  }
  const src = /** @type {Record<string, any>} */ (raw);

  if (typeof src.get !== 'number') {
    errors.push('Missing "get" format version — this is not a GET cartridge.');
    return { ok: false, errors, cartridge: null };
  }
  if (src.get > GET_FORMAT) {
    errors.push('Cartridge was made by a newer version of Game Empire Tycoon (format ' + src.get + ').');
    return { ok: false, errors, cartridge: null };
  }

  const base = createCartridge();
  const out = /** @type {any} */ ({ ...base, ...src });

  for (const k of OBJECT_KEYS) {
    if (out[k] === null || typeof out[k] !== 'object' || Array.isArray(out[k])) {
      errors.push('Field "' + k + '" was invalid and has been reset.');
      out[k] = base[k];
    } else {
      out[k] = { ...base[k], ...out[k] };
    }
  }
  for (const k of ARRAY_KEYS) {
    if (!Array.isArray(out[k])) {
      errors.push('Field "' + k + '" was invalid and has been reset.');
      out[k] = base[k];
    }
  }
  // Scenes became live data in Phase 2 — repair each entry's shape, never drop content.
  out.scenes = out.scenes.map((s, i) => {
    const scene = (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
    if (typeof scene.id !== 'string' || !scene.id.trim()) {
      errors.push('Scene ' + (i + 1) + ' had no id and was renamed.');
      scene.id = 'scene' + (i + 1);
    }
    if (!Array.isArray(scene.entities)) {
      if (scene.entities !== undefined) errors.push('Scene "' + scene.id + '" had an invalid entity list and it was reset.');
      scene.entities = [];
    }
    return scene;
  });
  if (typeof out.meta.title !== 'string' || !out.meta.title.trim()) {
    out.meta.title = 'Untitled Game';
  }
  out.get = GET_FORMAT;

  return { ok: true, errors, cartridge: /** @type {Cartridge} */ (out) };
}

/**
 * Filesystem-safe slug for cartridge filenames.
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  const s = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'untitled';
}
