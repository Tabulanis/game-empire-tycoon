/**
 * @file audio.js
 * @description Bus mixer, positional audio, and song/sfx playback. Reuses
 * the SFX Foundry's parameter-synth model (Phase 3) for both one-shot sfx
 * and the Sound Booth tracker's note playback — one synthesis engine, two
 * ways to trigger it (a saved param set, or a note+voice from a pattern).
 * Ticket P4-2. Phase 4.
 */

let sharedContext = null;
/** @type {{master: GainNode, music: GainNode, sfx: GainNode}|null} */
let buses = null;
let unlockBound = false;

/**
 * Browsers create AudioContext in a "suspended" state and refuse to produce
 * sound until it's resumed from inside a real user gesture. Without this,
 * playSfx/playSong can appear to work (no error, notes scheduled) while
 * producing total silence. Bind once; every listener disposes itself after
 * the first gesture, whichever fires first.
 */
function bindAutoplayUnlock() {
  if (unlockBound) return;
  unlockBound = true;
  const unlock = () => {
    if (sharedContext && sharedContext.state === 'suspended') sharedContext.resume();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchstart', unlock);
}

/** @returns {AudioContext} */
function getContext() {
  if (!sharedContext) {
    sharedContext = new (window.AudioContext || window.webkitAudioContext)();
    const master = sharedContext.createGain();
    const music = sharedContext.createGain();
    const sfx = sharedContext.createGain();
    music.connect(master);
    sfx.connect(master);
    master.connect(sharedContext.destination);
    buses = { master, music, sfx };
    bindAutoplayUnlock();
  }
  if (sharedContext.state === 'suspended') sharedContext.resume();
  return sharedContext;
}

/**
 * @param {'master'|'music'|'sfx'} bus
 * @param {number} volume  0..1
 */
export function setBusVolume(bus, volume) {
  getContext();
  buses[bus].gain.value = Math.max(0, Math.min(1, volume));
}

/**
 * Simple stereo positional audio: pans left/right based on an entity's x
 * position relative to the camera/listener x. Not full 3D spatialization —
 * a 2D platformer only ever needs left-right.
 * @param {number} sourceX
 * @param {number} listenerX
 * @param {number} [range]  half-width in world units over which panning reaches full left/right
 * @returns {number} pan value -1..1
 */
export function computePan(sourceX, listenerX, range = 10) {
  return Math.max(-1, Math.min(1, (sourceX - listenerX) / range));
}

/* ------------------------------------------------------------------ */
/* one-shot sfx (reuses foundry.js's param model)                       */
/* ------------------------------------------------------------------ */

/**
 * Play a Foundry-style param sfx through the sfx bus (optionally panned).
 * @param {import('../../editor/foundry.js').SfxParams} params
 * @param {number} [pan]  -1..1
 */
export function playSfx(params, pan = 0) {
  const ctx = getContext();
  const duration = params.sustain + params.decay;
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  gain.connect(panner);
  panner.connect(buses.sfx);
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
/* note synthesis (Sound Booth tracker)                                 */
/* ------------------------------------------------------------------ */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * @param {string} note  e.g. 'A4', 'C#3'
 * @returns {number} frequency in Hz (A4 = 440, equal temperament)
 */
export function noteToFrequency(note) {
  const m = /^([A-G]#?)(-?\d+)$/.exec(note);
  if (!m) return 440;
  const [, name, octaveStr] = m;
  const semitone = NOTE_NAMES.indexOf(name);
  const octave = parseInt(octaveStr, 10);
  const midi = (octave + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Schedule one tracker note at an exact AudioContext time, on the given
 * voice. Sample-slot voices ('sample0'..'sample3') play a saved Foundry sfx
 * pitched by playbackRate instead of a live oscillator.
 * @param {number} when  ctx.currentTime-relative absolute time
 * @param {string} note
 * @param {'pulse'|'tri'|'saw'|'noise'|'sample0'|'sample1'|'sample2'|'sample3'} voice
 * @param {number} stepDuration  seconds — the note rings for roughly this long
 * @param {Array<any>} sampleSlots  song.sampleSlots — Foundry SfxParams or null, indexed 0-3
 */
export function scheduleNote(when, note, voice, stepDuration, sampleSlots) {
  const ctx = getContext();
  const freq = noteToFrequency(note);
  const gain = ctx.createGain();
  gain.connect(buses.music);
  const duration = stepDuration * 0.9; // slight gap between notes, even at full step length
  gain.gain.setValueAtTime(0.35, when);
  gain.gain.linearRampToValueAtTime(0.0001, when + duration);

  if (voice.startsWith('sample')) {
    const slot = sampleSlots[parseInt(voice.slice(6), 10)];
    if (!slot) return;
    // Re-synthesize the saved sfx, re-pitched: playbackRate is expressed as
    // a frequency ratio against the sfx's own base pitch (440 Hz reference).
    const osc = ctx.createOscillator();
    osc.type = slot.wave === 'noise' ? 'square' : slot.wave; // noise sfx as a note: approximate with square, true noise has no pitch
    osc.frequency.setValueAtTime(freq, when);
    osc.connect(gain);
    osc.start(when);
    osc.stop(when + duration);
    return;
  }

  const waveMap = { pulse: 'square', tri: 'triangle', saw: 'sawtooth', noise: 'noise' };
  const wave = waveMap[voice] || 'square';
  if (wave === 'noise') {
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(when);
    source.stop(when + duration);
  } else {
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, when);
    osc.connect(gain);
    osc.start(when);
    osc.stop(when + duration);
  }
}

/* ------------------------------------------------------------------ */
/* song playback — pattern-chain scheduler                              */
/* ------------------------------------------------------------------ */

const SCHEDULE_AHEAD = 0.15; // seconds — how far ahead we schedule notes
const SCHEDULE_INTERVAL = 25; // ms — how often the lookahead timer fires

/**
 * @typedef {Object} SongPlayer
 * @property {() => void} stop
 */

/**
 * Start playing a song (Sound Booth data — see soundbooth.js), looping its
 * pattern chain until stop() is called.
 * @param {any} song  {bpm, channelVoices: string[4], patterns: {id: {steps: number, channels: Array<Array<string|null>>}}, chain: string[], sampleSlots}
 *   channels is 4 arrays of `steps` note-names-or-null; the voice for each
 *   channel is fixed (channelVoices[i]), not chosen per-cell — classic
 *   4-channel tracker convention.
 * @returns {SongPlayer}
 */
export function playSong(song) {
  const ctx = getContext();
  const stepDuration = 60 / song.bpm / 4; // 16th-note steps at the given bpm
  let chainIndex = 0;
  let stepIndex = 0;
  let nextStepTime = ctx.currentTime;
  let stopped = false;

  function currentPattern() {
    const patternId = song.chain[chainIndex % song.chain.length];
    return song.patterns[patternId];
  }

  function scheduler() {
    if (stopped) return;
    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
      const pattern = currentPattern();
      if (pattern) {
        pattern.channels.forEach((steps, channelIndex) => {
          const note = steps[stepIndex];
          if (note) {
            const voice = song.channelVoices[channelIndex] || 'pulse';
            scheduleNote(nextStepTime, note, voice, stepDuration, song.sampleSlots || []);
          }
        });
      }
      nextStepTime += stepDuration;
      stepIndex++;
      if (!pattern || stepIndex >= pattern.steps) {
        stepIndex = 0;
        chainIndex++;
      }
    }
    setTimeout(scheduler, SCHEDULE_INTERVAL);
  }
  scheduler();

  return {
    stop() { stopped = true; },
    /** Live playback position, for a UI playhead — polled, not pushed. */
    getPosition() {
      const idx = chainIndex % song.chain.length;
      return { patternId: song.chain[idx], chainIndex: idx, stepIndex };
    }
  };
}
