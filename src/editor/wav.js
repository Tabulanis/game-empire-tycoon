/**
 * @file wav.js
 * @description Minimal WAV (RIFF, 16-bit PCM) encoding of AudioBuffers.
 * Pure functions, no DOM, no dependencies — used by the Sound Editor to
 * store edited sounds in the cartridge and by the Sound Booth's WAV export.
 */

/**
 * Encode an AudioBuffer as a 16-bit PCM WAV file.
 * @param {AudioBuffer} buffer
 * @returns {Uint8Array}
 */
export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const rate = buffer.sampleRate;
  const frames = buffer.length;
  const blockAlign = channels * 2;
  const dataSize = frames * blockAlign;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);

  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);           // fmt chunk size
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);           // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const channelData = [];
  for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const clamped = Math.max(-1, Math.min(1, channelData[c][i]));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }
  return bytes;
}

/**
 * Encode an AudioBuffer as a data URI ('data:audio/wav;base64,...') for
 * storage inside the cartridge JSON.
 * @param {AudioBuffer} buffer
 * @returns {string}
 */
export function encodeWavDataURI(buffer) {
  const bytes = encodeWav(buffer);
  // btoa in chunks: String.fromCharCode(...whole array) overflows the arg
  // limit on sounds longer than a fraction of a second.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}
