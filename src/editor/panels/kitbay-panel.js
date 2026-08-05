/**
 * @file kitbay-panel.js
 * @description Kit Bay tab: build a prop from linked parts — add primitives,
 * attach them parent/child, tune each part's size/position/rotation/color,
 * watch the assembly turn in a live 3D preview, save it as one prefab.
 * Ticket P6-4. Phase 6.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
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
  const gizmoBar = document.createElement('div');
  gizmoBar.className = 'stage-bar';
  const gizmoBtns = {};
  for (const [mode, label] of [['translate', '↖ Move'], ['rotate', '↻ Rotate'], ['scale', '⤢ Scale']]) {
    const b = document.createElement('button');
    b.className = 'bar';
    b.textContent = label;
    b.addEventListener('click', () => { gizmoMode = mode; refreshGizmo(); });
    gizmoBtns[mode] = b;
    gizmoBar.appendChild(b);
  }
  const orbitHint = document.createElement('span');
  orbitHint.className = 'stage-hint';
  orbitHint.textContent = 'drag = orbit · right-drag = pan · wheel = zoom · click a part = select';
  gizmoBar.appendChild(orbitHint);
  left.appendChild(gizmoBar);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'stage-canvas-wrap';
  canvasWrap.style.height = '52vh';
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

    const jointRow = document.createElement('div');
    jointRow.className = 'brick-row';
    jointRow.innerHTML = '<span>Connection:</span>';
    const jointSel = document.createElement('select');
    jointSel.className = 'deck-select';
    for (const [v, t] of [['fixed', 'Fixed (welded)'], ['spin', 'Spins (hinge)']]) {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = t;
      jointSel.appendChild(opt);
    }
    jointSel.value = part.joint === 'spin' ? 'spin' : 'fixed';
    jointSel.addEventListener('change', () => {
      if (jointSel.value === 'spin') { part.joint = 'spin'; part.axis = part.axis || 'y'; }
      else { delete part.joint; delete part.axis; }
      refreshTune();
      rebuildPreviewMesh();
    });
    jointRow.appendChild(jointSel);
    tuneBody.appendChild(jointRow);
    if (part.joint === 'spin') {
      const axisRow = document.createElement('div');
      axisRow.className = 'brick-row';
      axisRow.innerHTML = '<span>Spin axis:</span>';
      const axisSel = document.createElement('select');
      axisSel.className = 'deck-select';
      for (const a of ['x', 'y', 'z']) {
        const opt = document.createElement('option');
        opt.value = a; opt.textContent = a.toUpperCase();
        axisSel.appendChild(opt);
      }
      axisSel.value = part.axis || 'y';
      axisSel.addEventListener('change', () => { part.axis = axisSel.value; rebuildPreviewMesh(); });
      axisRow.appendChild(axisSel);
      tuneBody.appendChild(axisRow);
    }

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
  let orbit = null;
  let gizmo = null;
  let gizmoMode = 'translate';
  /** holder Groups by part index, for gizmo attachment */
  let holders = [];

  function refreshGizmo() {
    for (const [mode, b] of Object.entries(gizmoBtns)) b.classList.toggle('active', gizmoMode === mode);
    if (!gizmo) return;
    const holder = holders[selectedPart];
    if (holder) {
      gizmo.attach(holder);
      gizmo.setMode(gizmoMode);
      gizmo.getHelper().visible = true;
    } else {
      gizmo.detach();
      gizmo.getHelper().visible = false;
    }
  }

  function rebuildPreviewMesh() {
    if (!engine) return;
    if (gizmo) gizmo.detach();
    if (mesh) { engine.contentRoot.remove(mesh); mesh.traverse((obj) => { if (obj.geometry) obj.geometry.dispose(); if (obj.material) obj.material.dispose(); }); }
    // Reuse the exact same mesh-building logic every entity in the game uses,
    // so the workspace is never a lie about what placing this prop will look like.
    const fakeEntity = { id: 'preview', components: { transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, model: { parts: working.parts } } };
    mesh = buildEntityObject({ mode: '3d' }, fakeEntity);
    holders = [];
    mesh.traverse((obj) => {
      if (obj.userData.partIndex != null) {
        holders[obj.userData.partIndex] = obj.parent; // the transform holder Group
        if (obj.userData.partIndex === selectedPart && obj.material && obj.material.emissive) {
          obj.material.emissive = new THREE.Color('#6fd3ff');
          obj.material.emissiveIntensity = 0.35;
        }
      }
    });
    engine.contentRoot.add(mesh);
    refreshGizmo();
  }

  const raycaster = new THREE.Raycaster();
  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!engine || !mesh || !downAt) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 5) return;              // that was an orbit drag, not a pick
    if (gizmo && gizmo.dragging) return;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, engine.camera);
    const hits = raycaster.intersectObject(mesh, true);
    for (const hit of hits) {
      if (hit.object.userData.partIndex != null) {
        selectedPart = hit.object.userData.partIndex;
        renderAll();
        rebuildPreviewMesh();
        break;
      }
    }
  });

  function startPreview() {
    engine = createEngine(canvas, { demo: false });
    engine.setMode('3d');
    engine.camera.position.set(3, 2.4, 3);
    engine.camera.lookAt(0, 0.5, 0);

    // A workbench, not a turntable: ground grid + orbit camera + gizmo.
    const grid = new THREE.GridHelper(10, 20, 0x3b4a63, 0x232a3a);
    engine.scene.add(grid);

    orbit = new OrbitControls(engine.camera, canvas);
    orbit.enableDamping = false;
    orbit.screenSpacePanning = true;
    orbit.zoomToCursor = true;
    orbit.target.set(0, 0.5, 0);
    orbit.update();

    gizmo = new TransformControls(engine.camera, canvas);
    engine.scene.add(gizmo.getHelper());
    gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
    gizmo.addEventListener('objectChange', () => {
      const part = working.parts[selectedPart];
      const holder = holders[selectedPart];
      if (!part || !holder) return;
      if (gizmoMode === 'scale') {
        // scale multiplies the part's size, then the holder snaps back to 1
        for (let a = 0; a < 3; a++) part.size[a] = Math.max(0.05, part.size[a] * holder.scale.getComponent(a));
        holder.scale.set(1, 1, 1);
        rebuildPreviewMesh();
      } else {
        part.p = [round2(holder.position.x), round2(holder.position.y), round2(holder.position.z)];
        part.r = [round2(holder.rotation.x), round2(holder.rotation.y), round2(holder.rotation.z)];
      }
      refreshTune();
    });

    function resize() { engine.resize(canvasWrap.clientWidth, canvasWrap.clientHeight); }
    resizeObs = new ResizeObserver(resize);
    resizeObs.observe(canvasWrap);
    resize();
    rebuildPreviewMesh();

    function loop() {
      if (mesh) {
        mesh.traverse((obj) => {
          if (obj.userData.spin) {
            obj.rotation[obj.userData.spin.axis] += 0.05 * obj.userData.spin.speed;
          }
        });
      }
      if (engine) engine.tick();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  function stopPreview() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    if (gizmo) { gizmo.dispose(); gizmo = null; }
    if (orbit) { orbit.dispose(); orbit = null; }
    if (engine) { engine.dispose(); engine = null; }
    mesh = null;
    holders = [];
  }

  renderAll();
  startPreview();

  const stopObs = new MutationObserver(() => {
    if (!document.body.contains(panel)) { stopObs.disconnect(); stopPreview(); }
  });
  stopObs.observe(document.body, { childList: true, subtree: true });
}
