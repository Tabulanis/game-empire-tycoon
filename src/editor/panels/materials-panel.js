/**
 * @file materials-panel.js
 * @description Material Maker tab: four PBR slot cards (Diffuse, Specular,
 * Roughness, Normal) with pattern + slider controls, a live lit turntable
 * sphere so shine and bumps actually read, and a library of saved
 * materials. The math lives in materials.js.
 */

import * as THREE from 'three';
import * as cart from '../cartridge.js';
import * as mats from '../materials.js';
import { createEngine } from '../../engine/renderer.js';

let working = mats.createMaterial('My Material');
let currentId = null;

const SLOT_LABELS = {
  diffuse: '🎨 Diffuse — the color itself',
  specular: '✨ Specular — where it shines',
  roughness: '🪨 Roughness — where it\'s dull',
  normal: '⛰ Normal — the bumps'
};

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderMaterialsPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Material Maker</h2>' +
    '<div class="sub">Build a shader out of four maps — color, shine, dullness, bumps — with sliders instead of paint. Watch it live on the sphere, then use it on anything in the 3D Shop.</div>';

  const layout = document.createElement('div');
  layout.className = 'stage-layout';

  // ---------- left: live preview ----------
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
  layout.appendChild(left);

  // ---------- right: slot cards + save + library ----------
  const right = document.createElement('div');
  right.className = 'deck-right';

  const slotBodies = {};
  for (const kind of mats.SLOT_KINDS) {
    const card = document.createElement('div');
    card.className = 'card';
    const head = document.createElement('h3');
    head.textContent = SLOT_LABELS[kind];
    card.appendChild(head);
    const body = document.createElement('div');
    card.appendChild(body);
    slotBodies[kind] = body;
    right.appendChild(card);
  }

  const saveCard = document.createElement('div');
  saveCard.className = 'card';
  saveCard.innerHTML = '<h3>Save</h3>';
  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.className = 'title-input';
  nameInput.style.cssText = 'width:100%;margin-bottom:8px;';
  nameInput.value = working.name;
  nameInput.addEventListener('change', () => { working.name = nameInput.value; });
  saveCard.appendChild(nameInput);
  const saveBtn = makeBtn('Save Material', () => {
    const live = cart.getCartridge();
    working.name = nameInput.value || working.name;
    currentId = mats.saveMaterial(live, working);
    working.id = currentId;
    cart.touch();
    ctx.toast('Saved "' + working.name + '" — paint with it in the 3D Shop\'s texture palette.');
    refreshLibrary();
  });
  saveBtn.className += ' primary';
  saveBtn.style.width = '100%';
  saveCard.appendChild(saveBtn);
  const newBtn = makeBtn('Start Fresh', () => {
    working = mats.createMaterial('My Material');
    currentId = null;
    nameInput.value = working.name;
    renderSlots();
    schedulePreview();
  });
  newBtn.style.cssText = 'width:100%;margin-top:4px;';
  saveCard.appendChild(newBtn);
  right.appendChild(saveCard);

  const libCard = document.createElement('div');
  libCard.className = 'card';
  libCard.innerHTML = '<h3>My Materials</h3>';
  const libList = document.createElement('div');
  libCard.appendChild(libList);
  right.appendChild(libCard);

  layout.appendChild(right);
  panel.appendChild(layout);
  host.appendChild(panel);

  /* ---------------------------------------------------------------- */
  /* slot controls                                                     */
  /* ---------------------------------------------------------------- */

  function sliderRow(body, label, min, max, step, value, set) {
    const row = document.createElement('div');
    row.className = 'brick-row';
    const l = document.createElement('span');
    l.textContent = label; l.style.minWidth = '70px'; l.style.fontSize = '11px';
    row.appendChild(l);
    const input = document.createElement('input');
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(value); input.style.flex = '1';
    input.addEventListener('input', () => { set(Number(input.value)); schedulePreview(); });
    row.appendChild(input);
    body.appendChild(row);
  }

  function renderSlots() {
    for (const kind of mats.SLOT_KINDS) {
      const body = slotBodies[kind];
      const slot = working.slots[kind];
      body.innerHTML = '';

      if (kind !== 'diffuse') {
        const onRow = document.createElement('div');
        onRow.className = 'brick-row';
        onRow.innerHTML = '<span style="font-size:11px;">On:</span>';
        const on = document.createElement('input');
        on.type = 'checkbox'; on.checked = slot.on;
        on.addEventListener('change', () => { slot.on = on.checked; renderSlots(); schedulePreview(); });
        onRow.appendChild(on);
        body.appendChild(onRow);
        if (!slot.on) continue;
      }

      const patRow = document.createElement('div');
      patRow.className = 'brick-row';
      patRow.innerHTML = '<span style="font-size:11px;">Pattern:</span>';
      const sel = document.createElement('select');
      sel.className = 'deck-select';
      for (const p of mats.PATTERNS) {
        const opt = document.createElement('option');
        opt.value = p; opt.textContent = p;
        if (slot.pattern === p) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => { slot.pattern = sel.value; schedulePreview(); });
      patRow.appendChild(sel);
      body.appendChild(patRow);

      sliderRow(body, 'Scale', 1, 16, 1, slot.scale, (v) => { slot.scale = v; });

      if (kind === 'diffuse') {
        for (const [key, label] of [['colorA', 'Color A'], ['colorB', 'Color B']]) {
          const row = document.createElement('div');
          row.className = 'brick-row';
          const l = document.createElement('span');
          l.textContent = label; l.style.minWidth = '70px'; l.style.fontSize = '11px';
          row.appendChild(l);
          const input = document.createElement('input');
          input.type = 'color'; input.value = slot[key];
          input.addEventListener('input', () => { slot[key] = input.value; schedulePreview(); });
          row.appendChild(input);
          body.appendChild(row);
        }
      } else if (kind === 'normal') {
        sliderRow(body, 'Depth', 0.05, 2, 0.05, slot.strength, (v) => { slot.strength = v; });
      } else {
        sliderRow(body, 'Level', 0, 1, 0.02, slot.level, (v) => { slot.level = v; });
        sliderRow(body, 'Contrast', 0, 1, 0.02, slot.strength, (v) => { slot.strength = v; });
      }
    }
  }

  function refreshLibrary() {
    const live = cart.getCartridge();
    libList.innerHTML = '';
    const list = live.assets.materials || [];
    if (!list.length) {
      libList.innerHTML = '<div class="stage-hint">No saved materials yet.</div>';
      return;
    }
    for (const m of list) {
      const row = document.createElement('div');
      row.className = 'stage-prefab-row';
      const thumb = document.createElement('img');
      thumb.src = m.maps.diffuse;
      thumb.style.cssText = 'width:24px;height:24px;border-radius:4px;image-rendering:pixelated;';
      row.appendChild(thumb);
      const label = document.createElement('span');
      label.textContent = m.name;
      label.style.cursor = 'pointer';
      label.addEventListener('click', () => {
        working = { id: m.id, name: m.name, slots: JSON.parse(JSON.stringify(m.slots)) };
        currentId = m.id;
        nameInput.value = m.name;
        renderSlots();
        schedulePreview();
      });
      row.appendChild(label);
      const del = makeBtn('✕', () => {
        if (!confirm('Delete material "' + m.name + '"?')) return;
        mats.deleteMaterial(live, m.id);
        cart.touch();
        refreshLibrary();
      });
      del.className += ' bad-btn';
      row.appendChild(del);
      libList.appendChild(row);
    }
  }

  /* ---------------------------------------------------------------- */
  /* live sphere preview                                               */
  /* ---------------------------------------------------------------- */
  let engine = null;
  let sphere = null;
  let rafId = null;
  let resizeObs = null;
  let previewTimer = null;

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(applyPreview, 120); // debounce slider streams
  }

  function applyPreview() {
    if (!sphere) return;
    const maps = mats.bakeMaterial(working);
    const old = sphere.material;
    const load = (data, srgb) => {
      const tex = new THREE.TextureLoader().load(data);
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return tex;
    };
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff' });
    m.map = load(maps.diffuse, true);
    if (maps.specular) { m.metalnessMap = load(maps.specular); m.metalness = 1; } else { m.metalness = 0.05; }
    if (maps.roughness) { m.roughnessMap = load(maps.roughness); m.roughness = 1; } else { m.roughness = 0.6; }
    if (maps.normal) m.normalMap = load(maps.normal);
    sphere.material = m;
    if (old) {
      for (const t of [old.map, old.metalnessMap, old.roughnessMap, old.normalMap]) if (t) t.dispose();
      old.dispose();
    }
  }

  function startPreview() {
    engine = createEngine(canvas, { demo: false });
    engine.setMode('3d');
    engine.camera.position.set(0, 0.6, 2.4);
    engine.camera.lookAt(0, 0.5, 0);
    sphere = new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 32), new THREE.MeshStandardMaterial());
    sphere.position.y = 0.5;
    engine.contentRoot.add(sphere);
    function resize() { engine.resize(canvasWrap.clientWidth, canvasWrap.clientHeight); }
    resizeObs = new ResizeObserver(resize);
    resizeObs.observe(canvasWrap);
    resize();
    applyPreview();
    function loop() {
      if (sphere) sphere.rotation.y += 0.008;
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
    sphere = null;
  }

  renderSlots();
  refreshLibrary();
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
