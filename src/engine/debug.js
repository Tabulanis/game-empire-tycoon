/**
 * @file debug.js
 * @description The Debug Deck's data layer: FPS tracking, event log, seeded-RNG
 * readout — and, as of Phase 2, the live entity inspector and collision
 * wireframe wiring that filled the P1 stub slots. Untestable work is
 * unfinished work (Workflow Law), so the Stage reports into this module.
 * Phase 1, extended in Phase 2 (ticket P2-7).
 */

import { seed as rngSeed, random as rngRandom } from './rng.js';

const FPS_WINDOW = 90;
const LOG_MAX = 50;

/* ------------------------------------------------------------------ */
/* shared sources — how the Stage reports into every open Deck         */
/* ------------------------------------------------------------------ */

/**
 * Registered data sources. The editor registers an entity source (reads the
 * open cartridge); the Stage registers a physics source while a play session
 * runs. Module-level on purpose: one truth, every Deck instance sees it.
 */
const sources = {
  /** @type {(() => Array<{id: string, name: string, components: string[]}>)|null} */
  entities: null,
  /** @type {(() => {bodies: number, colliders: number})|null} */
  physics: null
};

/** Shared flag: the Stage draws Rapier debug wireframes while this is on. */
let wireframesOn = true;

/** @param {typeof sources.entities} fn */
export function setEntitySource(fn) { sources.entities = fn; }

/** @param {typeof sources.physics} fn */
export function setPhysicsSource(fn) { sources.physics = fn; }

/** @returns {boolean} */
export function getWireframesEnabled() { return wireframesOn; }

/** @param {boolean} on */
export function setWireframesEnabled(on) { wireframesOn = !!on; }

/* ------------------------------------------------------------------ */
/* per-panel deck instance                                             */
/* ------------------------------------------------------------------ */

/**
 * @returns {object} a debug deck instance — one per Deck panel.
 */
export function createDebugDeck() {
  /** @type {number[]} */
  const frameSamples = [];
  /** @type {Array<{t: number, msg: string}>} */
  const log = [];
  let currentSeed = 1;

  /**
   * Feed one frame's delta time (seconds) into the FPS tracker.
   * @param {number} dt
   */
  function sample(dt) {
    const fps = dt > 0 ? 1 / dt : 0;
    frameSamples.push(fps);
    if (frameSamples.length > FPS_WINDOW) frameSamples.shift();
  }

  /** @returns {number} rolling average fps, rounded. */
  function avgFps() {
    if (!frameSamples.length) return 0;
    const sum = frameSamples.reduce((a, b) => a + b, 0);
    return Math.round(sum / frameSamples.length);
  }

  /** @returns {number[]} the raw sample window, for sparkline drawing. */
  function fpsSamples() {
    return frameSamples;
  }

  /** @param {string} msg */
  function logEvent(msg) {
    log.unshift({ t: Date.now(), msg });
    if (log.length > LOG_MAX) log.length = LOG_MAX;
  }

  /** @returns {Array<{t: number, msg: string}>} */
  function getLog() {
    return log;
  }

  /** @param {number} s */
  function reseed(s) {
    currentSeed = s >>> 0;
    rngSeed(currentSeed);
    logEvent('RNG reseeded to ' + currentSeed);
  }

  /**
   * Roll N values from the shared seeded stream, for the determinism demo.
   * @param {number} n
   * @returns {number[]}
   */
  function roll(n = 8) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(Number(rngRandom().toFixed(4)));
    return out;
  }

  /** @returns {number} */
  function getSeed() {
    return currentSeed;
  }

  /**
   * Live entity inspector, backed by whatever entity source the editor
   * registered (P2: the open cartridge's active scene).
   * @returns {{available: boolean, reason?: string, entities?: Array<any>}}
   */
  function entityInspector() {
    if (!sources.entities) {
      return { available: false, reason: 'No entity source registered.' };
    }
    return { available: true, entities: sources.entities() };
  }

  /**
   * Collision wireframe status. The wireframes themselves render in the Stage
   * viewport (they wrap the Stage's physics world); the Deck holds the switch
   * and the live counts.
   * @returns {{available: boolean, reason?: string, enabled?: boolean, bodies?: number, colliders?: number}}
   */
  function collisionWireframes() {
    if (!sources.physics) {
      return {
        available: false,
        reason: 'No physics world running — press Play in the Stage to spin one up.'
      };
    }
    const stats = sources.physics();
    return { available: true, enabled: wireframesOn, ...stats };
  }

  return {
    sample,
    avgFps,
    fpsSamples,
    logEvent,
    getLog,
    reseed,
    roll,
    getSeed,
    entityInspector,
    collisionWireframes
  };
}
