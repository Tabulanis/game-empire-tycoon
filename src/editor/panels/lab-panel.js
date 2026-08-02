/**
 * @file lab-panel.js
 * @description Particle Lab tab: pick a preset, tune the forces rack
 * (gravity, wind, drag, vortex) and colors, watch it play live, save it —
 * any entity's Emit Particles brick can play it by name.
 * Ticket P7-1. Phase 7.
 */

import * as cart from '../cartridge.js';
import * as lab from '../lab.js';
import { createEngine } from '../../engine/renderer.js';
import { createParticleSystem } from '../../engine/systems/particles.js';

let currentEffectId = null;
let working = lab.createEffect('fire', 'Effect');

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderLabPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Particle Lab</h2>' +
    '<div class="sub">Pick a preset, tune the forces, save it — any Emit Particles brick can play it by name.</div>';

  const bar = document.createElement('div');
  bar.className = 'stage-bar';
  const effectSelect = document.createElement('select');
  effectSelect.className = 'deck-select';
  bar.appendChild(effectSelect);
  panel.appendChild(bar);

  const presetRow = document.createElement('div');
  presetRow.className = 'stage-bar';
  presetRow.style.flexWrap = 'wrap';
  for (const preset of lab.PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'bar' + (working.preset === preset ? ' active' : '');
    btn.textContent = preset;
    btn.dataset.preset = preset;
    btn.addEventListener('click', () => {
      working = lab.createEffect(preset, working.name);
      currentEffectId = null;
      renderAll();
      restartPreview();
    });
    presetRow.appendChild(btn);
  }
  panel.appendChild(presetRow);

  const layout = document.createElement('div');
  layout.className = 'stage-layout';

  // ---------- left: preview ----------
  const left = document.createElement('div');
  left.className = 'card';
  left.innerHTML = '<h3>Preview</h3>';
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'stage-canvas-wrap';
  canvasWrap.style.height = '45vh';
  const canvas = document.createElement('canvas');
  canvas.className = 'deck-canvas';
  canvasWrap.appendChild(canvas);
  left.appendChild(canvasWrap);

  /** Same crash-visibility fix as the Stage's Play loop: an uncaught throw
   * in here used to just kill the rAF loop silently — canvas stays blank,
   * no error anywhere the user would see. */
  const crashBanner = document.createElement('div');
  crashBanner.style.cssText =
    'display:none;background:#3a0d0d;border:1px solid #ff5555;color:#ffd6d6;padding:8px 10px;' +
    'font:12px/1.4 monospace;white-space:pre-wrap;border-radius:6px;margin-top:6px;max-height:30vh;overflow:auto;';
  left.appendChild(crashBanner);
  let previewCrashed = false;
  function showPreviewCrash(err) {
    previewCrashed = true;
    console.error('[lab] particle preview crashed:', err);
    crashBanner.textContent = 'PREVIEW CRASHED — ' + (err && err.message || String(err)) + '\n' +
      (err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : '');
    crashBanner.style.display = 'block';
  }
  left.appendChild(makeBtn('\u21BB Replay Burst', () => { if (activeSystem) activeSystem.burstNow(); }));
  layout.appendChild(left);

  // ---------- right: forces rack + save ----------
  const right = document.createElement('div');
  right.className = 'deck-right';

  const rackCard = document.createElement('div');
  rackCard.className = 'card';
  rackCard.innerHTML = '<h3>Forces Rack</h3>';
  const fields = [
    ['rate', 'Rate (particles/sec)', 0, 100],
    ['drag', 'Drag', 0, 1],
    ['vortexStrength', 'Vortex Strength', 0, 3]
  ];
  const fieldInputs = {};
  fields.forEach(([key, label, min, max]) => {
    const row = document.createElement('div');
    row.className = 'brick-row';
    const l = document.createElement('span'); l.textContent = label + ':'; l.style.minWidth = '150px';
    row.appendChild(l);
    const input = document.createElement('input');
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = '0.05';
    input.addEventListener('input', () => { working[key] = Number(input.value); restartPreview(); });
    fieldInputs[key] = input;
    row.appendChild(input);
    rackCard.appendChild(row);
  });
  const colorRow1 = document.createElement('div');
  colorRow1.className = 'brick-row';
  colorRow1.innerHTML = '<span style="min-width:150px">Start color:</span>';
  const startColorInput = document.createElement('input');
  startColorInput.type = 'color';
  startColorInput.addEventListener('input', () => { working.startColor = startColorInput.value; restartPreview(); });
  colorRow1.appendChild(startColorInput);
  rackCard.appendChild(colorRow1);
  const colorRow2 = document.createElement('div');
  colorRow2.className = 'brick-row';
  colorRow2.innerHTML = '<span style="min-width:150px">End color:</span>';
  const endColorInput = document.createElement('input');
  endColorInput.type = 'color';
  endColorInput.addEventListener('input', () => { working.endColor = endColorInput.value; restartPreview(); });
  colorRow2.appendChild(endColorInput);
  rackCard.appendChild(colorRow2);
  right.appendChild(rackCard);

  const saveCard = document.createElement('div');
  saveCard.className = 'card';
  saveCard.innerHTML = '<h3>Save</h3>';
  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.className = 'title-input';
  nameInput.style.width = '100%'; nameInput.style.marginBottom = '8px';
  saveCard.appendChild(nameInput);
  const saveBtn = makeBtn('Save Effect', () => {
    const live = cart.getCartridge();
    working.name = nameInput.value || working.name;
    const id = lab.saveEffect(live, working);
    cart.touch();
    currentEffectId = id;
    ctx.toast('Saved "' + working.name + '".');
    renderAll();
  });
  saveBtn.className += ' primary'; saveBtn.style.width = '100%';
  saveCard.appendChild(saveBtn);
  right.appendChild(saveCard);

  layout.appendChild(right);
  panel.appendChild(layout);
  host.appendChild(panel);

  function refreshPresetButtons() {
    presetRow.querySelectorAll('button').forEach((btn) => btn.classList.toggle('active', btn.dataset.preset === working.preset));
  }
  function refreshEffectSelect() {
    const live = cart.getCartridge();
    effectSelect.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = currentEffectId ? '(switch effect)' : '(new, unsaved)';
    effectSelect.appendChild(blank);
    for (const e of (live.assets.effects || [])) {
      const opt = document.createElement('option');
      opt.value = e.id; opt.textContent = e.name;
      if (e.id === currentEffectId) opt.selected = true;
      effectSelect.appendChild(opt);
    }
  }
  effectSelect.addEventListener('change', () => {
    if (!effectSelect.value) return;
    const live = cart.getCartridge();
    const record = (live.assets.effects || []).find((e) => e.id === effectSelect.value);
    if (!record) return;
    working = JSON.parse(JSON.stringify(record));
    currentEffectId = record.id;
    renderAll();
    restartPreview();
  });

  function renderAll() {
    nameInput.value = working.name;
    fieldInputs.rate.value = String(working.rate || 0);
    fieldInputs.drag.value = String(working.drag || 0);
    fieldInputs.vortexStrength.value = String(working.vortexStrength || 0);
    startColorInput.value = working.startColor;
    endColorInput.value = working.endColor;
    refreshPresetButtons();
    refreshEffectSelect();
  }

  /* ---------------------------------------------------------------- */
  /* live preview                                                       */
  /* ---------------------------------------------------------------- */
  let engine = null;
  let activeSystem = null;
  let rafId = null;
  let resizeObs = null;

  function restartPreview() {
    if (activeSystem) { activeSystem.dispose(); activeSystem = null; }
    if (!engine) return;
    try {
      activeSystem = createParticleSystem(engine, working);
      activeSystem.setPosition(0, 0, 0);
      if (working.burst) activeSystem.burstNow();
      previewCrashed = false;
      crashBanner.style.display = 'none';
    } catch (err) {
      showPreviewCrash(err);
    }
  }

  function startPreview() {
    engine = createEngine(canvas, { demo: false });
    engine.setMode('3d');
    engine.camera.position.set(0, 1, 4);
    engine.camera.lookAt(0, 0, 0);
    function resize() { engine.resize(canvasWrap.clientWidth, canvasWrap.clientHeight); }
    resizeObs = new ResizeObserver(resize);
    resizeObs.observe(canvasWrap);
    resize();
    restartPreview();

    let lastTs = performance.now();
    function loop(ts) {
      const dt = Math.min((ts - lastTs) / 1000, 0.1);
      lastTs = ts;
      if (!previewCrashed) {
        try {
          if (activeSystem) activeSystem.tick(dt);
          if (engine) engine.tick();
        } catch (err) {
          showPreviewCrash(err);
        }
      }
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame((ts) => { lastTs = ts; loop(ts); });
  }

  function stopPreview() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    if (activeSystem) { activeSystem.dispose(); activeSystem = null; }
    if (engine) { engine.dispose(); engine = null; }
  }

  renderAll();
  startPreview();

  const stopObs = new MutationObserver(() => {
    if (!document.body.contains(panel)) { stopObs.disconnect(); stopPreview(); }
  });
  stopObs.observe(document.body, { childList: true, subtree: true });
}

function makeBtn(label, fn) {
  const b = document.createElement('button');
  b.className = 'bar';
  b.textContent = label;
  if (fn) b.addEventListener('click', fn);
  return b;
}
