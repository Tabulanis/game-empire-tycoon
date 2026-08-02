/**
 * @file rng.js
 * @description Seeded random number service. Constitution workflow law: engine
 * and brick code NEVER call Math.random() directly, so bugs reproduce.
 * Phase 0 (used from Phase 1 onward).
 */

/**
 * mulberry32 — small, fast, good enough for games.
 * @param {number} seed
 * @returns {() => number} function returning [0, 1)
 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The default game-wide stream. Reseed at run start for reproducible sessions. */
let stream = makeRng(1);

/** @param {number} seed */
export function seed(seed_) {
  stream = makeRng(seed_);
}

/** @returns {number} [0, 1) */
export function random() {
  return stream();
}

/**
 * @param {number} min
 * @param {number} max
 * @returns {number} integer in [min, max]
 */
export function randInt(min, max) {
  return min + Math.floor(stream() * (max - min + 1));
}

/**
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
export function pick(arr) {
  return arr[Math.floor(stream() * arr.length)];
}
