/**
 * @file loft-panel.js
 * @description Animation Loft tab: build a keyframe clip (add/edit/remove
 * {t, p, r, s} keyframes), preview it live on a 3D shape, save it for any
 * entity's Animation component to reference by id.
 * Ticket P6-5. Phase 6.
 */

import * as cart from '../cartridge.js';
import * as loft from '../loft.js';
import { createEngine } from '../../engine/renderer.js';
import { buildEntityObject } from '../../engine/meshes.js';
import { sampleClip } from '../../engine/systems/animation.js';

let currentClipId = null;
let working = loft.createClip('Clip');

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderLoftPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Animation Loft</h2>' +
    '<div class="sub">Build a keyframe clip, preview it live, save it — any entity\u2019s Animation component can play it by name.</div>';

  const bar = document.createElement('div');
  bar.className = 'stage-bar';
  const clipSelect = document.createElement('select');
  clipSelect.className = 'deck-select';
  bar.appendChild(clipSelect);
  bar.appendChild(makeBtn('+ New Clip', () => {
    const name = prompt('Clip name?', 'Clip');
    if (name === null) return;
    working = loft.createClip(name);
    currentClipId = null;
    renderAll();
  }));
  panel.appendChild(bar);

  const layout = document.createElement('div');
  layout.className = 'stage-layout';

  // ---------- left: preview ----------
  const left = document.createElement('div');
  left.className = 'card';
  left.innerHTML = '<h3>Preview</h3>';
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'stage-canvas-wrap';
  canvasWrap.style.height = '40vh';
  const canvas = document.createElement('canvas');
  canvas.className = 'deck-canvas';
  canvasWrap.appendChild(canvas);
  left.appendChild(canvasWrap);
  const durationRow = document.createElement('div');
  durationRow.className = 'brick-row';
  durationRow.innerHTML = '<span>Duration (s):</span>';
  const durationInput = document.createElement('input');
  durationInput.type = 'number'; durationInput.min = '0.2'; durationInput.step = '0.1';
  durationInput.addEventListener('change', () => { working.duration = Math.max(0.2, Number(durationInput.value) || 2); });
  durationRow.appendChild(durationInput);
  left.appendChild(durationRow);
  layout.appendChild(left);

  // ---------- right: keyframe list + save ----------
  const right = document.createElement('div');
  right.className = 'deck-right';

  const kfCard = document.createElement('div');
  kfCard.className = 'card';
  kfCard.innerHTML = '<h3>Keyframes</h3>';
  const kfList = document.createElement('div');
  kfCard.appendChild(kfList);
  kfCard.appendChild(makeBtn('+ Keyframe', () => { loft.addKeyframe(working); refreshKeyframes(); }));
  right.appendChild(kfCard);

  const saveCard = document.createElement('div');
  saveCard.className = 'card';
  saveCard.innerHTML = '<h3>Save</h3>';
  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.className = 'title-input';
  nameInput.style.width = '100%'; nameInput.style.marginBottom = '8px';
  saveCard.appendChild(nameInput);
  const saveBtn = makeBtn('Save Clip', () => {
    const live = cart.getCartridge();
    working.name = nameInput.value || working.name;
    const id = loft.saveClip(live, working);
    cart.touch();
    currentClipId = id;
    ctx.toast('Saved "' + working.name + '".');
    renderAll();
  });
  saveBtn.className += ' primary'; saveBtn.style.width = '100%';
  saveCard.appendChild(saveBtn);
  right.appendChild(saveCard);

  layout.appendChild(right);
  panel.appendChild(layout);
  host.appendChild(panel);

  /* ---------------------------------------------------------------- */
  /* keyframe list                                                      */
  /* ---------------------------------------------------------------- */
  function refreshKeyframes() {
    kfList.innerHTML = '';
    working.keyframes.forEach((kf, i) => {
      const row = document.createElement('div');
      row.className = 'brick-row';
      row.style.flexWrap = 'wrap';
      const tLabel = document.createElement('span'); tLabel.textContent = 't:'; row.appendChild(tLabel);
      const tInput = document.createElement('input');
      tInput.type = 'number'; tInput.step = '0.1'; tInput.style.width = '55px'; tInput.value = String(kf.t);
      tInput.addEventListener('change', () => { kf.t = Number(tInput.value) || 0; working.keyframes.sort((a,b)=>a.t-b.t); refreshKeyframes(); });
      row.appendChild(tInput);
      ['p', 'r', 's'].forEach((field) => {
        const fLabel = document.createElement('span'); fLabel.textContent = field + ':'; fLabel.style.marginLeft='6px'; row.appendChild(fLabel);
        [0, 1, 2].forEach((axis) => {
          const input = document.createElement('input');
          input.type = 'number'; input.step = '0.1'; input.style.width = '46px';
          input.value = String(kf[field][axis]);
          input.addEventListener('input', () => { kf[field][axis] = Number(input.value) || 0; });
          row.appendChild(input);
        });
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'bar bad-btn'; delBtn.textContent = '\u2715';
      delBtn.addEventListener('click', () => {
        if (!loft.removeKeyframe(working, i)) { ctx.toast('A clip needs at least 2 keyframes.', true); return; }
        refreshKeyframes();
      });
      row.appendChild(delBtn);
      kfList.appendChild(row);
    });
  }

  function refreshClipSelect() {
    const live = cart.getCartridge();
    clipSelect.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = currentClipId ? '(switch clip)' : '(new, unsaved)';
    clipSelect.appendChild(blank);
    for (const c of live.assets.anims) {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.name;
      if (c.id === currentClipId) opt.selected = true;
      clipSelect.appendChild(opt);
    }
  }
  clipSelect.addEventListener('change', () => {
    if (!clipSelect.value) return;
    const live = cart.getCartridge();
    const record = live.assets.anims.find((c) => c.id === clipSelect.value);
    if (!record) return;
    working = JSON.parse(JSON.stringify(record));
    currentClipId = record.id;
    renderAll();
  });

  function renderAll() {
    nameInput.value = working.name;
    durationInput.value = String(working.duration);
    refreshClipSelect();
    refreshKeyframes();
  }

  /* ---------------------------------------------------------------- */
  /* live preview                                                       */
  /* ---------------------------------------------------------------- */
  let engine = null;
  let mesh = null;
  let rafId = null;
  let resizeObs = null;
  let previewT = 0;
  let lastTs = 0;

  function startPreview() {
    engine = createEngine(canvas, { demo: false });
    engine.setMode('3d');
    engine.camera.position.set(2.5, 2, 2.5);
    engine.camera.lookAt(0, 0, 0);
    function resize() { engine.resize(canvasWrap.clientWidth, canvasWrap.clientHeight); }
    resizeObs = new ResizeObserver(resize);
    resizeObs.observe(canvasWrap);
    resize();
    const fakeEntity = { id: 'preview', components: { transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, model: { shape: 'box', swatch: '#67e39b', size: [1, 1, 1] } } };
    mesh = buildEntityObject({ mode: '3d' }, fakeEntity);
    engine.contentRoot.add(mesh);

    lastTs = performance.now();
    function loop(ts) {
      const dt = Math.min((ts - lastTs) / 1000, 0.1);
      lastTs = ts;
      previewT += dt;
      if (mesh && working.keyframes.length >= 2) {
        const offset = sampleClip(working, previewT);
        mesh.position.set(offset.p[0], offset.p[1], offset.p[2]);
        mesh.rotation.set(offset.r[0] * Math.PI / 180, offset.r[1] * Math.PI / 180, offset.r[2] * Math.PI / 180);
        mesh.scale.set(offset.s[0], offset.s[1], offset.s[2]);
      }
      if (engine) engine.tick();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame((ts) => { lastTs = ts; loop(ts); });
  }

  function stopPreview() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    if (engine) { engine.dispose(); engine = null; }
    mesh = null;
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
