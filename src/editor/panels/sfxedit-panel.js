/**
 * @file sfxedit-panel.js
 * @description Sound Editor DOM: pick a saved sound (or import a file),
 * see its waveform, mash big effect buttons, undo, play, save. The audio
 * math lives in sfxedit.js; sample playback in engine/systems/audio.js.
 */

import * as cart from '../cartridge.js';
import * as fx from '../sfxedit.js';
import { renderSfxParams, decodeSample } from '../../engine/systems/audio.js';

/** The one-click effects, kid-labeled. */
const EFFECTS = [
  { label: '✨ Reverb', apply: (b) => fx.applyReverb(b) },
  { label: '📣 Echo', apply: (b) => fx.applyEcho(b) },
  { label: '🤖 Robot', apply: (b) => fx.applyRobot(b) },
  { label: '🐿️ Faster', apply: (b) => fx.applySpeed(b, 1.3) },
  { label: '🐢 Slower', apply: (b) => fx.applySpeed(b, 0.75) },
  { label: '🔁 Backwards', apply: (b) => fx.applyReverse(b) },
  { label: '🌙 Fade', apply: (b) => fx.applyFade(b) }
];

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderSfxeditPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Sound Editor</h2>' +
    '<div class="sub">Pick a sound, press the buttons, hear what happens. Save it when you love it.</div>';

  /** @type {AudioBuffer|null} */
  let buffer = null;
  /** @type {AudioBuffer[]} undo stack */
  let history = [];
  let currentName = '';
  let busy = false;
  /** @type {{start: number, end: number}|null} selected region, in frames */
  let selection = null;

  /* ---- source row ---- */
  const sourceBar = document.createElement('div');
  sourceBar.className = 'stage-bar';

  const sourceSelect = document.createElement('select');
  sourceSelect.className = 'deck-select';
  sourceBar.appendChild(sourceSelect);

  sourceBar.appendChild(makeBtn('Open', () => {
    const live = cart.getCartridge();
    const sfx = live.assets.sfx.find((s) => s.id === sourceSelect.value);
    if (!sfx) return;
    setBusy(true);
    const load = sfx.kind === 'sample' ? decodeSample(sfx) : renderSfxParams(sfx.params);
    load.then((loaded) => {
      buffer = loaded;
      history = [];
      selection = null;
      currentName = sfx.name;
      nameInput.value = currentName;
      setBusy(false);
      redraw();
    }).catch(() => {
      setBusy(false);
      ctx.toast('Could not open that sound.', true);
    });
  }));

  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'audio/*';
  importInput.style.display = 'none';
  importInput.addEventListener('change', () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    setBusy(true);
    file.arrayBuffer()
      .then((bytes) => new AudioContext().decodeAudioData(bytes))
      .then((decoded) => {
        buffer = decoded;
        history = [];
      selection = null;
        currentName = file.name.replace(/\.[^.]+$/, '');
        nameInput.value = currentName;
        setBusy(false);
        redraw();
      })
      .catch(() => {
        setBusy(false);
        ctx.toast('Could not read that file — try a .wav or .mp3.', true);
      });
    importInput.value = '';
  });
  sourceBar.appendChild(importInput);
  sourceBar.appendChild(makeBtn('Import File…', () => importInput.click()));
  panel.appendChild(sourceBar);

  /* ---- waveform (drag across it to select a piece) ---- */
  const wave = document.createElement('canvas');
  wave.className = 'sfxedit-wave';
  wave.height = 110;
  panel.appendChild(wave);

  let dragStartX = null;
  wave.addEventListener('pointerdown', (e) => {
    if (!buffer) return;
    dragStartX = e.offsetX;
    wave.setPointerCapture(e.pointerId);
  });
  wave.addEventListener('pointermove', (e) => {
    if (dragStartX === null || !buffer) return;
    setSelectionFromPixels(dragStartX, e.offsetX);
    redraw();
  });
  wave.addEventListener('pointerup', (e) => {
    if (dragStartX === null || !buffer) return;
    if (Math.abs(e.offsetX - dragStartX) < 4) {
      selection = null;             // a plain click clears the selection
    } else {
      setSelectionFromPixels(dragStartX, e.offsetX);
    }
    dragStartX = null;
    redraw();
  });

  function setSelectionFromPixels(x1, x2) {
    const width = wave.width || 1;
    const a = Math.max(0, Math.min(x1, x2)) / width;
    const b = Math.min(width, Math.max(x1, x2)) / width;
    selection = {
      start: Math.floor(a * buffer.length),
      end: Math.ceil(b * buffer.length)
    };
  }

  /* ---- region tools (appear when something is selected) ---- */
  const regionBar = document.createElement('div');
  regionBar.className = 'stage-bar';
  const regionHint = document.createElement('span');
  regionHint.className = 'sfxedit-region-hint';
  regionHint.textContent = 'Drag across the wave to pick a piece →';
  regionBar.appendChild(regionHint);
  const regionButtons = [];
  const addRegionBtn = (label, op) => {
    const b = makeBtn(label, () => {
      if (!buffer || !selection || busy) return;
      history.push(buffer);
      buffer = op(buffer, selection.start, selection.end);
      selection = null;
      redraw();
      doPlay();
    });
    regionButtons.push(b);
    regionBar.appendChild(b);
    return b;
  };
  addRegionBtn('✂️ Cut', fx.cutRegion);
  addRegionBtn('🎯 Keep', fx.keepRegion);
  addRegionBtn('🤫 Quiet', fx.silenceRegion);
  panel.appendChild(regionBar);

  /* ---- effect buttons ---- */
  const fxBar = document.createElement('div');
  fxBar.className = 'stage-bar sfxedit-fx';
  const fxButtons = [];
  for (const effect of EFFECTS) {
    const b = makeBtn(effect.label, () => {
      if (!buffer || busy) return;
      history.push(buffer);
      setBusy(true);
      Promise.resolve(effect.apply(buffer)).then((next) => {
        buffer = next;
        setBusy(false);
        redraw();
        doPlay();
      }).catch(() => {
        buffer = history.pop() || buffer;
        setBusy(false);
        ctx.toast('That effect fizzled — try again.', true);
      });
    });
    b.classList.add('sfxedit-fx-btn');
    fxButtons.push(b);
    fxBar.appendChild(b);
  }
  panel.appendChild(fxBar);

  /* ---- transport / save row ---- */
  const actionBar = document.createElement('div');
  actionBar.className = 'stage-bar';

  const playBtn = makeBtn('▶ Play', () => doPlay());
  playBtn.className += ' primary';
  actionBar.appendChild(playBtn);

  const undoBtn = makeBtn('↩ Undo', () => {
    if (!history.length) return;
    buffer = history.pop();
    redraw();
  });
  actionBar.appendChild(undoBtn);

  actionBar.appendChild(makeSep());

  const nameInput = document.createElement('input');
  nameInput.className = 'title-input';
  nameInput.placeholder = 'Sound name';
  nameInput.setAttribute('aria-label', 'Sound name');
  actionBar.appendChild(nameInput);

  const saveBtn = makeBtn('💾 Save', () => {
    if (!buffer) return;
    const name = nameInput.value.trim() || currentName || 'My Sound';
    const live = cart.getCartridge();
    fx.saveSampleSfx(live, { name, buffer });
    cart.touch();
    refreshSources();
    ctx.toast('Saved "' + name + '" — it can play in your game now!');
  });
  actionBar.appendChild(saveBtn);
  panel.appendChild(actionBar);

  /* ---- empty-state hint ---- */
  const hint = document.createElement('div');
  hint.className = 'stage-hint';
  hint.textContent = 'No sound loaded yet — Open a saved sound, or Import a file. (Make new sounds next door in Make!)';
  panel.appendChild(hint);

  host.appendChild(panel);
  refreshSources();
  redraw();

  // The canvas needs a real layout width before first draw.
  requestAnimationFrame(redraw);

  /* ---- helpers ---- */

  function refreshSources() {
    const live = cart.getCartridge();
    sourceSelect.innerHTML = '';
    if (!live.assets.sfx.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(no saved sounds yet)';
      sourceSelect.appendChild(opt);
      return;
    }
    for (const sfx of live.assets.sfx) {
      const opt = document.createElement('option');
      opt.value = sfx.id;
      opt.textContent = (sfx.kind === 'sample' ? '🎚 ' : '🔧 ') + sfx.name;
      sourceSelect.appendChild(opt);
    }
  }

  function doPlay() {
    if (!buffer) return;
    // With a selection, play just that piece — instant "did I grab the
    // right part?" feedback.
    const toPlay = selection ? fx.sliceRegion(buffer, selection.start, selection.end) : buffer;
    const ctx2 = new AudioContext();
    const source = ctx2.createBufferSource();
    source.buffer = toPlay;
    source.connect(ctx2.destination);
    source.onended = () => ctx2.close();
    source.start();
  }

  function setBusy(next) {
    busy = next;
    for (const b of fxButtons) b.disabled = next || !buffer;
    for (const b of regionButtons) b.disabled = next || !buffer || !selection;
    regionHint.style.opacity = selection ? '0.4' : '1';
    saveBtn.disabled = next || !buffer;
    playBtn.disabled = next || !buffer;
    undoBtn.disabled = next || !history.length;
  }

  function redraw() {
    hint.style.display = buffer ? 'none' : '';
    setBusy(busy);
    const width = wave.clientWidth || wave.parentElement && wave.parentElement.clientWidth || 600;
    wave.width = width;
    const g = wave.getContext('2d');
    g.fillStyle = '#171b25';
    g.fillRect(0, 0, wave.width, wave.height);
    if (!buffer) return;
    const data = buffer.getChannelData(0);
    const mid = wave.height / 2;
    g.strokeStyle = '#6fd3ff';
    g.beginPath();
    const step = Math.max(1, Math.floor(data.length / wave.width));
    for (let x = 0; x < wave.width; x++) {
      let min = 1, max = -1;
      const start = x * step;
      for (let i = start; i < Math.min(data.length, start + step); i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
      }
      if (min > max) { min = 0; max = 0; }
      g.moveTo(x + 0.5, mid - max * (mid - 4));
      g.lineTo(x + 0.5, mid - min * (mid - 4) + 1);
    }
    g.stroke();

    if (selection) {
      const x1 = (selection.start / buffer.length) * wave.width;
      const x2 = (selection.end / buffer.length) * wave.width;
      g.fillStyle = 'rgba(111, 211, 255, 0.18)';
      g.fillRect(x1, 0, x2 - x1, wave.height);
      g.strokeStyle = '#6fd3ff';
      g.strokeRect(x1 + 0.5, 0.5, x2 - x1 - 1, wave.height - 1);
    }
  }
}

function makeBtn(label, fn) {
  const b = document.createElement('button');
  b.className = 'bar';
  b.textContent = label;
  if (fn) b.addEventListener('click', fn);
  return b;
}

function makeSep() {
  const s = document.createElement('span');
  s.className = 'stage-sep';
  return s;
}
