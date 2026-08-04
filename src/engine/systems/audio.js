/**
 * @file audio.js
 * @description Bus mixer, positional audio, and song/sfx playback. One
 * synthesis engine, three ways to trigger it: a saved Foundry param set, a
 * note+voice from a Sound Booth pattern, or a sample asset (an edited
 * waveform from the Sound Editor, stored as a WAV data URI). Synthesis is
 * parameterized over (ctx, destination) so the exact same code renders
 * offline — the Sound Editor's "open a Foundry sound" and the Sound Booth's
 * "download as WAV" both reuse it. Ticket P4-2. Phase 4.
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
/* param synthesis (Foundry sfx) — shared live/offline                  */
/* ------------------------------------------------------------------ */

/**
 * Synthesize one Foundry-style param sfx into any context/destination at an
 * exact time. The single source of truth for how params become sound.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} destination
 * @param {number} when  absolute ctx time
 * @param {import('../../editor/foundry.js').SfxParams} params
 */
export function synthesizeParamsInto(ctx, destination, when, params) {
  const duration = params.sustain + params.decay;
  const gain = ctx.createGain();
  gain.connect(destination);
  gain.gain.setValueAtTime(params.volume, when);
  gain.gain.setValueAtTime(params.volume, when + params.sustain);
  gain.gain.linearRampToValueAtTime(0.0001, when + duration);

  if (params.wave === 'noise') {
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
    osc.type = params.wave;
    osc.frequency.setValueAtTime(Math.max(20, params.startFreq), when);
    const endFreq = Math.max(20, params.startFreq + params.freqSlide * duration);
    osc.frequency.linearRampToValueAtTime(endFreq, when + duration);
    osc.connect(gain);
    osc.start(when);
    osc.stop(when + duration);
  }
}

/**
 * Play a Foundry-style param sfx through the sfx bus (optionally panned).
 * @param {import('../../editor/foundry.js').SfxParams} params
 * @param {number} [pan]  -1..1
 */
export function playSfx(params, pan = 0) {
  const ctx = getContext();
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  panner.connect(buses.sfx);
  synthesizeParamsInto(ctx, panner, ctx.currentTime, params);
}

/**
 * Render a param sfx offline to an AudioBuffer (the Sound Editor's "open a
 * Foundry sound" path).
 * @param {import('../../editor/foundry.js').SfxParams} params
 * @returns {Promise<AudioBuffer>}
 */
export function renderSfxParams(params) {
  const rate = 44100;
  const duration = Math.max(0.05, params.sustain + params.decay) + 0.05;
  const ctx = new OfflineAudioContext(1, Math.ceil(duration * rate), rate);
  synthesizeParamsInto(ctx, ctx.destination, 0, params);
  return ctx.startRendering();
}

/* ------------------------------------------------------------------ */
/* sample sfx (edited waveforms from the Sound Editor)                  */
/* ------------------------------------------------------------------ */

/** Decoded-sample cache. Keyed by record object: saveSfx replaces records
 * wholesale on edit, so object identity tracks content identity. */
const sampleCache = new WeakMap();

/**
 * @param {{wav: string}} record  a kind:'sample' sfx asset
 * @returns {Promise<AudioBuffer>}
 */
export function decodeSample(record) {
  let promise = sampleCache.get(record);
  if (!promise) {
    const ctx = getContext();
    promise = fetch(record.wav)
      .then((r) => r.arrayBuffer())
      .then((bytes) => ctx.decodeAudioData(bytes));
    sampleCache.set(record, promise);
  }
  return promise;
}

/**
 * Play any sfx asset record — param kind or sample kind — through the sfx
 * bus. The one entry point gameplay should use (the Play SFX brick).
 * @param {any} record  an entry of cartridge.assets.sfx
 * @param {number} [pan]  -1..1
 */
export function playSfxAsset(record, pan = 0) {
  if (record.kind === 'sample') {
    const ctx = getContext();
    decodeSample(record).then((buffer) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      source.connect(panner);
      panner.connect(buses.sfx);
      source.start();
    });
    return;
  }
  playSfx(record.params, pan);
}

/* ------------------------------------------------------------------ */
/* note synthesis (Sound Booth tracker) — shared live/offline           */
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
 * Schedule one tracker note into any context/destination at an exact time.
 * Sample-slot voices ('sample0'..'sample3') play a saved Foundry sfx as a
 * pitched oscillator approximation (true noise has no pitch).
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} destination
 * @param {number} when
 * @param {string} note
 * @param {'pulse'|'tri'|'saw'|'noise'|'sample0'|'sample1'|'sample2'|'sample3'} voice
 * @param {number} stepDuration  seconds — the note rings for roughly this long
 * @param {Array<any>} sampleSlots  song.sampleSlots — Foundry SfxParams or null, indexed 0-3
 */
export function scheduleNoteInto(ctx, destination, when, note, voice, stepDuration, sampleSlots) {
  const freq = noteToFrequency(note);
  const gain = ctx.createGain();
  gain.connect(destination);
  const duration = stepDuration * 0.9; // slight gap between notes, even at full step length
  gain.gain.setValueAtTime(0.35, when);
  gain.gain.linearRampToValueAtTime(0.0001, when + duration);

  if (voice.startsWith('sample')) {
    const slot = sampleSlots[parseInt(voice.slice(6), 10)];
    if (!slot) return;
    const osc = ctx.createOscillator();
    osc.type = slot.wave === 'noise' ? 'square' : slot.wave;
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

/**
 * Schedule one tracker note on the live music bus.
 * @param {number} when  ctx.currentTime-relative absolute time
 * @param {string} note
 * @param {string} voice
 * @param {number} stepDuration
 * @param {Array<any>} sampleSlots
 */
export function scheduleNote(when, note, voice, stepDuration, sampleSlots) {
  const ctx = getContext();
  scheduleNoteInto(ctx, buses.music, when, note, voice, stepDuration, sampleSlots);
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

/**
 * Render one full pass of a song's pattern chain (no looping) to an
 * AudioBuffer — the Sound Booth's "download as WAV". Reuses the exact same
 * note synthesis as live playback.
 * @param {any} song
 * @returns {Promise<AudioBuffer>}
 */
export function renderSong(song) {
  const rate = 44100;
  const stepDuration = 60 / song.bpm / 4;
  let totalSteps = 0;
  for (const patternId of song.chain) {
    const pattern = song.patterns[patternId];
    if (pattern) totalSteps += pattern.steps;
  }
  const duration = Math.max(0.5, totalSteps * stepDuration) + 1.0; // ring-out tail
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);

  let when = 0;
  for (const patternId of song.chain) {
    const pattern = song.patterns[patternId];
    if (!pattern) continue;
    for (let step = 0; step < pattern.steps; step++) {
      pattern.channels.forEach((steps, channelIndex) => {
        const note = steps[step];
        if (note) {
          const voice = song.channelVoices[channelIndex] || 'pulse';
          scheduleNoteInto(ctx, ctx.destination, when, note, voice, stepDuration, song.sampleSlots || []);
        }
      });
      when += stepDuration;
    }
  }
  return ctx.startRendering();
}
