/**
 * @file lab.js
 * @description Particle Lab's authoring half: pick a preset, tune the
 * forces rack (gravity, wind, drag, vortex), save into
 * cartridge.assets.effects. The runtime half (simulation, rendering) lives
 * in engine/systems/particles.js — this module only edits emitter data.
 * Ticket P7-1. Phase 7.
 */

import { PRESETS, presetSpec } from '../engine/systems/particles.js';

export { PRESETS };

/**
 * @param {string} preset
 * @param {string} name
 * @returns {any} a new, unsaved effect — starts from the preset's tuned defaults
 */
export function createEffect(preset, name) {
  return { id: '', name, preset, ...presetSpec(preset) };
}

/**
 * Save (create or update) an effect into cartridge.assets.effects.
 * @param {any} cartridge
 * @param {any} effect
 * @returns {string} the effect's id
 */
export function saveEffect(cartridge, effect) {
  if (!cartridge.assets.effects) cartridge.assets.effects = [];
  if (!effect.id) {
    const slug = String(effect.name || 'effect').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'effect';
    let id = slug, n = 2;
    while (cartridge.assets.effects.find((e) => e.id === id)) { id = slug + '-' + n; n++; }
    effect.id = id;
  }
  const record = JSON.parse(JSON.stringify(effect));
  const existing = cartridge.assets.effects.findIndex((e) => e.id === effect.id);
  if (existing >= 0) cartridge.assets.effects[existing] = record; else cartridge.assets.effects.push(record);
  return effect.id;
}

/**
 * @param {any} cartridge
 * @param {string} id
 * @returns {boolean}
 */
export function deleteEffect(cartridge, id) {
  if (!cartridge.assets.effects) return false;
  const i = cartridge.assets.effects.findIndex((e) => e.id === id);
  if (i < 0) return false;
  cartridge.assets.effects.splice(i, 1);
  return true;
}
