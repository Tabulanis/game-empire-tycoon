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

/** Per-context procedural reverb impulse cache (contexts are long-lived). */
const impulseCache = new WeakMap();

/**
 * Procedural reverb impulse: exponentially decaying stereo noise. One
 * recipe for the whole app — the Foundry's reverb dial and the Sound
 * Editor's reverb button sound like the same room.
 * @param {BaseAudioContext} ctx
 * @param {number} [seconds]
 * @returns {AudioBuffer}
 */
export function makeImpulseResponse(ctx, seconds = 1.6) {
  let impulse = impulseCache.get(ctx);
  if (impulse && impulse.duration >= seconds) return impulse;
  const rate = ctx.sampleRate;
  const frames = Math.ceil(seconds * rate);
  impulse = ctx.createBuffer(2, frames, rate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 2.4);
    }
  }
  impulseCache.set(ctx, impulse);
  return impulse;
}

/**
 * Synthesize one Foundry-style param sfx into any context/destination at an
 * exact time. The single source of truth for how params become sound.
 * Optional power dials (all default to off/neutral so old saved sounds are
 * untouched): tone (lowpass brightness 0..1), wobble (vibrato 0..1),
 * echo (feedback-delay mix 0..1), reverb (convolver mix 0..1).
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} destination
 * @param {number} when  absolute ctx time
 * @param {import('../../editor/foundry.js').SfxParams} params
 */
export function synthesizeParamsInto(ctx, destination, when, params) {
  const duration = params.sustain + params.decay;
  const tone = params.tone == null ? 1 : params.tone;
  const wobble = params.wobble || 0;
  const wah = params.wah || 0;
  const chorus = params.chorus || 0;
  const crunch = params.crunch || 0;
  const echo = params.echo || 0;
  const reverb = params.reverb || 0;

  // Envelope first, then effect sends — so echo/reverb tails keep ringing
  // after the envelope has closed.
  const env = ctx.createGain();
  env.gain.setValueAtTime(params.volume, when);
  env.gain.setValueAtTime(params.volume, when + params.sustain);
  env.gain.linearRampToValueAtTime(0.0001, when + duration);

  // Series chain built back-to-front: source → crunch → wah → tone → env.
  /** @type {AudioNode} where the raw source connects */
  let head = env;
  if (tone < 0.98) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300 + tone * tone * 7700; // 300 Hz shut … 8 kHz open
    filter.connect(head);
    head = filter;
  }
  if (wah > 0.02) {
    // Auto-wah: an LFO-swept bandpass. Depth and resonance scale together
    // so the dial goes from a gentle vowel to a full funk pedal.
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 800;
    bp.Q.value = 1.5 + wah * 6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 2.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 200 + wah * 900;
    lfo.connect(lfoGain);
    lfoGain.connect(bp.frequency);
    lfo.start(when);
    lfo.stop(when + duration + 0.1);
    bp.connect(head);
    head = bp;
  }
  if (crunch > 0.02) {
    // Waveshaper distortion with output level compensation.
    const shaper = ctx.createWaveShaper();
    const drive = 1 + crunch * 24;
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      const x = (i / 511) * 2 - 1;
      curve[i] = Math.tanh(x * drive);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    const trim = ctx.createGain();
    trim.gain.value = 1 / (1 + crunch * 1.2);
    shaper.connect(trim);
    trim.connect(head);
    head = shaper;
  }

  env.connect(destination);
  if (chorus > 0.02) {
    // Two detuned modulated delays in parallel — the classic shimmer.
    const wet = ctx.createGain();
    wet.gain.value = chorus * 0.55;
    for (const [delayS, rate] of [[0.013, 0.8], [0.021, 1.15]]) {
      const d = ctx.createDelay(0.1);
      d.delayTime.value = delayS;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.004;
      lfo.connect(lfoGain);
      lfoGain.connect(d.delayTime);
      lfo.start(when);
      lfo.stop(when + duration + 0.2);
      env.connect(d);
      d.connect(wet);
    }
    wet.connect(destination);
  }
  if (echo > 0.02) {
    const send = ctx.createGain();
    send.gain.value = echo * 0.7;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.17;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.4;
    const darken = ctx.createBiquadFilter();
    darken.type = 'lowpass';
    darken.frequency.value = 2400; // darker repeats read as "echo", not "bug"
    env.connect(send);
    send.connect(delay);
    delay.connect(darken);
    darken.connect(feedback);
    feedback.connect(delay);
    delay.connect(destination);
  }
  if (reverb > 0.02) {
    const send = ctx.createGain();
    send.gain.value = reverb * 0.8;
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulseResponse(ctx);
    env.connect(send);
    send.connect(convolver);
    convolver.connect(destination);
  }

  if (params.wave === 'noise') {
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(head);
    source.start(when);
    source.stop(when + duration);
  } else {
    const osc = ctx.createOscillator();
    osc.type = params.wave;
    osc.frequency.setValueAtTime(Math.max(20, params.startFreq), when);
    const endFreq = Math.max(20, params.startFreq + params.freqSlide * duration);
    osc.frequency.linearRampToValueAtTime(endFreq, when + duration);
    if (wobble > 0.02) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 9;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = Math.max(4, params.startFreq * 0.08) * wobble;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(when);
      lfo.stop(when + duration);
    }
    osc.connect(head);
    osc.start(when);
    osc.stop(when + duration);
  }
}

/**
 * @param {import('../../editor/foundry.js').SfxParams} params
 * @returns {number} seconds of tail the effect sends need to ring out
 */
export function paramsTailSeconds(params) {
  const echo = params.echo || 0;
  const reverb = params.reverb || 0;
  if (echo > 0.02 || reverb > 0.02) return 1.6;
  return 0.05;
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
  const duration = Math.max(0.05, params.sustain + params.decay) + paramsTailSeconds(params);
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
 * @typedef {Object} VoiceAssets  looked-up resources for 'sfx:<id>' voices
 * @property {Array<any>} sfxList  cartridge.assets.sfx
 * @property {Object<string, AudioBuffer>} sampleBuffers  pre-decoded sample
 *   waveforms by sfx id (samples must be decoded before scheduling; see
 *   prepareVoiceAssets)
 */

/**
 * Schedule one tracker note into any context/destination at an exact time.
 * Voices: pulse/tri/saw/noise are chip oscillators; 'sfx:<id>' plays one of
 * the kid's own saved sounds as a pitched instrument — param sounds are
 * re-synthesized at the note's frequency with their full effects chain,
 * sample sounds play at a playback rate relative to A4 (a real sampler);
 * legacy 'sample0'..'sample3' slots re-pitch a stored param set.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} destination
 * @param {number} when
 * @param {string} note
 * @param {string} voice
 * @param {number} stepDuration  seconds — the note rings for roughly this long
 * @param {Array<any>} sampleSlots  song.sampleSlots — Foundry SfxParams or null, indexed 0-3
 * @param {VoiceAssets} [assets]
 */
export function scheduleNoteInto(ctx, destination, when, note, voice, stepDuration, sampleSlots, assets) {
  const freq = noteToFrequency(note);
  const duration = stepDuration * 0.9; // slight gap between notes, even at full step length

  if (voice.startsWith('sfx:')) {
    const id = voice.slice(4);
    const record = assets && assets.sfxList.find((s) => s.id === id);
    if (!record) return;
    if (record.kind === 'sample') {
      const buffer = assets.sampleBuffers[id];
      if (!buffer) return; // not decoded yet — the note is skipped, not late
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      gain.connect(destination);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = freq / 440; // A4 plays the sample as recorded
      source.connect(gain);
      source.start(when);
      return;
    }
    // Param sound as an instrument: same synthesis, note-pitched.
    synthesizeParamsInto(ctx, destination, when, { ...record.params, startFreq: freq });
    return;
  }

  const gain = ctx.createGain();
  gain.connect(destination);
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
 * Build the VoiceAssets a song needs: find every 'sfx:<id>' voice, decode
 * the sample-kind ones up front. Live playback fills buffers as decodes
 * land (first notes may skip for a few ms on a cold cache); offline render
 * awaits everything.
 * @param {any} song
 * @param {Array<any>} sfxList  cartridge.assets.sfx
 * @returns {{assets: VoiceAssets, ready: Promise<void>}}
 */
export function prepareVoiceAssets(song, sfxList) {
  const assets = { sfxList: sfxList || [], sampleBuffers: {} };
  const pending = [];
  for (const voice of song.channelVoices || []) {
    if (typeof voice === 'string' && voice.startsWith('sfx:')) {
      const record = assets.sfxList.find((s) => s.id === voice.slice(4));
      if (record && record.kind === 'sample') {
        pending.push(decodeSample(record).then((buffer) => {
          assets.sampleBuffers[record.id] = buffer;
        }).catch(() => {}));
      }
    }
  }
  return { assets, ready: Promise.all(pending).then(() => {}) };
}

/**
 * Schedule one tracker note on the live music bus.
 * @param {number} when  ctx.currentTime-relative absolute time
 * @param {string} note
 * @param {string} voice
 * @param {number} stepDuration
 * @param {Array<any>} sampleSlots
 */
export function scheduleNote(when, note, voice, stepDuration, sampleSlots, assets) {
  const ctx = getContext();
  scheduleNoteInto(ctx, buses.music, when, note, voice, stepDuration, sampleSlots, assets);
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
export function playSong(song, sfxList) {
  const ctx = getContext();
  const { assets } = prepareVoiceAssets(song, sfxList || []);
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
            scheduleNote(nextStepTime, note, voice, stepDuration, song.sampleSlots || [], assets);
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
export async function renderSong(song, sfxList) {
  const rate = 44100;
  const { assets, ready } = prepareVoiceAssets(song, sfxList || []);
  await ready;
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
          scheduleNoteInto(ctx, ctx.destination, when, note, voice, stepDuration, song.sampleSlots || [], assets);
        }
      });
      when += stepDuration;
    }
  }
  return ctx.startRendering();
}
