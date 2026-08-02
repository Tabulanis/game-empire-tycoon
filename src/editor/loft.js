/**
 * @file loft.js
 * @description Animation Loft's authoring half: create/edit keyframe clips
 * (add/remove/edit {t, p, r, s} keyframes), save into cartridge.assets.anims.
 * The runtime half (playback, procedural cycles) lives in
 * engine/systems/animation.js — this module only edits clip data.
 * Ticket P6-5. Phase 6.
 */

/**
 * @param {string} name
 * @returns {any} a new, unsaved clip with two keyframes to start from
 */
export function createClip(name) {
  return {
    id: '', name, duration: 2,
    keyframes: [
      { t: 0, p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
      { t: 2, p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }
    ]
  };
}

/**
 * @param {any} clip
 * @param {number} [t]  defaults to the clip's current duration (appends at the end)
 */
export function addKeyframe(clip, t) {
  const time = t !== undefined ? t : clip.duration;
  clip.keyframes.push({ t: time, p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] });
  clip.keyframes.sort((a, b) => a.t - b.t);
  clip.duration = Math.max(clip.duration, time);
}

/**
 * @param {any} clip
 * @param {number} index
 * @returns {boolean}
 */
export function removeKeyframe(clip, index) {
  if (clip.keyframes.length <= 2) return false; // always keep at least a start and end
  clip.keyframes.splice(index, 1);
  return true;
}

/**
 * Save (create or update) a clip into cartridge.assets.anims.
 * @param {any} cartridge
 * @param {any} clip
 * @returns {string} the clip's id
 */
export function saveClip(cartridge, clip) {
  if (!clip.id) {
    const slug = String(clip.name || 'clip').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'clip';
    let id = slug, n = 2;
    while (cartridge.assets.anims.find((c) => c.id === id)) { id = slug + '-' + n; n++; }
    clip.id = id;
  }
  const record = JSON.parse(JSON.stringify(clip));
  const existing = cartridge.assets.anims.findIndex((c) => c.id === clip.id);
  if (existing >= 0) cartridge.assets.anims[existing] = record; else cartridge.assets.anims.push(record);
  return clip.id;
}

/**
 * @param {any} cartridge
 * @param {string} id
 * @returns {boolean}
 */
export function deleteClip(cartridge, id) {
  const i = cartridge.assets.anims.findIndex((c) => c.id === id);
  if (i < 0) return false;
  cartridge.assets.anims.splice(i, 1);
  return true;
}
