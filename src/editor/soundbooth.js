/**
 * @file soundbooth.js
 * @description Sound Booth data/logic: the tracker's song model (4 channels,
 * fixed voice per channel, 32-step patterns, pattern chaining, 4 sample
 * slots), CRUD over it, and saving into cartridge.assets.songs. The DOM
 * lives in panels/soundbooth-panel.js.
 * Ticket P4-4. Phase 4.
 */

export const STEPS_PER_PATTERN = 32;
export const CHANNEL_COUNT = 4;
export const VOICES = ['pulse', 'tri', 'saw', 'noise', 'sample0', 'sample1', 'sample2', 'sample3'];

/** Two playable octaves, low to high — enough range for a kid's first song without an overwhelming keyboard. */
export const NOTE_ROWS = (() => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const rows = [];
  for (let octave = 5; octave >= 3; octave--) {
    for (let i = names.length - 1; i >= 0; i--) rows.push(names[i] + octave);
  }
  return rows;
})();

/**
 * @param {number} [steps]
 * @returns {any} a blank pattern
 */
export function createPattern(steps = STEPS_PER_PATTERN) {
  return {
    steps,
    channels: Array.from({ length: CHANNEL_COUNT }, () => new Array(steps).fill(null))
  };
}

/**
 * @param {string} name
 * @returns {any} a new, unsaved song — call saveSong to add it to the cartridge
 */
export function createSong(name) {
  return {
    id: '', name, bpm: 120,
    channelVoices: ['pulse', 'tri', 'saw', 'noise'],
    patterns: { 'pattern-1': createPattern() },
    chain: ['pattern-1'],
    sampleSlots: [null, null, null, null]
  };
}

/**
 * @param {any} song
 * @param {string} channel  patternId key
 * @returns {string} the new pattern id
 */
export function addPattern(song) {
  let n = Object.keys(song.patterns).length + 1;
  let id = 'pattern-' + n;
  while (song.patterns[id]) id = 'pattern-' + (++n);
  song.patterns[id] = createPattern();
  return id;
}

/**
 * @param {any} song
 * @param {string} patternId
 * @returns {boolean}
 */
export function deletePattern(song, patternId) {
  if (Object.keys(song.patterns).length <= 1) return false; // always keep at least one
  if (!song.patterns[patternId]) return false;
  delete song.patterns[patternId];
  song.chain = song.chain.filter((id) => id !== patternId);
  if (!song.chain.length) song.chain = [Object.keys(song.patterns)[0]];
  return true;
}

/**
 * @param {any} song
 * @param {number} channelIndex
 * @param {number} stepIndex
 * @param {string|null} note  null clears the step
 * @param {string} patternId
 */
export function setStep(song, patternId, channelIndex, stepIndex, note) {
  const pattern = song.patterns[patternId];
  if (!pattern) return;
  pattern.channels[channelIndex][stepIndex] = note;
}

/**
 * @param {any} song
 * @param {string} patternId  appended to the end of the chain
 */
export function addChainStep(song, patternId) {
  if (song.patterns[patternId]) song.chain.push(patternId);
}

/**
 * @param {any} song
 * @param {number} index  position in the chain to remove
 */
export function removeChainStep(song, index) {
  if (song.chain.length <= 1) return; // always keep at least one step
  song.chain.splice(index, 1);
}

/* ------------------------------------------------------------------ */
/* saving into the cartridge                                           */
/* ------------------------------------------------------------------ */

/**
 * Save (create or update) a song into cartridge.assets.songs. This IS
 * "export to warehouse" for songs, though songs aren't placeable world
 * objects the way sprites are — they're referenced by id from the
 * Play Song brick, same pattern as sfx.
 * @param {any} cartridge
 * @param {any} song
 * @returns {string} the song's id
 */
export function saveSong(cartridge, song) {
  if (!song.id) {
    const slug = String(song.name || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'song';
    let id = slug, n = 2;
    while (cartridge.assets.songs.find((s) => s.id === id)) { id = slug + '-' + n; n++; }
    song.id = id;
  }
  const record = JSON.parse(JSON.stringify(song));
  const existing = cartridge.assets.songs.findIndex((s) => s.id === song.id);
  if (existing >= 0) cartridge.assets.songs[existing] = record; else cartridge.assets.songs.push(record);
  return song.id;
}

/**
 * @param {any} cartridge
 * @param {string} id
 * @returns {boolean}
 */
export function deleteSong(cartridge, id) {
  const i = cartridge.assets.songs.findIndex((s) => s.id === id);
  if (i < 0) return false;
  cartridge.assets.songs.splice(i, 1);
  return true;
}
