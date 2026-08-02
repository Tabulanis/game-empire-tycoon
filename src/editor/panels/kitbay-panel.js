/**
 * @file kitbay-panel.js
 * @description Kit Bay tab: pick a primitive shape, tune its size and
 * color, watch it turn in a live 3D preview, and save it as a prefab.
 * Ticket P6-4. Phase 6.
 */

import * as cart from '../cartridge.js';
import * as kitbay from '../kitbay.js';
import { createEngine } from '../../engine/renderer.js';
import { buildEntityObject } from '../../engine/meshes.js';

let working = kitbay.createProp('box');

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderKitbayPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Kit Bay</h2>' +
    '<div class="sub">Pick a shape, tune it, save it as a prop you can place from the Warehouse.</div>';

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

  // ---------- right: controls ----------
  const right = document.createElement('div');
  right.className = 'deck-right';

  const shapeCard = document.createElement('div');
  shapeCard.className = 'card';
  shapeCard.innerHTML = '<h3>Shape</h3>';
  const shapeRow = document.createElement('div');
  shapeRow.className = 'stage-bar';
  shapeRow.style.flexWrap = 'wrap';
  for (const shape of kitbay.SHAPES) {
    const btn = document.createElement('button');
    btn.className = 'bar' + (working.shape === shape ? ' active' : '');
    btn.textContent = kitbay.labelFor(shape);
    btn.addEventListener('click', () => { working.shape = shape; refreshShapeButtons(); rebuildPreviewMesh(); });
    btn.dataset.shape = shape;
    shapeRow.appendChild(btn);
  }
  shapeCard.appendChild(shapeRow);
  right.appendChild(shapeCard);

  const tuneCard = document.createElement('div');
  tuneCard.className = 'card';
  tuneCard.innerHTML = '<h3>Tune</h3>';

  const colorRow = document.createElement('div');
  colorRow.className = 'brick-row';
  const colorLabel = document.createElement('span'); colorLabel.textContent = 'Color:';
  colorRow.appendChild(colorLabel);
  const colorInput = document.createElement('input');
  colorInput.type = 'color'; colorInput.value = working.swatch;
  colorInput.addEventListener('input', () => { working.swatch = colorInput.value; rebuildPreviewMesh(); });
  colorRow.appendChild(colorInput);
  tuneCard.appendChild(colorRow);

  const sizeInputs = [];
  const sizeLabels = ['Width', 'Height', 'Depth'];
  sizeLabels.forEach((label, i) => {
    const row = document.createElement('div');
    row.className = 'brick-row';
    const l = document.createElement('span'); l.textContent = label + ':'; l.style.minWidth = '60px';
    row.appendChild(l);
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0.1'; input.step = '0.1'; input.value = String(working.size[i]);
    input.addEventListener('input', () => { working.size[i] = Math.max(0.1, Number(input.value) || 1); rebuildPreviewMesh(); });
    sizeInputs.push(input);
    row.appendChild(input);
    tuneCard.appendChild(row);
  });

  const solidRow = document.createElement('div');
  solidRow.className = 'brick-row';
  const solidLabel = document.createElement('span'); solidLabel.textContent = 'Solid (blocks movement):';
  solidRow.appendChild(solidLabel);
  const solidCheck = document.createElement('input');
  solidCheck.type = 'checkbox'; solidCheck.checked = working.solid;
  solidCheck.addEventListener('change', () => { working.solid = solidCheck.checked; });
  solidRow.appendChild(solidCheck);
  tuneCard.appendChild(solidRow);

  right.appendChild(tuneCard);

  const workshopCard = document.createElement('div');
  workshopCard.className = 'card';
  const workshopToggle = document.createElement('button');
  workshopToggle.className = 'bar';
  workshopToggle.textContent = '\u25B6 Workshop Mode (advanced): custom shader';
  workshopCard.appendChild(workshopToggle);
  const workshopBody = document.createElement('div');
  workshopBody.style.display = 'none';
  workshopBody.style.marginTop = '8px';
  workshopBody.innerHTML =
    '<div class="stage-hint">Raw GLSL. Assign to <code>color</code> (vec3). ' +
    '<code>uv</code> (surface coordinate) and <code>time</code> (seconds) are available. ' +
    'A bad shader renders black instead of breaking anything else.</div>';
  const shaderEnableRow = document.createElement('div');
  shaderEnableRow.className = 'brick-row';
  const shaderEnableCheck = document.createElement('input');
  shaderEnableCheck.type = 'checkbox';
  shaderEnableCheck.addEventListener('change', () => {
    working.shader = shaderEnableCheck.checked ? (working.shader || 'color = vec3(uv.x, uv.y, 0.5);') : null;
    shaderText.style.display = shaderEnableCheck.checked ? '' : 'none';
    rebuildPreviewMesh();
  });
  shaderEnableRow.innerHTML = '<span>Use a custom shader:</span>';
  shaderEnableRow.appendChild(shaderEnableCheck);
  workshopBody.appendChild(shaderEnableRow);
  const shaderText = document.createElement('textarea');
  shaderText.rows = 5;
  shaderText.style.cssText = 'width:100%;background:var(--bg-2);border:1px solid var(--line);color:var(--ink);font-family:monospace;font-size:12px;padding:8px;display:none;';
  shaderText.value = 'color = vec3(uv.x, uv.y, 0.5);';
  shaderText.addEventListener('input', () => { working.shader = shaderText.value; rebuildPreviewMesh(); });
  workshopBody.appendChild(shaderText);
  workshopCard.appendChild(workshopBody);
  workshopToggle.addEventListener('click', () => {
    const open = workshopBody.style.display !== 'none';
    workshopBody.style.display = open ? 'none' : '';
    workshopToggle.textContent = (open ? '\u25B6' : '\u25BC') + ' Workshop Mode (advanced): custom shader';
  });
  right.appendChild(workshopCard);

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
    const slug = kitbay.savePropAsPrefab(live, nameInput.value || 'My Prop', working);
    cart.touch();
    ctx.toast('Saved "' + (nameInput.value || 'My Prop') + '" — find it in the Warehouse.');
  });
  saveCard.appendChild(saveBtn);
  right.appendChild(saveCard);

  layout.appendChild(right);
  panel.appendChild(layout);
  host.appendChild(panel);

  function refreshShapeButtons() {
    shapeRow.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.shape === working.shape);
    });
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
    const fakeEntity = { id: 'preview', components: { transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, model: { shape: working.shape, swatch: working.swatch, size: working.size } } };
    mesh = buildEntityObject({ mode: '3d' }, fakeEntity);
    engine.contentRoot.add(mesh);
  }

  function startPreview() {
    engine = createEngine(canvas, { demo: false });
    engine.setMode('3d');
    engine.camera.position.set(2.5, 2, 2.5);
    engine.camera.lookAt(0, 0, 0);
    function resize() { engine.resize(canvasWrap.clientWidth, canvasWrap.clientHeight); }
    resizeObs = new ResizeObserver(resize);
    resizeObs.observe(canvasWrap);
    resize();
    rebuildPreviewMesh();

    let previewElapsed = 0;
    function loop() {
      previewElapsed += 1 / 60;
      if (mesh) {
        mesh.rotation.y += 0.012;
        mesh.traverse((child) => {
          if (child.material && child.material.uniforms && child.material.uniforms.uTime) {
            child.material.uniforms.uTime.value = previewElapsed;
          }
        });
      }
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

  startPreview();

  const stopObs = new MutationObserver(() => {
    if (!document.body.contains(panel)) { stopObs.disconnect(); stopPreview(); }
  });
  stopObs.observe(document.body, { childList: true, subtree: true });
}
