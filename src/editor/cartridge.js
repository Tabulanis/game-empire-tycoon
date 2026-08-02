/**
 * @file cartridge.js
 * @description Cartridge service: the open project, dirty tracking, session
 * persistence, and disk I/O (File System Access API with download fallback).
 * Ticket P0-2. Authority for the file format lives in schema.js, not here.
 * Phase 0.
 */

import { createCartridge, validateCartridge, slugify } from './schema.js';

const SESSION_KEY = 'get.session.v1';

/** @type {{cartridge: any, handle: any, dirty: boolean, listeners: Set<Function>}} */
const state = {
  cartridge: createCartridge(),
  handle: null,
  dirty: false,
  listeners: new Set()
};

/** @returns {boolean} true when the browser can write files directly. */
export function hasFileSystemAccess() {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

/** @param {Function} fn @returns {Function} unsubscribe */
export function onChange(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

function emit() {
  for (const fn of state.listeners) fn(state.cartridge, state.dirty);
}

/** @returns {any} the live cartridge object. */
export function getCartridge() {
  return state.cartridge;
}

/** @returns {boolean} */
export function isDirty() {
  return state.dirty;
}

/** @returns {string|null} name of the bound file, if any. */
export function getFileName() {
  return state.handle ? state.handle.name : null;
}

/**
 * Mark the cartridge modified and persist the session snapshot.
 * Call this after ANY mutation of the cartridge object.
 */
export function touch() {
  state.dirty = true;
  saveSession();
  emit();
}

/** Replace the whole cartridge (load, restore, new). @param {any} c @param {any} [handle] */
export function setCartridge(c, handle = null) {
  state.cartridge = c;
  state.handle = handle;
  state.dirty = false;
  saveSession();
  emit();
}

/* ------------------------------------------------------------------ */
/* session persistence — this is what makes P0-5 pass                  */
/* ------------------------------------------------------------------ */

/** Write the open cartridge to localStorage so a browser restart restores it. */
export function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      cartridge: state.cartridge,
      dirty: state.dirty,
      fileName: state.handle ? state.handle.name : null,
      at: Date.now()
    }));
  } catch (err) {
    console.warn('[cartridge] session save failed', err);
  }
}

/**
 * Restore the previous session, if any.
 * @returns {{restored: boolean, errors: string[], fileName: string|null}}
 */
export function restoreSession() {
  let raw = null;
  try {
    raw = localStorage.getItem(SESSION_KEY);
  } catch (err) {
    console.warn('[cartridge] session read failed', err);
  }
  if (!raw) return { restored: false, errors: [], fileName: null };

  try {
    const parsed = JSON.parse(raw);
    const { ok, errors, cartridge } = validateCartridge(parsed.cartridge);
    if (!ok || !cartridge) return { restored: false, errors, fileName: null };
    state.cartridge = cartridge;
    state.dirty = !!parsed.dirty;
    state.handle = null; // file handles do not survive a restart in P0
    emit();
    return { restored: true, errors, fileName: parsed.fileName || null };
  } catch (err) {
    console.warn('[cartridge] session parse failed', err);
    return { restored: false, errors: ['Session data was corrupt.'], fileName: null };
  }
}

/** Wipe the session snapshot (used by New). */
export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* disk I/O                                                            */
/* ------------------------------------------------------------------ */

/**
 * Start a new cartridge, letting the caller populate it before it's set as
 * the live cartridge (and before any onChange listener fires) — used for
 * genre templates, which need to set the scene list and bricksheets before
 * anyone reacts to "a new cartridge exists".
 * @param {string} title
 * @param {(cartridge: any) => void} [populate]  mutates the fresh cartridge in place
 */
export function newCartridge(title = 'Untitled Game', populate) {
  const c = createCartridge(title);
  if (populate) populate(c);
  setCartridge(c);
}

/** @returns {string} pretty JSON of the open cartridge. */
export function serialize() {
  return JSON.stringify(state.cartridge, null, 2);
}

/** @returns {string} suggested filename. */
export function suggestedName() {
  return slugify(state.cartridge.meta.title) + '.getgame.json';
}

/**
 * Save to the bound file, or prompt for one.
 * @param {boolean} [forcePicker]
 * @returns {Promise<{ok: boolean, method: string, error?: string}>}
 */
export async function save(forcePicker = false) {
  const text = serialize();

  if (hasFileSystemAccess()) {
    try {
      let handle = state.handle;
      if (!handle || forcePicker) {
        handle = await window.showSaveFilePicker({
          suggestedName: suggestedName(),
          types: [{ description: 'GET Cartridge', accept: { 'application/json': ['.json'] } }]
        });
      }
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      state.handle = handle;
      state.dirty = false;
      saveSession();
      emit();
      return { ok: true, method: 'file' };
    } catch (err) {
      if (err && err.name === 'AbortError') return { ok: false, method: 'file', error: 'cancelled' };
      console.warn('[cartridge] FSA save failed, falling back to download', err);
    }
  }

  downloadText(text, suggestedName());
  state.dirty = false;
  saveSession();
  emit();
  return { ok: true, method: 'download' };
}

/**
 * Open a cartridge from disk.
 * @returns {Promise<{ok: boolean, errors: string[], error?: string}>}
 */
export async function open() {
  if (hasFileSystemAccess()) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'GET Cartridge', accept: { 'application/json': ['.json'] } }],
        multiple: false
      });
      const file = await handle.getFile();
      const result = await loadFromText(await file.text(), handle);
      return result;
    } catch (err) {
      if (err && err.name === 'AbortError') return { ok: false, errors: [], error: 'cancelled' };
      console.warn('[cartridge] FSA open failed, falling back to input', err);
    }
  }
  return openViaInput();
}

/** Fallback file picker using a hidden <input type=file>. */
function openViaInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return resolve({ ok: false, errors: [], error: 'cancelled' });
      resolve(await loadFromText(await file.text(), null));
    });
    input.click();
  });
}

/**
 * Parse + validate + adopt cartridge text.
 * @param {string} text
 * @param {any} [handle]
 * @returns {Promise<{ok: boolean, errors: string[], error?: string}>}
 */
export async function loadFromText(text, handle = null) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [], error: 'That file is not valid JSON.' };
  }
  const { ok, errors, cartridge } = validateCartridge(parsed);
  if (!ok || !cartridge) {
    return { ok: false, errors, error: errors[0] || 'Not a valid cartridge.' };
  }
  setCartridge(cartridge, handle);
  return { ok: true, errors };
}

/**
 * Trigger a browser download of text content.
 * @param {string} text
 * @param {string} filename
 */
export function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  downloadBlob(blob, filename);
}

/**
 * Trigger a browser download of a blob.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
