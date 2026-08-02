/**
 * @file foundry.js
 * @description SFX Foundry: a jsfxr-style parameter synth. No sample
 * library, no audio dependency in the whitelist — sounds are pure
 * parameters (waveform + envelope) synthesized live with raw Web Audio,
 * the same way sfxr/jsfxr work under the hood. That makes saved sfx assets
 * tiny (a handful of numbers, not a baked WAV) and infinitely replayable.
 * Ticket P3-9. Phase 3. Playback here is authoring-time preview; wiring a
 * "play sfx" brick into real gameplay arrives with Phase 4's audio.js.
 */

/**
 * @typedef {Object} SfxParams
 * @property {'square'|'sine'|'sawtooth'|'triangle'|'noise'} wave
 * @property {number} startFreq  Hz
 * @property {number} freqSlide  Hz change per second (can be negative)
 * @property {number} sustain  seconds at full volume
 * @property {number} decay  seconds fading to silence after sustain
 * @property {number} volume  0..1
 */

/** Hand-tuned starting points for the six preset buttons Article IX calls for. */
export const PRESETS = {
  jump: { wave: 'square', startFreq: 300, freqSlide: 450, sustain: 0.04, decay: 0.12, volume: 0.5 },
  coin: { wave: 'square', startFreq: 900, freqSlide: 250, sustain: 0.03, decay: 0.15, volume: 0.45 },
  hit: { wave: 'sawtooth', startFreq: 180, freqSlide: -220, sustain: 0.02, decay: 0.1, volume: 0.55 },
  zap: { wave: 'sawtooth', startFreq: 1200, freqSlide: -900, sustain: 0.01, decay: 0.08, volume: 0.4 },
  boom: { wave: 'noise', startFreq: 90, freqSlide: -40, sustain: 0.05, decay: 0.35, volume: 0.7 },
  powerup: { wave: 'triangle', startFreq: 400, freqSlide: 500, sustain: 0.12, decay: 0.2, volume: 0.5 }
};

/** @returns {SfxParams} a neutral starting point when no preset is picked */
export function blankParams() {
  return { wave: 'square', startFreq: 440, freqSlide: 0, sustain: 0.08, decay: 0.15, volume: 0.5 };
}

/**
 * Nudge every parameter a little — the "mutate dice". Authoring-time
 * exploration only; not part of the compiled game's deterministic replay,
 * so plain Math.random is fine here (contrast with the Chance brick, which
 * MUST use the seeded stream).
 * @param {SfxParams} params
 * @returns {SfxParams} a new, mutated params object
 */
export function mutate(params) {
  const jitter = (v, amount) => v + (Math.random() * 2 - 1) * amount;
  return {
    wave: params.wave,
    startFreq: Math.max(40, jitter(params.startFreq, params.startFreq * 0.25)),
    freqSlide: jitter(params.freqSlide, Math.abs(params.freqSlide) * 0.4 + 40),
    sustain: Math.max(0, jitter(params.sustain, 0.03)),
    decay: Math.max(0.02, jitter(params.decay, 0.08)),
    volume: Math.min(1, Math.max(0.05, jitter(params.volume, 0.1)))
  };
}

let sharedContext = null;

/** @returns {AudioContext} a lazily-created, reused audio context */
function getContext() {
  if (!sharedContext) sharedContext = new (window.AudioContext || window.webkitAudioContext)();
  return sharedContext;
}

/**
 * Synthesize and play params immediately, on the shared audio context.
 * @param {SfxParams} params
 */
export function play(params) {
  const ctx = getContext();
  const duration = params.sustain + params.decay;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(params.volume, now);
  gain.gain.setValueAtTime(params.volume, now + params.sustain);
  gain.gain.linearRampToValueAtTime(0.0001, now + duration);

  if (params.wave === 'noise') {
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(now);
    source.stop(now + duration);
  } else {
    const osc = ctx.createOscillator();
    osc.type = params.wave;
    osc.frequency.setValueAtTime(Math.max(20, params.startFreq), now);
    const endFreq = Math.max(20, params.startFreq + params.freqSlide * duration);
    osc.frequency.linearRampToValueAtTime(endFreq, now + duration);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + duration);
  }
}

/* ------------------------------------------------------------------ */
/* saving into the cartridge                                           */
/* ------------------------------------------------------------------ */

/**
 * Save (create or update) an sfx asset into cartridge.assets.sfx. This IS
 * "export to warehouse" — warehouse.js reads cartridge.assets.sfx directly.
 * @param {any} cartridge
 * @param {{id?: string, name: string, params: SfxParams}} sfx
 * @returns {string} the sfx's id
 */
export function saveSfx(cartridge, sfx) {
  let id = sfx.id;
  if (!id) {
    const slug = String(sfx.name || 'sfx').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sfx';
    id = slug;
    let n = 2;
    while (cartridge.assets.sfx.find((s) => s.id === id)) { id = slug + '-' + n; n++; }
  }
  const record = { id, name: sfx.name, params: { ...sfx.params } };
  const existing = cartridge.assets.sfx.findIndex((s) => s.id === id);
  if (existing >= 0) cartridge.assets.sfx[existing] = record; else cartridge.assets.sfx.push(record);
  return id;
}

/**
 * @param {any} cartridge
 * @param {string} id
 * @returns {boolean}
 */
export function deleteSfx(cartridge, id) {
  const i = cartridge.assets.sfx.findIndex((s) => s.id === id);
  if (i < 0) return false;
  cartridge.assets.sfx.splice(i, 1);
  return true;
}
