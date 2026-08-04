/**
 * @file sfxedit.js
 * @description Sound Editor data/logic: one-click kid-sized audio effects
 * over AudioBuffers (echo, robot, faster, slower, backwards, fade) and
 * saving the result into cartridge.assets.sfx as a kind:'sample' asset (a
 * WAV data URI) alongside the Foundry's param sounds. The DOM lives in
 * panels/sfxedit-panel.js. Playback of sample assets in real gameplay is
 * engine/systems/audio.js playSfxAsset.
 */

import { encodeWavDataURI } from './wav.js';

/**
 * @param {number} channels
 * @param {number} frames
 * @param {number} rate
 * @returns {AudioBuffer}
 */
function makeBuffer(channels, frames, rate) {
  return new AudioBuffer({ numberOfChannels: channels, length: Math.max(1, frames), sampleRate: rate });
}

/**
 * Echo: the buffer through a feedback delay, rendered offline with room for
 * the tail to ring out.
 * @param {AudioBuffer} buffer
 * @returns {Promise<AudioBuffer>}
 */
export function applyEcho(buffer) {
  const tail = 1.2;
  const ctx = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length + Math.ceil(tail * buffer.sampleRate),
    buffer.sampleRate
  );
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.17;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.42;
  source.connect(ctx.destination);
  source.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(ctx.destination);
  source.start(0);
  return ctx.startRendering();
}

/**
 * Robot: ring modulation — multiply the signal by a low sine. Classic
 * dalek/robot voice.
 * @param {AudioBuffer} buffer
 * @returns {AudioBuffer}
 */
export function applyRobot(buffer) {
  const out = makeBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const omega = (2 * Math.PI * 30) / buffer.sampleRate; // 30 Hz modulator
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] = src[i] * Math.sin(omega * i);
  }
  return out;
}

/**
 * Resample by a rate factor — >1 is faster & higher (chipmunk), <1 is
 * slower & deeper. Linear interpolation; honest kid physics: speed and
 * pitch move together, like a record player.
 * @param {AudioBuffer} buffer
 * @param {number} factor
 * @returns {AudioBuffer}
 */
export function applySpeed(buffer, factor) {
  const frames = Math.max(1, Math.floor(buffer.length / factor));
  const out = makeBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < frames; i++) {
      const pos = i * factor;
      const i0 = Math.floor(pos);
      const i1 = Math.min(src.length - 1, i0 + 1);
      const t = pos - i0;
      dst[i] = src[i0] * (1 - t) + src[i1] * t;
    }
  }
  return out;
}

/**
 * Backwards: reverse every channel.
 * @param {AudioBuffer} buffer
 * @returns {AudioBuffer}
 */
export function applyReverse(buffer) {
  const out = makeBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
  }
  return out;
}

/**
 * Fade: smooth the ending out over the last 35% (plus a 5 ms de-click fade
 * at the very start).
 * @param {AudioBuffer} buffer
 * @returns {AudioBuffer}
 */
export function applyFade(buffer) {
  const out = makeBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const fadeFrames = Math.floor(buffer.length * 0.35);
  const clickFrames = Math.min(buffer.length, Math.floor(buffer.sampleRate * 0.005));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) {
      let g = 1;
      if (i < clickFrames) g = i / clickFrames;
      const fromEnd = src.length - i;
      if (fromEnd < fadeFrames) g *= fromEnd / fadeFrames;
      dst[i] = src[i] * g;
    }
  }
  return out;
}

/**
 * Normalize peaks to 0.9 so saved sounds sit at a consistent, non-clipping
 * volume no matter how many effects stacked up.
 * @param {AudioBuffer} buffer
 * @returns {AudioBuffer}
 */
export function normalize(buffer) {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  if (peak < 0.0001 || (peak > 0.85 && peak <= 1)) return buffer;
  const gainFactor = 0.9 / peak;
  const out = makeBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] = src[i] * gainFactor;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* saving into the cartridge                                           */
/* ------------------------------------------------------------------ */

/**
 * Save (create or update) an edited sound into cartridge.assets.sfx as a
 * kind:'sample' asset. Same slug/dedupe convention as foundry.saveSfx, same
 * "export to warehouse" effect — warehouse.js lists these too.
 * @param {any} cartridge
 * @param {{id?: string, name: string, buffer: AudioBuffer}} sample
 * @returns {string} the sfx's id
 */
export function saveSampleSfx(cartridge, sample) {
  let id = sample.id;
  if (!id) {
    const slug = String(sample.name || 'sound').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sound';
    id = slug;
    let n = 2;
    while (cartridge.assets.sfx.find((s) => s.id === id)) { id = slug + '-' + n; n++; }
  }
  const normalized = normalize(sample.buffer);
  const record = {
    id,
    name: sample.name,
    kind: 'sample',
    dur: normalized.duration,
    wav: encodeWavDataURI(normalized)
  };
  const existing = cartridge.assets.sfx.findIndex((s) => s.id === id);
  if (existing >= 0) cartridge.assets.sfx[existing] = record; else cartridge.assets.sfx.push(record);
  return id;
}
