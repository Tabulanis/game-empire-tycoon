/**
 * @file kitbay-panel.js
 * @description Kit Bay tab: build a prop from linked parts — add primitives,
 * attach them parent/child, tune each part's size/position/rotation/color,
 * watch the assembly turn in a live 3D preview, save it as one prefab.
 * Ticket P6-4. Phase 6.
 */

import * as cart from '../cartridge.js';
import * as kitbay from '../kitbay.js';
import { createEngine } from '../../engine/renderer.js';
import { buildEntityObject } from '../../engine/meshes.js';

let working = kitbay.createProp('box');
let selectedPart = 0;

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderKitbayPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Kit Bay</h2>' +
    '<div class="sub">Build a prop from parts: add shapes, link them together, tune each one. Move a parent and its attached parts ride along.</div>';

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
  layout.appendChild(left);

  // ---------- right: parts + tune + save ----------
  const right = document.createElement('div');
  right.className = 'deck-right';

  const partsCard = document.createElement('div');
  partsCard.className = 'card';
  partsCard.innerHTML = '<h3>Parts</h3><div class="stage-hint">Add a shape — it attaches to the picked part.</div>';
  const addRow = document.createElement('div');
  addRow.className = 'stage-bar';
  addRow.style.flexWrap = 'wrap';
  for (const shape of kitbay.SHAPES) {
    const btn = document.createElement('button');
    btn.className = 'bar';
    btn.textContent = '+ ' + kitbay.labelFor(shape);
    btn.addEventListener('click', () => {
      selectedPart = kitbay.addPart(working, shape, selectedPart);
      renderAll();
      rebuildPreviewMesh();
    });
    addRow.appendChild(btn);
  }
  partsCard.appendChild(addRow);
  const partsList = document.createElement('div');
  partsList.style.marginTop = '8px';
  partsCard.appendChild(partsList);
  right.appendChild(partsCard);

  const tuneCard = document.createElement('div');
  tuneCard.className = 'card';
  tuneCard.innerHTML = '<h3>Tune Part</h3>';
  const tuneBody = document.createElement('div');
  tuneCard.appendChild(tuneBody);
  right.appendChild(tuneCard);

  const solidRow = document.createElement('div');
  solidRow.className = 'brick-row';
  solidRow.innerHTML = '<span>Solid (blocks movement):</span>';
  const solidCheck = document.createElement('input');
  solidCheck.type = 'checkbox'; solidCheck.checked = working.solid;
  solidCheck.addEventListener('change', () => { working.solid = solidCheck.checked; });
  solidRow.appendChild(solidCheck);
  tuneCard.appendChild(solidRow);

  const saveCard = document.createElement('div');
  saveCard.className = 'card';
  saveCard.innerHTML = '<h3>Save</h3>';
  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.className = 'title-input';
  nameInput.style.width = '100%'; nameInput.style.marginBottom = '8px';
  nameInput.placeholder = 'Prop name';
  nameInput.value = 'My Prop';
  saveCard.appendChild(nameInput);
  const saveBtn = document.createElement('button');
  saveBtn.className = 'bar primary';
  saveBtn.style.width = '100%';
  saveBtn.textContent = 'Save to Warehouse';
  saveBtn.addEventListener('click', () => {
    const live = cart.getCartridge();
    kitbay.savePropAsPrefab(live, nameInput.value || 'My Prop', working);
    cart.touch();
    ctx.toast('Saved "' + (nameInput.value || 'My Prop') + '" — find it in the Warehouse.');
  });
  saveCard.appendChild(saveBtn);
  const newBtn = document.createElement('button');
  newBtn.className = 'bar';
  newBtn.style.cssText = 'width:100%;margin-top:4px;';
  newBtn.textContent = 'Start Fresh';
  newBtn.addEventListener('click', () => {
    working = kitbay.createProp('box');
    selectedPart = 0;
    renderAll();
    rebuildPreviewMesh();
  });
  saveCard.appendChild(newBtn);
  right.appendChild(saveCard);

  layout.appendChild(right);
  panel.appendChild(layout);
  host.appendChild(panel);

  /* ---------------------------------------------------------------- */
  /* parts list + tune                                                  */
  /* ---------------------------------------------------------------- */

  function depthOf(i) {
    let d = 0, cur = working.parts[i].parent, guard = 0;
    while (cur >= 0 && guard++ < 64) { d++; cur = working.parts[cur].parent; }
    return d;
  }

  function isDescendant(candidate, of) {
    let cur = candidate, guard = 0;
    while (cur >= 0 && guard++ < 64) {
      if (cur === of) return true;
      cur = working.parts[cur].parent;
    }
    return false;
  }

  function refreshParts() {
    partsList.innerHTML = '';
    working.parts.forEach((part, i) => {
      const row = document.createElement('div');
      row.className = 'stage-prefab-row';
      row.style.paddingLeft = (8 + depthOf(i) * 16) + 'px';
      if (i === selectedPart) row.style.outline = '1px solid var(--accent)';
      const label = document.createElement('span');
      label.textContent = kitbay.labelFor(part.shape) + ' ' + (i + 1);
      label.style.cursor = 'pointer';
      label.addEventListener('click', () => { selectedPart = i; renderAll(); });
      row.appendChild(label);
      const rm = document.createElement('button');
      rm.className = 'bar bad-btn';
      rm.textContent = '✕';
      rm.addEventListener('click', () => {
        if (!kitbay.removePart(working, i)) { ctx.toast('A prop needs at least one part.', true); return; }
        if (selectedPart >= working.parts.length) selectedPart = working.parts.length - 1;
        renderAll();
        rebuildPreviewMesh();
      });
      row.appendChild(rm);
      partsList.appendChild(row);
    });
  }

  function numRow(label, value, step, onInput) {
    const row = document.createElement('div');
    row.className = 'brick-row';
    const l = document.createElement('span');
    l.textContent = label; l.style.minWidth = '70px'; l.style.fontSize = '11px';
    row.appendChild(l);
    const input = document.createElement('input');
    input.type = 'number'; input.step = String(step); input.value = String(value);
    input.style.flex = '1';
    input.addEventListener('input', () => { onInput(Number(input.value) || 0); rebuildPreviewMesh(); });
    row.appendChild(input);
    return row;
  }

  function refreshTune() {
    const part = working.parts[selectedPart];
    tuneBody.innerHTML = '';
    if (!part) return;

    const colorRow = document.createElement('div');
    colorRow.className = 'brick-row';
    colorRow.innerHTML = '<span>Color:</span>';
    const colorInput = document.createElement('input');
    colorInput.type = 'color'; colorInput.value = part.swatch;
    colorInput.addEventListener('input', () => { part.swatch = colorInput.value; rebuildPreviewMesh(); });
    colorRow.appendChild(colorInput);
    tuneBody.appendChild(colorRow);

    const parentRow = document.createElement('div');
    parentRow.className = 'brick-row';
    parentRow.innerHTML = '<span>Attached to:</span>';
    const parentSel = document.createElement('select');
    parentSel.className = 'deck-select';
    const rootOpt = document.createElement('option');
    rootOpt.value = '-1'; rootOpt.textContent = '(the ground)';
    parentSel.appendChild(rootOpt);
    working.parts.forEach((p, i) => {
      if (i === selectedPart || isDescendant(i, selectedPart)) return; // no cycles
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = kitbay.labelFor(p.shape) + ' ' + (i + 1);
      parentSel.appendChild(opt);
    });
    parentSel.value = String(part.parent);
    parentSel.addEventListener('change', () => {
      part.parent = Number(parentSel.value);
      renderAll();
      rebuildPreviewMesh();
    });
    parentRow.appendChild(parentSel);
    tuneBody.appendChild(parentRow);

    const groups = [
      ['Size', part.size, ['W', 'H', 'D'], 0.1, (i, v) => { part.size[i] = Math.max(0.05, v); }],
      ['Move', part.p, ['X', 'Y', 'Z'], 0.1, (i, v) => { part.p[i] = v; }],
      ['Turn', part.r, ['X', 'Y', 'Z'], 0.1, (i, v) => { part.r[i] = v; }]
    ];
    for (const [title, arr, axes, step, set] of groups) {
      axes.forEach((axis, i) => {
        tuneBody.appendChild(numRow(title + ' ' + axis, arr[i], step, (v) => set(i, v)));
      });
    }
  }

  function renderAll() {
    refreshParts();
    refreshTune();
  }

  /* ---------------------------------------------------------------- */
  /* live preview                                                       */
  /* ---------------------------------------------------------------- */
  let engine = null;
  let mesh = null;
  let rafId = null;
  let resizeObs = null;

  function rebuildPreviewMesh() {
    if (!engine) return;
    if (mesh) { engine.contentRoot.remove(mesh); mesh.traverse((obj) => { if (obj.geometry) obj.geometry.dispose(); if (obj.material) obj.material.dispose(); }); }
    // Reuse the exact same mesh-building logic every entity in the game uses,
    // so the preview is never a lie about what placing this prop will look like.
    const fakeEntity = { id: 'preview', components: { transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, model: { parts: working.parts } } };
    mesh = buildEntityObject({ mode: '3d' }, fakeEntity);
    engine.contentRoot.add(mesh);
  }

  function startPreview() {
    engine = createEngine(canvas, { demo: false });
    engine.setMode('3d');
    engine.camera.position.set(3, 2.4, 3);
    engine.camera.lookAt(0, 0.5, 0);
    function resize() { engine.resize(canvasWrap.clientWidth, canvasWrap.clientHeight); }
    resizeObs = new ResizeObserver(resize);
    resizeObs.observe(canvasWrap);
    resize();
    rebuildPreviewMesh();

    function loop() {
      if (mesh) mesh.rotation.y += 0.012;
      if (engine) engine.tick();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
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
