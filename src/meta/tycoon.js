/**
 * @file tycoon.js
 * @description The Tycoon Shell: studio fiction, era progression, staff
 * roster. Per Article II: "no era is time-locked — eras open by shipped
 * cartridges + completed sandboxes." This is a progress DASHBOARD, not a
 * feature gate — every template and tool from every prior phase stays
 * exactly as available as it already was. Retroactively hard-gating seven
 * phases of shipped, verified features behind a new era system this late
 * would be a real risk to work that already ships correctly; celebrating
 * progress without blocking it is the safer and more honest reading of
 * "no era is time-locked" anyway.
 * Ticket P8-1. Phase 8.
 */

import { shippedCount } from '../press/export.js';
import { completedList } from '../editor/codex.js';

/** The six eras, in order, with their studio fiction and unlock flavor text. */
export const ERAS = [
  {
    id: 'garage', name: 'The Garage', months: '0\u20133',
    fiction: 'Founding the studio.',
    unlocks: 'Pixel Atelier, SFX Foundry, the Platformer template, the first bricks.',
    skills: 'Sprites, hitboxes, cause and effect.',
    shippedThreshold: 0, sandboxThreshold: 0
  },
  {
    id: 'first-office', name: 'The First Office', months: '3\u20139',
    fiction: 'The first hires.',
    unlocks: 'Side-scroller and Word templates, the Sound Booth, tile painting.',
    skills: 'Level design, rhythm and audio, difficulty curves.',
    shippedThreshold: 1, sandboxThreshold: 3
  },
  {
    id: 'the-annex', name: 'The Annex', months: '9\u201318',
    fiction: 'Standing up a story department.',
    unlocks: 'Story and RPG templates, dialogue cards, stats and inventory bricks.',
    skills: 'Branching narrative, systems design.',
    shippedThreshold: 3, sandboxThreshold: 7
  },
  {
    id: 'the-tower', name: 'The Tower', months: '18\u201330',
    fiction: 'Standing up a tech department.',
    unlocks: '3D mode, Kit Bay, the 3D Stage, the Strategy template, effect channels.',
    skills: 'Cameras, spatial design, turn systems.',
    shippedThreshold: 5, sandboxThreshold: 11
  },
  {
    id: 'skunkworks', name: 'The Skunkworks', months: '30\u201336',
    fiction: 'Standing up an R&D wing.',
    unlocks: 'The FPS template, the Particle Lab\u2019s full rack, Workshop Mode.',
    skills: '3D movement feel, VFX, performance.',
    shippedThreshold: 7, sandboxThreshold: 15
  },
  {
    id: 'going-public', name: 'Going Public', months: 'ongoing',
    fiction: 'Standing up a publishing arm.',
    unlocks: 'Cartridge Press polish, the itch.io shipping guide, the real-sale ledger.',
    skills: 'Finishing, packaging, selling.',
    shippedThreshold: 10, sandboxThreshold: 19
  }
];

/** Studio staff — the same voices already used throughout the Codex. */
export const STAFF = [
  { name: 'Pix', role: 'Art', joinsAt: 'garage' },
  { name: 'Echo', role: 'Sound', joinsAt: 'garage' },
  { name: 'Quill', role: 'Story', joinsAt: 'first-office' },
  { name: 'Scout', role: 'AI & Behavior', joinsAt: 'the-annex' },
  { name: 'Watts', role: 'Engine & 3D', joinsAt: 'the-tower' },
  { name: 'Sparks', role: 'FX & Particles', joinsAt: 'skunkworks' },
  { name: 'The Founder', role: 'Tycoon Shell, Ledger, Shipping', joinsAt: 'going-public' }
];

/**
 * @returns {{shipped: number, sandboxes: number}} the two progression
 *   metrics eras are computed from
 */
export function currentProgress() {
  return { shipped: shippedCount(), sandboxes: completedList().length };
}

/**
 * @param {{shipped: number, sandboxes: number}} [progress]  defaults to currentProgress()
 * @returns {any} the highest era whose thresholds are met by EITHER metric
 *   (Article II: "eras open by shipped cartridges + completed sandboxes" —
 *   read as either path counting, so a kid who ships a lot but skips
 *   sandboxes still advances, and vice versa)
 */
export function currentEra(progress) {
  const p = progress || currentProgress();
  let era = ERAS[0];
  for (const e of ERAS) {
    if (p.shipped >= e.shippedThreshold || p.sandboxes >= e.sandboxThreshold) era = e;
  }
  return era;
}

/**
 * @param {any} [era]  defaults to currentEra()
 * @returns {Array<any>} staff members who have joined by this era
 */
export function activeStaff(era) {
  const e = era || currentEra();
  const idx = ERAS.findIndex((x) => x.id === e.id);
  return STAFF.filter((s) => ERAS.findIndex((x) => x.id === s.joinsAt) <= idx);
}

/**
 * @param {any} [era]  defaults to currentEra()
 * @returns {any|null} the next era to reach, or null if already at the last one
 */
export function nextEra(era) {
  const e = era || currentEra();
  const idx = ERAS.findIndex((x) => x.id === e.id);
  return idx >= 0 && idx < ERAS.length - 1 ? ERAS[idx + 1] : null;
}
