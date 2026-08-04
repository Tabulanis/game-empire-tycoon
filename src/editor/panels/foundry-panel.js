/**
 * @file foundry-panel.js
 * @description SFX Foundry tab: preset buttons, a parameter form, a mutate
 * dice, Play, and Save (into cartridge.assets.sfx — export to warehouse).
 * Ticket P3-9. Phase 3.
 */

import * as cart from '../cartridge.js';
import * as foundry from '../foundry.js';

let currentSfxId = null;
let params = foundry.blankParams();
let currentName = 'Sound';

const PRESET_LABELS = { jump: 'Jump', coin: 'Coin', hit: 'Hit', zap: 'Zap', boom: 'Boom', powerup: 'Power-Up' };
const WAVES = ['square', 'sine', 'sawtooth', 'triangle', 'noise'];

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderFoundryPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>SFX Foundry</h2>' +
    '<div class="sub">Pick a preset and tweak it, or roll the dice — every sound here is a handful of numbers, ' +
    'synthesized live, never a recording.</div>';

  const layout = document.createElement('div');
  layout.className = 'stage-layout';

  const left = document.createElement('div');

  const presetCard = document.createElement('div');
  presetCard.className = 'card';
  presetCard.innerHTML = '<h3>Presets</h3>';
  const presetRow = document.createElement('div');
  presetRow.className = 'stage-bar';
  for (const [id, label] of Object.entries(PRESET_LABELS)) {
    presetRow.appendChild(makeBtn(label, () => {
      params = { ...foundry.PRESETS[id] };
      currentSfxId = null;
      currentName = label;
      renderAll();
      foundry.play(params);
    }));
  }
  presetCard.appendChild(presetRow);
  left.appendChild(presetCard);

  const paramCard = document.createElement('div');
  paramCard.className = 'card';
  paramCard.innerHTML = '<h3>Parameters</h3>';
  const paramGrid = document.createElement('div');
  paramCard.appendChild(paramGrid);
  left.appendChild(paramCard);

  const actionBar = document.createElement('div');
  actionBar.className = 'stage-bar';
  const playBtn = makeBtn('\u25B6 Play', () => foundry.play(params));
  playBtn.className += ' primary';
  const mutateBtn = makeBtn('\u2685 Mutate', () => { params = foundry.mutate(params); renderAll(); foundry.play(params); });
  actionBar.appendChild(playBtn);
  actionBar.appendChild(mutateBtn);
  left.appendChild(actionBar);

  layout.appendChild(left);

  const right = document.createElement('div');
  right.className = 'deck-right';

  const libCard = document.createElement('div');
  libCard.className = 'card';
  libCard.innerHTML = '<h3>My Sounds</h3>';
  const libList = document.createElement('div');
  libCard.appendChild(libList);
  right.appendChild(libCard);

  const saveCard = document.createElement('div');
  saveCard.className = 'card';
  saveCard.innerHTML = '<h3>Save</h3>';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'title-input';
  nameInput.style.width = '100%';
  nameInput.style.marginBottom = '8px';
  nameInput.addEventListener('change', () => { currentName = nameInput.value; });
  saveCard.appendChild(nameInput);
  const saveBtn = makeBtn('Save to Warehouse', () => {
    const live = cart.getCartridge();
    const id = foundry.saveSfx(live, { id: currentSfxId, name: nameInput.value || currentName, params });
    cart.touch();
    currentSfxId = id;
    ctx.toast('Saved "' + (nameInput.value || currentName) + '" — find it in the Warehouse under My Assets.');
    renderAll();
  });
  saveBtn.className += ' primary';
  saveBtn.style.width = '100%';
  saveCard.appendChild(saveBtn);
  const deleteBtn = makeBtn('Delete Sound', () => {
    if (!currentSfxId) { ctx.toast('Nothing saved yet to delete.', true); return; }
    if (!confirm('Delete this sound from the Warehouse?')) return;
    const live = cart.getCartridge();
    foundry.deleteSfx(live, currentSfxId);
    cart.touch();
    currentSfxId = null;
    ctx.toast('Deleted.');
    renderAll();
  });
  deleteBtn.className += ' bad-btn';
  deleteBtn.style.width = '100%';
  deleteBtn.style.marginTop = '4px';
  saveCard.appendChild(deleteBtn);
  right.appendChild(saveCard);

  layout.appendChild(right);
  panel.appendChild(layout);
  host.appendChild(panel);

  /* ---------------------------------------------------------------- */
  /* rendering                                                          */
  /* ---------------------------------------------------------------- */

  function refreshParamGrid() {
    paramGrid.innerHTML = '';

    const waveRow = document.createElement('div');
    waveRow.className = 'brick-row';
    const waveLabel = document.createElement('span');
    waveLabel.textContent = 'Waveform:';
    waveRow.appendChild(waveLabel);
    const waveSelect = document.createElement('select');
    waveSelect.className = 'deck-select';
    for (const w of WAVES) {
      const opt = document.createElement('option');
      opt.value = w; opt.textContent = w;
      if (params.wave === w) opt.selected = true;
      waveSelect.appendChild(opt);
    }
    waveSelect.addEventListener('change', () => { params.wave = waveSelect.value; });
    waveRow.appendChild(waveSelect);
    paramGrid.appendChild(waveRow);

    paramGrid.appendChild(sliderRow('Start Freq (Hz)', params.startFreq, 40, 2000, 1, (v) => { params.startFreq = v; }));
    paramGrid.appendChild(sliderRow('Freq Slide', params.freqSlide, -1000, 1000, 1, (v) => { params.freqSlide = v; }));
    paramGrid.appendChild(sliderRow('Sustain (s)', params.sustain, 0, 0.5, 0.01, (v) => { params.sustain = v; }));
    paramGrid.appendChild(sliderRow('Decay (s)', params.decay, 0.02, 1, 0.01, (v) => { params.decay = v; }));
    paramGrid.appendChild(sliderRow('Volume', params.volume, 0, 1, 0.01, (v) => { params.volume = v; }));
  }

  function sliderRow(label, value, min, max, step, onInput) {
    const row = document.createElement('div');
    row.className = 'brick-row';
    const labelEl = document.createElement('span');
    labelEl.textContent = label + ':';
    labelEl.style.minWidth = '110px';
    row.appendChild(labelEl);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(value);
    input.style.flex = '1';
    const valueLabel = document.createElement('span');
    valueLabel.textContent = Number(value).toFixed(2);
    valueLabel.style.minWidth = '48px';
    input.addEventListener('input', () => {
      onInput(Number(input.value));
      valueLabel.textContent = Number(input.value).toFixed(2);
    });
    row.appendChild(input);
    row.appendChild(valueLabel);
    return row;
  }

  function refreshLibrary() {
    const live = cart.getCartridge();
    libList.innerHTML = '';
    // Edited (sample-kind) sounds have no params to tweak here — they live
    // next door in the Sound Editor. This library is param sounds only.
    const paramSfx = live.assets.sfx.filter((s) => s.kind !== 'sample');
    if (!paramSfx.length) {
      libList.innerHTML = '<div class="stage-hint">No saved sounds yet.</div>';
      return;
    }
    for (const sfx of paramSfx) {
      const row = document.createElement('div');
      row.className = 'stage-prefab-row';
      const label = document.createElement('span');
      label.textContent = sfx.name;
      row.appendChild(label);
      const playBtn2 = makeBtn('\u25B6', () => foundry.play(sfx.params));
      const editBtn = makeBtn('Edit', () => {
        params = { ...sfx.params };
        currentSfxId = sfx.id;
        currentName = sfx.name;
        renderAll();
      });
      row.appendChild(playBtn2);
      row.appendChild(editBtn);
      libList.appendChild(row);
    }
  }

  function renderAll() {
    nameInput.value = currentName;
    refreshParamGrid();
    refreshLibrary();
  }

  renderAll();
}

function makeBtn(label, fn) {
  const b = document.createElement('button');
  b.className = 'bar';
  b.textContent = label;
  if (fn) b.addEventListener('click', fn);
  return b;
}
