/**
 * @file undo.js
 * @description Studio-wide undo/redo. Because everything is cartridge data
 * (Constitution Law 1) and cartridge.touch() is the single mutation funnel,
 * one debounced snapshot stream covers the Stage, terrain, lighting, and
 * every saved asset in every room. Ctrl+Z walks back, Ctrl+Shift+Z (or
 * Ctrl+Y) walks forward; the shell re-renders the current room after each
 * restore. Per-tool in-memory histories (Sound Editor buffers etc.) remain
 * their own, finer-grained undo. Snapshots are JSON strings in a
 * byte-budgeted ring so a cartridge full of baked images can't eat the tab.
 */

const DEBOUNCE_MS = 700;
const MAX_BYTES = 40 * 1024 * 1024; // ~40 MB of history, oldest dropped first
const MAX_ENTRIES = 40;

let past = [];    // snapshots, oldest → newest; top = current state
let future = [];  // redo stack
let timer = null;
let hooks = null; // {serialize(), restore(json)}
let restoring = false;

function totalBytes() {
  let n = 0;
  for (const s of past) n += s.length;
  for (const s of future) n += s.length;
  return n;
}

function trim() {
  while ((past.length > MAX_ENTRIES || totalBytes() > MAX_BYTES) && past.length > 2) {
    past.shift();
  }
}

/**
 * Wire the service. Called once by the shell with closures over the
 * cartridge module.
 * @param {{serialize: () => string, restore: (json: string) => void}} h
 */
export function initUndo(h) {
  hooks = h;
  past = [hooks.serialize()];
  future = [];
}

/** History resets when a different cartridge is loaded/created. */
export function resetUndo() {
  if (!hooks) return;
  clearTimeout(timer);
  past = [hooks.serialize()];
  future = [];
}

/** Called from cartridge.touch() after every mutation — debounced so a
 * slider drag becomes one step, not sixty. */
export function recordChange() {
  if (!hooks || restoring) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const snap = hooks.serialize();
    if (past.length && past[past.length - 1] === snap) return;
    past.push(snap);
    future = [];
    trim();
  }, DEBOUNCE_MS);
}

/** @returns {boolean} true if something was undone */
export function undo() {
  if (!hooks || past.length < 2) return false;
  clearTimeout(timer);
  restoring = true;
  try {
    future.push(past.pop());
    hooks.restore(past[past.length - 1]);
  } finally {
    restoring = false;
  }
  return true;
}

/** @returns {boolean} true if something was redone */
export function redo() {
  if (!hooks || !future.length) return false;
  clearTimeout(timer);
  restoring = true;
  try {
    const snap = future.pop();
    past.push(snap);
    hooks.restore(snap);
  } finally {
    restoring = false;
  }
  return true;
}
