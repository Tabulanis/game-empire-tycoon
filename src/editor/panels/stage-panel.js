/**
 * @file stage-panel.js
 * @description The Stage tab: canvas + gizmo editing, scene tree, Tweakpane
 * component inspector, warehouse drag-instantiation, tile painting, prefab
 * library, and the Play/Stop inline test. Mirrors the deck-panel.js structure
 * established in Phase 1. Tickets P2-1 .. P2-8. Phase 2.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Pane } from 'tweakpane';

import { createEngine } from '../../engine/renderer.js';
import { initPhysics, debugLines, worldStats } from '../../engine/physics.js';
import { startRuntime } from '../../engine/runtime.js';
import { setEntitySource, setPhysicsSource, getWireframesEnabled } from '../../engine/debug.js';
import * as ent from '../../engine/entities.js';
import { GENERIC_TEXTURES } from '../textures.js';
import { startTour } from '../tour.js';
import BEHAVIORS from '../../data/behaviors.json';

/** module-level key dispatcher so panel re-renders never stack listeners */
let stageKeyHandler = null;
let stageKeysBound = false;
function bindStageKeys() {
  if (stageKeysBound) return;
  stageKeysBound = true;
  window.addEventListener('keydown', (e) => {
    if (stageKeyHandler) stageKeyHandler(e);
  });
}
import {
  buildSceneView,
  syncTransform,
  readTransform,
  pickEntity,
  groundPoint,
  vertexSnapDelta,
  cellAt,
  paintTile,
  eraseTile
} from '../../editor/stage.js';
import * as cart from '../../editor/cartridge.js';
import * as brickWorkshop from '../../editor/bricks.js';
import { readDragPayload, allItems } from '../../editor/warehouse.js';

/* ------------------------------------------------------------------ */
/* module-level state that survives tab re-renders                     */
/* ------------------------------------------------------------------ */
let currentSceneId = null;
let tool = 'select'; // select | paint | erase
let gizmoMode = 'translate';
let snapMode = 'off';
let gridVisible = true;
/** @type {{item: string, swatch: string, name: string}|null} */
let brush = null;

// pre-warm physics so Play is instant
const physicsReady = initPhysics().catch(() => null);

/* ------------------------------------------------------------------ */
/* panel entry point                                                   */
/* ------------------------------------------------------------------ */

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderStagePanel(host, ctx) {
  const c = cart.getCartridge();
  ent.ensureFirstScene(c);
  if (!currentSceneId || !ent.getScene(c, currentSceneId)) {
    currentSceneId = c.scenes[0].id;
  }

  setEntitySource(() => {
    const live = cart.getCartridge();
    const scene = ent.getScene(live, currentSceneId);
    if (!scene) return [];
    return scene.entities.map((e) => ({
      id: e.id, name: e.name, components: Object.keys(e.components)
    }));
  });

  const panel = document.createElement('div');
  panel.className = 'panel';

  // ---------- toolbar row 1 ----------
  const bar1 = document.createElement('div');
  bar1.className = 'stage-bar';

  const sceneSelect = document.createElement('select');
  sceneSelect.className = 'deck-select';
  sceneSelect.setAttribute('aria-label', 'Scene');
  rebuildSceneSelect(sceneSelect, c);
  bar1.appendChild(sceneSelect);

  bar1.appendChild(makeBtn('\u002B Scene', () => {
    const live = cart.getCartridge();
    const s = ent.addScene(live);
    cart.touch();
    currentSceneId = s.id;
    ctx.refresh();
  }));

  const modeSep = makeSep();
  bar1.appendChild(modeSep);

  const modeBtn = makeBtn('Mode: ' + c.settings.mode.toUpperCase(), () => {
    const live = cart.getCartridge();
    live.settings.mode = live.settings.mode === '2d' ? '3d' : '2d';
    cart.touch();
    ctx.refresh();
  });
  modeBtn.className += ' primary';
  bar1.appendChild(modeBtn);

  bar1.appendChild(makeSep());

  const playBtn = makeBtn('\u25B6 Play', null);
  playBtn.dataset.tour = 'play';
  const stopBtn = makeBtn('\u25A0 Stop', null);
  stopBtn.style.display = 'none';
  stopBtn.className += ' bad-btn';
  bar1.appendChild(playBtn);
  bar1.appendChild(stopBtn);

  panel.appendChild(bar1);

  // ---------- toolbar row 2 ----------
  const bar2 = document.createElement('div');
  bar2.dataset.tour = 'place';
  bar2.className = 'stage-bar';

  const selBtn = makeBtn('\u21F3 Select', () => setTool('select'));
  selBtn.className += ' active';
  const paintBtn = makeBtn('\u2588 Paint', () => setTool('paint'));
  const eraseBtn = makeBtn('\u2610 Erase', () => setTool('erase'));
  bar2.appendChild(selBtn);
  bar2.appendChild(paintBtn);
  bar2.appendChild(eraseBtn);
  const toolBtns = { select: selBtn, paint: paintBtn, erase: eraseBtn };

  function setTool(t) {
    tool = t;
    for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('active', k === t);
    updateGizmoAttach();
  }

  bar2.appendChild(makeSep());

  bar2.appendChild(makeBtn('\u25A1 Box', () => {
    placeEntity(ent.createEntity({ name: 'Box', components: { model: {}, body: { type: 'static' } } }));
  }));
  bar2.appendChild(makeBtn('\u25A0 Sprite', () => {
    placeEntity(ent.createEntity({ name: 'Sprite', components: { sprite: {} } }));
  }));

  bar2.appendChild(makeSep());

  for (const k of ['trigger', 'spawn', 'checkpoint', 'kill']) {
    const b = makeBtn(k[0].toUpperCase() + k.slice(1), () => placeEntity(ent.createLogicEntity(k)));
    b.style.borderColor = ent.LOGIC_COLORS[k];
    b.style.color = ent.LOGIC_COLORS[k];
    bar2.appendChild(b);
  }

  bar2.appendChild(makeSep());

  const gizmoGroup = document.createElement('span');
  gizmoGroup.dataset.tour = 'gizmo';
  gizmoGroup.style.display = 'inline-flex';
  gizmoGroup.style.gap = '4px';
  bar2.appendChild(gizmoGroup);
  const gBtns = {};
  for (const [id, label] of [['translate', 'Mv'], ['rotate', 'Rt'], ['scale', 'Sc']]) {
    const b = makeBtn(label, () => { gizmoMode = id; txControls.setMode(id); refreshGizmoBtns(); });
    if (id === 'translate') b.className += ' active';
    gBtns[id] = b;
    gizmoGroup.appendChild(b);
  }
  function refreshGizmoBtns() {
    for (const [k, b] of Object.entries(gBtns)) b.classList.toggle('active', k === gizmoMode);
  }

  const snapSelect = document.createElement('select');
  snapSelect.className = 'deck-select';
  for (const [v, l] of [['off', 'Snap: off'], ['grid1', 'Grid 1'], ['grid0.5', 'Grid 0.5'], ['vertex', 'Vertex']]) {
    const o = document.createElement('option'); o.value = v; o.textContent = l;
    snapSelect.appendChild(o);
  }
  snapSelect.value = snapMode;
  snapSelect.addEventListener('change', () => { snapMode = snapSelect.value; applySnapToGizmo(); });
  bar2.appendChild(snapSelect);

  const gridCheck = document.createElement('input');
  gridCheck.type = 'checkbox'; gridCheck.id = 'stage-grid-check'; gridCheck.checked = gridVisible;
  const gridLabel = document.createElement('label');
  gridLabel.className = 'deck-check'; gridLabel.htmlFor = 'stage-grid-check';
  gridLabel.appendChild(gridCheck);
  gridLabel.appendChild(document.createTextNode(' Grid'));
  gridCheck.addEventListener('change', () => { gridVisible = gridCheck.checked; if (gridMesh) gridMesh.visible = gridVisible; });
  bar2.appendChild(gridLabel);

  panel.appendChild(bar2);

  // ---------- main layout ----------
  const layout = document.createElement('div');
  layout.className = 'stage-layout';

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'stage-canvas-wrap';
  canvasWrap.dataset.tour = 'viewport';
  const canvas = document.createElement('canvas');
  canvas.className = 'deck-canvas';
  canvasWrap.appendChild(canvas);
  layout.appendChild(canvasWrap);

  // two rails, each with its own scroll, viewport always visible between:
  // LEFT = what you're editing (Scene, Inspector, Play Log)
  // RIGHT = what you're adding (Shelf, Prefabs, Brush, Light, Terrain)
  const leftRail = document.createElement('div');
  leftRail.className = 'stage-rail';
  const right = document.createElement('div');
  right.className = 'stage-rail';

  const treeCard = document.createElement('div');
  treeCard.dataset.tour = 'scene';
  treeCard.className = 'card';
  treeCard.innerHTML = '<h3>Scene</h3>';
  const treeList = document.createElement('div');
  treeList.className = 'stage-tree';
  treeCard.appendChild(treeList);
  leftRail.appendChild(treeCard);

  const inspCard = document.createElement('div');
  inspCard.className = 'card';
  inspCard.innerHTML = '<h3>Inspector</h3>';
  const inspMount = document.createElement('div');
  inspCard.appendChild(inspMount);
  leftRail.appendChild(inspCard);

  const shelfCard = document.createElement('div');
  shelfCard.dataset.tour = 'shelf';
  shelfCard.className = 'card';
  shelfCard.innerHTML = '<h3>Behavior Shelf</h3><div class="stage-hint">Ready-made things that already work — drop one in, then change ANY part of it in the Inspector: its look, its speed, its rules.</div>';
  const shelfGrid = document.createElement('div');
  shelfGrid.className = 'shelf-grid';
  for (const b of BEHAVIORS.behaviors) {
    const tile = document.createElement('button');
    tile.className = 'shelf-tile';
    tile.title = b.name + ' — ' + b.desc;
    tile.innerHTML = '<span class="shelf-icon">' + b.icon + '</span><span class="shelf-name">' + b.name + '</span>';
    tile.addEventListener('click', () => {
      const live = cart.getCartridge();
      // install the behavior's rule sheet once; entities share it and any
      // edit in the Rule Cards room changes every one of them together
      const sheetName = 'shelf-' + b.id;
      if (b.sheet.length && !live.bricksheets[sheetName]) {
        live.bricksheets[sheetName] = JSON.parse(JSON.stringify(b.sheet));
      }
      const spec = JSON.parse(JSON.stringify(b.entity));
      if (b.sheet.length) spec.components.bricks = { sheet: sheetName };
      // Player Starts flip the cartridge's genre controls (mode/scheme)
      if (b.set) Object.assign(live.settings, b.set);
      const entity = ent.createEntity(spec);
      placeEntity(entity);
      if (b.set && b.set.controlScheme) ctx.toast(b.name + ' placed — controls set to ' + b.set.controlScheme + '. One player per scene!');
    });
    shelfGrid.appendChild(tile);
  }
  shelfCard.appendChild(shelfGrid);
  right.appendChild(shelfCard);

  const prefabCard = document.createElement('div');
  prefabCard.className = 'card';
  prefabCard.innerHTML = '<h3>Prefabs</h3>';
  const prefabList = document.createElement('div');
  prefabCard.appendChild(prefabList);
  right.appendChild(prefabCard);

  const brushCard = document.createElement('div');
  brushCard.className = 'card';
  brushCard.innerHTML = '<h3>Tile Brush</h3>';
  const brushMount = document.createElement('div');
  brushCard.appendChild(brushMount);
  brushCard.style.display = c.settings.mode === '2d' ? '' : 'none';
  right.appendChild(brushCard);

  const lightCard = document.createElement('div');
  lightCard.dataset.tour = 'light';
  lightCard.className = 'card';
  lightCard.innerHTML = '<h3>Light & Shadows</h3>';
  const lightBody = document.createElement('div');
  lightCard.appendChild(lightBody);
  right.appendChild(lightCard);

  function getLighting() {
    const live = cart.getCartridge();
    if (!live.settings.lighting) live.settings.lighting = { shadows: 'pcf', bounce: 0.35, sunAngle: 40, sunHeight: 55 };
    return live.settings.lighting;
  }

  function refreshLightCard() {
    const cfg = getLighting();
    lightBody.innerHTML = '';
    const selRow = document.createElement('div');
    selRow.className = 'brick-row';
    selRow.innerHTML = '<span style="font-size:11px;min-width:70px;">Shadows:</span>';
    const sel = document.createElement('select');
    sel.className = 'deck-select';
    for (const [v, label] of [
      ['off', 'Off (fastest)'],
      ['blob', 'Blob — round fakes, very fast'],
      ['basic', 'Sharp — basic map'],
      ['pcf', 'Smooth — PCF'],
      ['pcfsoft', 'Soft — PCF soft'],
      ['vsm', 'Softest — VSM blur']
    ]) {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = label;
      if (cfg.shadows === v) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      cfg.shadows = sel.value;
      cart.touch();
      engine.setLighting(cfg);
    });
    selRow.appendChild(sel);
    lightBody.appendChild(selRow);

    const slide = (label, value, min, max, step, set) => {
      const row = document.createElement('div');
      row.className = 'brick-row';
      const l = document.createElement('span');
      l.textContent = label; l.style.minWidth = '70px'; l.style.fontSize = '11px';
      row.appendChild(l);
      const input = document.createElement('input');
      input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
      input.value = String(value); input.style.flex = '1';
      input.addEventListener('input', () => { set(Number(input.value)); cart.touch(); engine.setLighting(cfg); });
      row.appendChild(input);
      lightBody.appendChild(row);
    };
    slide('Bounce', cfg.bounce, 0, 1, 0.02, (v) => { cfg.bounce = v; });
    slide('Sun angle', cfg.sunAngle, 0, 360, 1, (v) => { cfg.sunAngle = v; });
    slide('Sun height', cfg.sunHeight, 10, 85, 1, (v) => { cfg.sunHeight = v; });

    /* -- volumetric haze: distance fog that melts far things into the air -- */
    if (!cfg.fog) cfg.fog = { on: false, color: '#aebdd0', density: 0.02 };
    const fogRow = document.createElement('div');
    fogRow.className = 'stage-bar';
    const fogBtn = makeBtn(cfg.fog.on ? '🌫 Haze: ON' : '🌫 Haze: off', () => {
      cfg.fog.on = !cfg.fog.on;
      cart.touch();
      engine.setLighting(cfg);
      refreshLightCard();
    });
    if (cfg.fog.on) fogBtn.className += ' active';
    fogRow.appendChild(fogBtn);
    if (cfg.fog.on) {
      const fogColor = document.createElement('input');
      fogColor.type = 'color'; fogColor.value = cfg.fog.color;
      fogColor.title = 'Haze color';
      fogColor.addEventListener('input', () => { cfg.fog.color = fogColor.value; cart.touch(); engine.setLighting(cfg); });
      fogRow.appendChild(fogColor);
    }
    lightBody.appendChild(fogRow);
    if (cfg.fog.on) {
      slide('Thickness', cfg.fog.density, 0.002, 0.09, 0.002, (v) => { cfg.fog.density = v; });
    }
    const hint = document.createElement('div');
    hint.className = 'stage-hint';
    hint.textContent = 'Blob is cheap and cartoony; the map modes trade speed for softer, realer shadows. Bounce fakes light bouncing off the ground back up.';
    lightBody.appendChild(hint);
  }

  const terrainCard = document.createElement('div');
  terrainCard.dataset.tour = 'terrain';
  terrainCard.className = 'card';
  terrainCard.innerHTML = '<h3>Terrain</h3><div class="stage-hint">The ground under your level.</div>';
  const terrainBody = document.createElement('div');
  terrainCard.appendChild(terrainBody);
  right.appendChild(terrainCard);

  function getTerrainScene() {
    return ent.getScene(cart.getCartridge(), currentSceneId);
  }

  /* ---- terrain sculpting brush (Blender/ZBrush style) ---- */
  let activeSlot = 0;
  let brushOp = 'raise'; // raise | lower | paint | scatter
  let scatterChoice = 'tree';
  const SCATTER_PROPS = {
    tree: { name: 'Tree', icon: '🌲', parts: [
      { shape: 'cylinder', swatch: '#6b4a2b', size: [0.14, 0.5, 0.14], p: [0, 0.25, 0], r: [0, 0, 0], parent: -1 },
      { shape: 'cone', swatch: '#3f7d4c', size: [0.55, 0.8, 0.55], p: [0, 0.65, 0], r: [0, 0, 0], parent: 0 }
    ]},
    rock: { name: 'Rock', icon: '🪨', parts: [
      { shape: 'sphere', swatch: '#8a8f99', size: [0.45, 0.3, 0.4], p: [0, 0.13, 0], r: [0.2, 0.5, 0], parent: -1 }
    ]},
    bush: { name: 'Bush', icon: '🌿', parts: [
      { shape: 'sphere', swatch: '#4d8a4d', size: [0.5, 0.35, 0.5], p: [0, 0.16, 0], r: [0, 0, 0], parent: -1 }
    ]},
    flower: { name: 'Flower', icon: '🌼', parts: [
      { shape: 'cylinder', swatch: '#5c8a4d', size: [0.04, 0.3, 0.04], p: [0, 0.15, 0], r: [0, 0, 0], parent: -1 },
      { shape: 'sphere', swatch: '#ffcf6e', size: [0.16, 0.16, 0.16], p: [0, 0.34, 0], r: [0, 0, 0], parent: 0 }
    ]}
  };
  /** smooth-mode painting: one white-on-black alpha mask per layer —
   * white blobs are where that layer shows. Serialized to terrain.masks. */
  const SPLAT_SIZE = 256;
  let maskCanvases = [null, null, null];
  let maskDirty = false;

  function ensureMask(t, i) {
    if (maskCanvases[i]) return maskCanvases[i];
    const c = document.createElement('canvas');
    c.width = c.height = SPLAT_SIZE;
    const g = c.getContext('2d');
    g.fillStyle = '#000000';
    g.fillRect(0, 0, SPLAT_SIZE, SPLAT_SIZE);
    if (t.masks && t.masks[i]) {
      const img = new Image();
      img.onload = () => { g.drawImage(img, 0, 0, SPLAT_SIZE, SPLAT_SIZE); pushMask(i); };
      img.src = t.masks[i];
    }
    maskCanvases[i] = c;
    return c;
  }

  function pushMask(i) {
    engine.scene.traverse((obj) => {
      if (obj.userData.maskTextures && obj.userData.maskTextures[i]) {
        obj.userData.maskTextures[i].image = maskCanvases[i];
        obj.userData.maskTextures[i].needsUpdate = true;
      }
    });
  }

  function maskBlob(t, wx, wz, radiusWorld) {
    const i = activeSlot;
    const c = ensureMask(t, i);
    const g = c.getContext('2d');
    const u = (wx + t.size[0] / 2) / t.size[0];
    // the GPU flips canvas textures vertically on upload (flipY), so canvas
    // rows run the same direction as world z — no inversion here
    const v = (wz + t.size[1] / 2) / t.size[1];
    const cx = u * SPLAT_SIZE, cy = v * SPLAT_SIZE;
    const r = Math.max(2, (radiusWorld / t.size[0]) * SPLAT_SIZE);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalCompositeOperation = 'lighter'; // strokes accumulate softly
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    maskDirty = true;
    pushMask(i);
  }

  function commitMasks(t) {
    if (!maskDirty) return;
    if (!t.masks) t.masks = [null, null, null];
    for (let i = 0; i < 3; i++) {
      if (maskCanvases[i]) t.masks[i] = maskCanvases[i].toDataURL('image/png');
    }
    maskDirty = false;
    cart.touch();
  }

  let scatterSeed = 1;
  function scatterRand() {
    scatterSeed = (scatterSeed * 16807) % 2147483647;
    return scatterSeed / 2147483647;
  }
  let brushRadius = 1.5; // in cells
  let stroking = false;
  /** cells already touched this stroke, so raise/lower step once per pass */
  let strokeSet = new Set();
  let brushRing = null;
  /** live status element in the Terrain card — the brush narrates itself */
  let brushStatusEl = null;

  function brushStatus(msg) {
    if (brushStatusEl) brushStatusEl.textContent = msg;
  }

  function terrainReady() {
    const scene = getTerrainScene();
    const t = scene && scene.terrain;
    return t && engine.mode === '3d' ? t : null;
  }

  function showBrushRing(pt) {
    const t = terrainReady();
    if (!t || !pt) { hideBrushRing(); return; }
    if (!brushRing) {
      brushRing = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1, 32),
        new THREE.MeshBasicMaterial({ color: '#ffcf6e', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false })
      );
      brushRing.rotation.x = -Math.PI / 2;
      brushRing.renderOrder = 998;
      engine.scene.add(brushRing);
    }
    const r = brushRadius * (t.cell || 1);
    brushRing.scale.set(r, r, 1);
    brushRing.position.set(pt[0], 0.05, pt[2]);
  }

  function hideBrushRing() {
    if (brushRing) { engine.scene.remove(brushRing); brushRing = null; }
  }

  function applyBrush(ndc) {
    const scene = getTerrainScene();
    const t = terrainReady();
    if (!t) return;
    const pt = groundPoint(engine, ndc);
    if (!pt) return;
    showBrushRing(pt);
    const cell = t.cell || 1;
    const r = brushRadius * cell;
    if (!t.cells) t.cells = {};
    if (t.smooth && brushOp === 'paint') {
      // alpha painting: a soft white blob into the picked layer's mask
      maskBlob(t, pt[0], pt[2], r);
      return;
    }
    const cols = Math.ceil(t.size[0] / cell), rows = Math.ceil(t.size[1] / cell);
    let changed = false;
    const c0 = Math.max(0, Math.floor((pt[0] - r + t.size[0] / 2) / cell));
    const c1 = Math.min(cols - 1, Math.floor((pt[0] + r + t.size[0] / 2) / cell));
    const r0 = Math.max(0, Math.floor((pt[2] - r + t.size[1] / 2) / cell));
    const r1 = Math.min(rows - 1, Math.floor((pt[2] + r + t.size[1] / 2) / cell));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cx = -t.size[0] / 2 + (col + 0.5) * cell;
        const cz = -t.size[1] / 2 + (row + 0.5) * cell;
        if (Math.hypot(cx - pt[0], cz - pt[2]) > r) continue;
        const key = row + ',' + col;
        if (brushOp === 'scatter') {
          if (strokeSet.has(key)) continue;
          strokeSet.add(key);
          if (scatterRand() > 0.45) continue; // sparse feels natural
          const prop = SCATTER_PROPS[scatterChoice];
          const cellEntry = (t.cells || {})[key];
          const groundY = cellEntry && cellEntry.h ? cellEntry.h * 0.5 : 0;
          const px2 = -t.size[0] / 2 + (col + scatterRand()) * cell;
          const pz2 = -t.size[1] / 2 + (row + scatterRand()) * cell;
          const sc2 = 0.7 + scatterRand() * 0.6;
          const entity = ent.createEntity({
            name: prop.name,
            components: {
              transform: { p: [px2, groundY, pz2], r: [0, scatterRand() * 6.28, 0], s: [sc2, sc2, sc2] },
              model: { parts: JSON.parse(JSON.stringify(prop.parts)) }
            }
          });
          ent.addEntity(scene, entity);
          view.refreshEntity(entity.id);
          changed = true;
          continue;
        }
        if (!t.cells[key]) t.cells[key] = { l: null, h: 0 };
        const entry = t.cells[key];
        if (brushOp === 'paint') {
          if (entry.l !== activeSlot) { entry.l = activeSlot; changed = true; }
        } else if (brushOp === 'soften' || brushOp === 'roughen') {
          const dist = Math.hypot(cx - pt[0], cz - pt[2]) / r;
          const fall = (1 - dist) * (1 - dist);
          if (brushOp === 'soften') {
            // pull toward the neighbor average — irons out bumps and steps
            const n = (dr, dc) => {
              const e2 = t.cells[(row + dr) + ',' + (col + dc)];
              return e2 ? (e2.h || 0) : 0;
            };
            const avg = (n(-1, 0) + n(1, 0) + n(0, -1) + n(0, 1)) / 4;
            entry.h = Math.max(0, Math.min(8, (entry.h || 0) + (avg - (entry.h || 0)) * 0.35 * fall));
          } else {
            scatterSeed = (scatterSeed * 16807) % 2147483647;
            const jitter = (scatterSeed / 2147483647 - 0.5) * 0.5;
            entry.h = Math.max(0, Math.min(8, (entry.h || 0) + jitter * fall));
          }
          changed = true;
        } else if (t.smooth) {
          // smooth sculpting: fractional height with quadratic falloff —
          // continuous while dragging, so hills grow like clay
          const dist = Math.hypot(cx - pt[0], cz - pt[2]) / r;
          const fall = (1 - dist) * (1 - dist) * 0.12;
          if (brushOp === 'raise') entry.h = Math.min(8, (entry.h || 0) + fall);
          else entry.h = Math.max(0, (entry.h || 0) - fall);
          changed = true;
        } else if (!strokeSet.has(key)) {
          strokeSet.add(key);
          if (brushOp === 'raise') entry.h = Math.min(8, (entry.h || 0) + 1);
          else entry.h = Math.max(0, (entry.h || 0) - 1);
          changed = true;
        }
        if (entry.l == null && entry.t == null && !entry.h) delete t.cells[key];
      }
    }
    if (changed) {
      cart.touch();
      if (brushOp === 'scatter') refreshTree();
      else view.refreshTerrain(scene);
    }
  }

  function terrainChanged() {
    cart.touch();
    view.refreshTerrain(getTerrainScene());
    refreshTerrainCard();
  }

  function refreshTerrainCard() {
    const scene = getTerrainScene();
    if (!scene) return;
    terrainBody.innerHTML = '';
    const t = scene.terrain;

    if (!t) {
      const addBtn = makeBtn('+ Add ground', () => {
        scene.terrain = {
          texture: null, textureName: null, mode: 'stretch', repeat: 4, cell: 1,
          size: [20, 20], color: '#3a3f4c',
          layers: GENERIC_TEXTURES.slice(0, 3).map((g) => ({ id: g.id, dataURL: g.dataURL })),
          cells: {}
        };
        terrainChanged();
      });
      addBtn.style.width = '100%';
      terrainBody.appendChild(addBtn);
      return;
    }
    if (!t.layers) t.layers = (t.palette || GENERIC_TEXTURES.slice(0, 3)).slice(0, 3).map((g) => ({ id: g.id, dataURL: g.dataURL }));

    if (engine.mode !== '3d') {
      const hint = document.createElement('div');
      hint.className = 'stage-hint';
      hint.textContent = 'Terrain painting works in 3D scenes.';
      terrainBody.appendChild(hint);
    } else {
      /* ---- the brush, front and center ---- */
      const styleRow = document.createElement('div');
      styleRow.className = 'stage-bar';
      const styleLabel = document.createElement('span');
      styleLabel.textContent = 'Style:'; styleLabel.style.fontSize = '11px';
      styleRow.appendChild(styleLabel);
      for (const [val, label] of [[false, '⬜ Blocky'], [true, '🌊 Smooth']]) {
        const b = makeBtn(label, () => {
          t.smooth = val;
          maskCanvases = [null, null, null];
          terrainChanged();
        });
        if (!!t.smooth === val) b.className += ' active';
        styleRow.appendChild(b);
      }
      terrainBody.appendChild(styleRow);

      /* -- Water: shallow-water liquid over the terrain (TheBlob's fluid) -- */
      const wDefaults = { on: false, level: 1, color: '#2e86d9', opacity: 0.72, wave: 0.06, speed: 1, detail: 1, react: 0.5 };
      if (!t.water) t.water = { ...wDefaults };
      const w = t.water;
      const waterChanged = () => { cart.touch(); view.refreshTerrain(getTerrainScene()); };
      const wRow = document.createElement('div');
      wRow.className = 'stage-bar';
      const wBtn = makeBtn(w.on ? '💧 Water: ON' : '💧 Water: off', () => {
        w.on = !w.on;
        waterChanged();
        refreshTerrainCard();
      });
      if (w.on) wBtn.className += ' active';
      wRow.appendChild(wBtn);
      if (w.on) {
        const wColor = document.createElement('input');
        wColor.type = 'color'; wColor.value = w.color || '#2e86d9';
        wColor.title = 'Water color';
        wColor.addEventListener('input', () => { w.color = wColor.value; waterChanged(); });
        wRow.appendChild(wColor);
        const wDetail = makeBtn(w.detail >= 2 ? '🔬 Fine' : '🧊 Chunky', () => {
          w.detail = w.detail >= 2 ? 1 : 2;
          waterChanged();
          refreshTerrainCard();
        });
        wRow.appendChild(wDetail);
      }
      terrainBody.appendChild(wRow);
      if (w.on) {
        const wSlide = (label, key, min, max, step) => {
          const row = document.createElement('div');
          row.className = 'brick-row';
          const l = document.createElement('span');
          l.textContent = label; l.style.minWidth = '70px'; l.style.fontSize = '11px';
          row.appendChild(l);
          const input = document.createElement('input');
          input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
          input.value = String(w[key] !== undefined ? w[key] : wDefaults[key]); input.style.flex = '1';
          input.addEventListener('change', () => { w[key] = Number(input.value); waterChanged(); });
          row.appendChild(input);
          terrainBody.appendChild(row);
        };
        wSlide('Level', 'level', 0, 4, 0.1);
        wSlide('Waves', 'wave', 0, 0.3, 0.01);
        wSlide('Tempo', 'speed', 0.2, 3, 0.1);
        wSlide('See-thru', 'opacity', 0.2, 1, 0.02);
        wSlide('Reactive', 'react', 0, 1, 0.05);
        const wHint = document.createElement('div');
        wHint.className = 'stage-hint';
        wHint.textContent = 'Water fills every valley below the Level line — sculpt basins and they become lakes. Reactive makes it flow and splash when the player wades through; 0 freezes it solid-still.';
        terrainBody.appendChild(wHint);
      }

      const sculptBtn = makeBtn(tool === 'terrain' ? '✔ Done with the brush' : '🖌 Paint & Sculpt', () => {
        setTool(tool === 'terrain' ? 'select' : 'terrain');
        // while the brush is armed the left mouse belongs to it — zoom
        // stays on the wheel, rotate/pan come back on Done
        orbitControls.enableRotate = tool !== 'terrain';
        orbitControls.enablePan = tool !== 'terrain';
        canvas.style.cursor = tool === 'terrain' ? 'crosshair' : '';
        if (tool !== 'terrain') hideBrushRing();
        else showBrushRing([0, 0, 0]); // proof of life: ring appears immediately at center
        refreshTerrainCard();
      });
      sculptBtn.className += tool === 'terrain' ? ' active' : ' primary';
      sculptBtn.style.cssText = 'width:100%;margin-bottom:6px;';
      terrainBody.appendChild(sculptBtn);

      if (tool === 'terrain') {
        const opRow = document.createElement('div');
        opRow.className = 'stage-bar';
        for (const [op, label] of [['raise', '▲ Raise'], ['lower', '▼ Lower'], ['soften', '🫧 Soften'], ['roughen', '⛰ Roughen'], ['paint', '🖌 Paint'], ['scatter', '🌲 Scatter']]) {
          const b = makeBtn(label, () => { brushOp = op; refreshTerrainCard(); });
          if (brushOp === op) b.className += ' active';
          opRow.appendChild(b);
        }
        terrainBody.appendChild(opRow);

        const sizeRow = document.createElement('div');
        sizeRow.className = 'brick-row';
        const sl = document.createElement('span');
        sl.textContent = 'Brush size'; sl.style.minWidth = '70px'; sl.style.fontSize = '11px';
        sizeRow.appendChild(sl);
        const sizeInput = document.createElement('input');
        sizeInput.type = 'range'; sizeInput.min = '0.5'; sizeInput.max = '5'; sizeInput.step = '0.25';
        sizeInput.value = String(brushRadius); sizeInput.style.flex = '1';
        sizeInput.addEventListener('input', () => { brushRadius = Number(sizeInput.value); });
        sizeRow.appendChild(sizeInput);
        terrainBody.appendChild(sizeRow);

        brushStatusEl = document.createElement('div');
        brushStatusEl.className = 'stage-hint';
        brushStatusEl.style.cssText = 'color:var(--gold);min-height:16px;';
        brushStatusEl.textContent = 'Move the mouse over the ground…';
        terrainBody.appendChild(brushStatusEl);

        if (brushOp === 'scatter') {
          const scRow = document.createElement('div');
          scRow.className = 'stage-bar';
          for (const [id2, prop] of Object.entries(SCATTER_PROPS)) {
            const b = makeBtn(prop.icon + ' ' + prop.name, () => { scatterChoice = id2; refreshTerrainCard(); });
            if (scatterChoice === id2) b.className += ' active';
            scRow.appendChild(b);
          }
          terrainBody.appendChild(scRow);
          const scHint = document.createElement('div');
          scHint.className = 'stage-hint';
          scHint.textContent = 'Drag to sprinkle them across the ground — random sizes and turns, sitting on raised cells. They become normal things you can select and delete.';
          terrainBody.appendChild(scHint);
        }

        const layersHead = document.createElement('div');
        layersHead.className = 'stage-hint';
        layersHead.textContent = 'Texture layers — Paint uses the picked one (keys 1-3):';
        terrainBody.appendChild(layersHead);
        const slotStrip = document.createElement('div');
        slotStrip.className = 'kit-tex-grid';
        slotStrip.style.marginBottom = '6px';
        t.layers.forEach((slot, i) => {
          const tile = document.createElement('button');
          tile.className = 'kit-tex-tile' + (i === activeSlot ? ' active' : '');
          tile.title = 'Layer ' + (i + 1) + ' — click to paint with it; pick a texture below to change it';
          const img = document.createElement('img');
          img.src = slot.dataURL;
          tile.appendChild(img);
          const num = document.createElement('span');
          num.className = 'kit-slot-num';
          num.textContent = String(i + 1);
          tile.appendChild(num);
          tile.addEventListener('click', () => { activeSlot = i; refreshTerrainCard(); });
          slotStrip.appendChild(tile);
        });
        terrainBody.appendChild(slotStrip);

        // the picked layer's own mapping — layers can each map differently
        const layer = t.layers[activeSlot];
        if (layer) {
          const mapRow = document.createElement('div');
          mapRow.className = 'stage-bar';
          const mapLabel = document.createElement('span');
          mapLabel.textContent = 'Layer ' + (activeSlot + 1) + ' maps as:';
          mapLabel.style.fontSize = '11px';
          mapRow.appendChild(mapLabel);
          for (const [mode, label] of [['grid', 'Grid'], ['big', 'One Big'], ['tiled', 'Tiled']]) {
            const b = makeBtn(label, () => { layer.map = mode; terrainChanged(); });
            if ((layer.map || 'grid') === mode) b.className += ' active';
            mapRow.appendChild(b);
          }
          terrainBody.appendChild(mapRow);
          if ((layer.map || 'grid') === 'tiled') {
            const repRow = document.createElement('div');
            repRow.className = 'brick-row';
            const rl = document.createElement('span');
            rl.textContent = 'Repeats'; rl.style.minWidth = '70px'; rl.style.fontSize = '11px';
            repRow.appendChild(rl);
            const rep = document.createElement('input');
            rep.type = 'number'; rep.min = '1'; rep.max = '64'; rep.step = '1';
            rep.value = String(layer.repeat || 6); rep.style.width = '70px';
            rep.addEventListener('change', () => { layer.repeat = Math.max(1, Math.min(64, Number(rep.value) || 6)); terrainChanged(); });
            repRow.appendChild(rep);
            terrainBody.appendChild(repRow);
          }
        }

        const how = document.createElement('div');
        how.className = 'stage-hint';
        how.style.lineHeight = '1.6';
        how.textContent = 'Drag across the ground — the gold ring is your brush. Raise piles the ground up, Lower digs it down, Paint colors it with the picked layer. Pick a texture below to change what the picked layer looks like.';
        terrainBody.appendChild(how);
      }
    }

    /* ---- textures: base ground, or re-arming the picked layer while sculpting ---- */
    const texHead = document.createElement('div');
    texHead.className = 'stage-hint';
    texHead.textContent = tool === 'terrain'
      ? 'Click a texture → it becomes Layer ' + (activeSlot + 1) + ':'
      : 'Base ground texture:';
    terrainBody.appendChild(texHead);
    const grid = document.createElement('div');
    grid.className = 'kit-tex-grid';
    const addTile = (entry) => {
      const tile = document.createElement('button');
      const active = tool === 'terrain'
        ? (entry && t.layers[activeSlot] && t.layers[activeSlot].id === entry.id)
        : (entry ? t.textureName === entry.id : !t.texture);
      tile.className = 'kit-tex-tile' + (active ? ' active' : '');
      tile.title = entry ? entry.name : 'Plain color';
      if (entry) {
        const img = document.createElement('img');
        img.src = entry.dataURL;
        tile.appendChild(img);
      } else {
        tile.textContent = '∅';
      }
      tile.addEventListener('click', () => {
        if (tool === 'terrain' && entry) {
          t.layers[activeSlot] = entry.maps
            ? { id: entry.id, dataURL: entry.dataURL, maps: entry.maps }
            : { id: entry.id, dataURL: entry.dataURL };
        } else if (entry) {
          t.texture = entry.dataURL; t.textureName = entry.id;
        } else {
          t.texture = null; t.textureName = null;
        }
        terrainChanged();
      });
      grid.appendChild(tile);
    };
    if (tool !== 'terrain') addTile(null);
    for (const g of GENERIC_TEXTURES) addTile(g);
    for (const sprite of cart.getCartridge().assets.sprites) {
      addTile({ id: sprite.id, name: sprite.name, dataURL: (sprite.frames[0] && sprite.frames[0].dataURL) || sprite.thumbnail });
    }
    terrainBody.appendChild(grid);

    const modeRow = document.createElement('div');
    modeRow.className = 'stage-bar';
    modeRow.style.marginTop = '8px';
    for (const [mode, label] of [['stretch', 'One Big'], ['repeat', 'Tiled'], ['grid', 'Grid']]) {
      const b = makeBtn(label, () => { t.mode = mode; terrainChanged(); });
      if ((t.mode || 'stretch') === mode) b.className += ' active';
      modeRow.appendChild(b);
    }
    terrainBody.appendChild(modeRow);

    const numRow = (label, value, min, max, step, set) => {
      const row = document.createElement('div');
      row.className = 'brick-row';
      const l = document.createElement('span');
      l.textContent = label; l.style.minWidth = '70px'; l.style.fontSize = '11px';
      row.appendChild(l);
      const input = document.createElement('input');
      input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step);
      input.value = String(value); input.style.width = '70px';
      input.addEventListener('change', () => { set(Math.max(min, Math.min(max, Number(input.value) || value))); terrainChanged(); });
      row.appendChild(input);
      terrainBody.appendChild(row);
    };
    if (t.mode === 'repeat') numRow('Tiles across', t.repeat || 4, 1, 64, 1, (v) => { t.repeat = v; });
    numRow('Brush cell', t.cell || 1, 0.25, 8, 0.25, (v) => { t.cell = v; });
    numRow('Width', t.size[0], 4, 200, 1, (v) => { t.size[0] = v; });
    numRow('Depth', t.size[1], 4, 200, 1, (v) => { t.size[1] = v; });

    const removeBtn = makeBtn('Remove ground', () => {
      scene.terrain = null;
      setTool('select');
      orbitControls.enableRotate = true;
      orbitControls.enablePan = true;
      hideBrushRing();
      terrainChanged();
    });
    removeBtn.className += ' bad-btn';
    removeBtn.style.cssText = 'width:100%;margin-top:6px;';
    terrainBody.appendChild(removeBtn);
  }

  bindStageKeys();
  stageKeyHandler = (e) => {
    const tag0 = e.target && e.target.tagName;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && tag0 !== 'INPUT' && tag0 !== 'TEXTAREA' && tag0 !== 'SELECT') {
      if (document.body.contains(panel) && selectedId && !playSession) {
        e.preventDefault();
        const l3 = cart.getCartridge();
        const s3 = ent.getScene(l3, currentSceneId);
        const original = s3 && s3.entities.find((en) => en.id === selectedId);
        if (original) {
          const copy = ent.deepClone(original);
          copy.name = original.name + ' copy';
          if (copy.components.transform) copy.components.transform.p[0] += 1;
          ent.addEntity(s3, copy);
          view.refreshEntity(copy.id);
          cart.touch();
          selectEntity(copy.id);
          refreshTree();
          ctx.toast('Duplicated: ' + copy.name);
        }
        return;
      }
    }
    if (e.key === 'Tab' && tag0 !== 'INPUT' && tag0 !== 'TEXTAREA' && tag0 !== 'SELECT') {
      if (document.body.contains(panel)) {
        e.preventDefault();
        if (playSession) doStop(); else doPlay();
        return;
      }
    }
    if (playSession || tool !== 'terrain') return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!document.body.contains(panel)) return;
    if (e.key >= '1' && e.key <= '3') {
      activeSlot = Number(e.key) - 1;
      refreshTerrainCard();
      e.preventDefault();
    }
  };

  const logCard = document.createElement('div');
  logCard.className = 'card';
  logCard.innerHTML = '<h3>Play Log</h3>';
  const logList = document.createElement('div');
  logList.className = 'deck-log';
  logCard.appendChild(logList);
  leftRail.appendChild(logCard);

  layout.appendChild(right);
  layout.insertBefore(leftRail, layout.firstChild);
  panel.appendChild(layout);
  host.appendChild(panel);

  /* ---------------------------------------------------------------- */
  /* engine + controls                                                 */
  /* ---------------------------------------------------------------- */
  const engine = createEngine(canvas, { demo: false });
  engine.resolveSpriteAsset = (assetId) => {
    const live = cart.getCartridge();
    const sprite = (live.assets.sprites || []).find((s) => s.id === assetId);
    return sprite && sprite.frames && sprite.frames[0] ? sprite.frames[0].dataURL : null;
  };
  engine.resolveModelAsset = (assetId) => {
    const live = cart.getCartridge();
    return (live.assets.models || []).find((m) => m.id === assetId) || null;
  };
  engine.setMode(c.settings.mode);

  const gridMesh = new THREE.GridHelper(20, 20, 0x2c3446, 0x2c3446);
  if (c.settings.mode === '2d') gridMesh.rotation.x = Math.PI / 2;
  gridMesh.position.z = c.settings.mode === '2d' ? -0.5 : 0;
  gridMesh.visible = gridVisible;
  engine.scene.add(gridMesh);

  const orbitControls = new OrbitControls(engine.camera, canvas);
  orbitControls.enableDamping = false;
  orbitControls.screenSpacePanning = true;
  if (c.settings.mode === '2d') {
    orbitControls.mouseButtons.LEFT = -1;
    orbitControls.enableRotate = false;
  }
  orbitControls.zoomToCursor = true;

  const txControls = new TransformControls(engine.camera, canvas);
  txControls.setMode(gizmoMode);
  engine.scene.add(txControls.getHelper());

  // initial scene view
  const firstScene = ent.getScene(c, currentSceneId);
  const tourBtn = makeBtn('🎓 Show me around', () => startTour('stage', panel));
  bar1.appendChild(tourBtn);

  const view = buildSceneView(engine, firstScene, { play: false });
  // first visit: offer the tour once, remember forever after
  if (!localStorage.getItem('get-tour-stage')) {
    localStorage.setItem('get-tour-stage', 'seen');
    setTimeout(() => startTour('stage', panel), 600);
  }
  engine.setLighting(getLighting());
  refreshLightCard();
  refreshTerrainCard();

  /* ---------------------------------------------------------------- */
  /* selection state                                                   */
  /* ---------------------------------------------------------------- */
  let selectedId = null;
  let selectionBox = null;
  /** @type {Pane|null} */
  let pane = null;
  /** @type {any|null} */
  let playSession = null;
  const playLogMessages = [];

  function updateGizmoAttach() {
    const obj = selectedId ? view.objects.get(selectedId) : null;
    if (obj && tool === 'select') {
      txControls.attach(obj);
      txControls.setMode(gizmoMode);
      txControls.getHelper().visible = true;
    } else {
      txControls.detach();
      txControls.getHelper().visible = false;
    }
  }

  function applySnapToGizmo() {
    if (snapMode === 'grid1') {
      txControls.setTranslationSnap(1);
      txControls.setRotationSnap(THREE.MathUtils.degToRad(15));
      txControls.setScaleSnap(0.25);
    } else if (snapMode === 'grid0.5') {
      txControls.setTranslationSnap(0.5);
      txControls.setRotationSnap(THREE.MathUtils.degToRad(15));
      txControls.setScaleSnap(0.1);
    } else {
      txControls.setTranslationSnap(null);
      txControls.setRotationSnap(null);
      txControls.setScaleSnap(null);
    }
  }
  applySnapToGizmo();

  // vertex snap on drag end
  txControls.addEventListener('dragging-changed', (e) => {
    orbitControls.enabled = !e.value;
    if (!e.value && selectedId && snapMode === 'vertex') {
      const obj = view.objects.get(selectedId);
      if (obj) {
        const delta = vertexSnapDelta(obj, view, selectedId);
        if (delta) {
          obj.position.add(delta);
          const live = cart.getCartridge();
          const sc = ent.getScene(live, currentSceneId);
          const entity = ent.findEntity(sc, selectedId);
          if (entity) { readTransform(entity, obj, engine.mode); cart.touch(); }
        }
      }
    }
    if (!e.value) flushEntitySync();
  });

  let tcThrottle = null;
  txControls.addEventListener('objectChange', () => {
    clearTimeout(tcThrottle);
    tcThrottle = setTimeout(flushEntitySync, 40);
  });

  function flushEntitySync() {
    if (!selectedId) return;
    const live = cart.getCartridge();
    const sc = ent.getScene(live, currentSceneId);
    const entity = ent.findEntity(sc, selectedId);
    const obj = view.objects.get(selectedId);
    if (!entity || !obj) return;
    readTransform(entity, obj, engine.mode);
    cart.touch();
    refreshInspector();
  }

  function selectEntity(id) {
    selectedId = id;
    updateGizmoAttach();
    if (selectionBox) { engine.scene.remove(selectionBox); selectionBox = null; }
    if (id) {
      const obj = view.objects.get(id);
      if (obj) {
        const box = new THREE.Box3().setFromObject(obj);
        if (!box.isEmpty()) {
          selectionBox = new THREE.Box3Helper(box, new THREE.Color(0x6fd3ff));
          engine.scene.add(selectionBox);
        }
      }
    }
    refreshTree();
    refreshInspector();
  }

  function deselect() { selectEntity(null); }

  /* ---------------------------------------------------------------- */
  /* scene tree                                                        */
  /* ---------------------------------------------------------------- */
  function refreshTree() {
    const live = cart.getCartridge();
    const sc = ent.getScene(live, currentSceneId);
    treeList.innerHTML = '';
    if (!sc) return;
    for (const entity of sc.entities) {
      const row = document.createElement('div');
      row.className = 'stage-tree-row' + (entity.id === selectedId ? ' selected' : '');
      const dot = document.createElement('span');
      dot.className = 'stage-dot';
      const lc = entity.components.logic;
      dot.style.background = lc ? (ent.LOGIC_COLORS[lc.kind] || '#6fd3ff') : '#6fd3ff';
      row.appendChild(dot);
      const label = document.createElement('span');
      label.textContent = entity.name + ' (' + entity.id + ')';
      row.appendChild(label);
      row.addEventListener('click', () => selectEntity(entity.id));
      treeList.appendChild(row);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Tweakpane inspector                                               */
  /* ---------------------------------------------------------------- */
  function refreshInspector() {
    inspMount.innerHTML = '';
    if (pane) { pane.dispose(); pane = null; }
    if (!selectedId) {
      inspMount.innerHTML = '<div class="stage-hint">Nothing selected</div>';
      return;
    }
    const live = cart.getCartridge();
    const sc = ent.getScene(live, currentSceneId);
    const entity = ent.findEntity(sc, selectedId);
    if (!entity) return;

    pane = new Pane({ container: inspMount });

    const t = entity.components.transform;
    const tProxy = { px: t.p[0], py: t.p[1], pz: t.p[2], rx: t.r[0], ry: t.r[1], rz: t.r[2], sx: t.s[0], sy: t.s[1], sz: t.s[2] };

    function applyProxy() {
      entity.components.transform.p = [tProxy.px, tProxy.py, engine.mode === '2d' ? t.p[2] : tProxy.pz];
      entity.components.transform.r = [tProxy.rx, tProxy.ry, tProxy.rz];
      entity.components.transform.s = [tProxy.sx, tProxy.sy, tProxy.sz];
      const obj = view.objects.get(entity.id);
      if (obj) syncTransform(obj, entity, engine.mode);
      cart.touch();
    }

    const tf = pane.addFolder({ title: 'Transform', expanded: true });
    tf.addBinding(tProxy, 'px', { label: 'x' }).on('change', applyProxy);
    tf.addBinding(tProxy, 'py', { label: 'y' }).on('change', applyProxy);
    if (engine.mode === '3d') {
      tf.addBinding(tProxy, 'pz', { label: 'z' }).on('change', applyProxy);
      tf.addBinding(tProxy, 'rx', { label: 'rx' }).on('change', applyProxy);
      tf.addBinding(tProxy, 'ry', { label: 'ry' }).on('change', applyProxy);
    }
    tf.addBinding(tProxy, 'rz', { label: engine.mode === '2d' ? 'rot' : 'rz' }).on('change', applyProxy);
    tf.addBinding(tProxy, 'sx', { label: 'sx' }).on('change', applyProxy);
    tf.addBinding(tProxy, 'sy', { label: 'sy' }).on('change', applyProxy);
    if (engine.mode === '3d') tf.addBinding(tProxy, 'sz', { label: 'sz' }).on('change', applyProxy);

    if (entity.components.sprite) {
      const sp = entity.components.sprite;
      const sf = pane.addFolder({ title: 'Sprite', expanded: true });
      sf.addBinding(sp, 'swatch', { view: 'color', label: 'Swatch' }).on('change', () => { view.refreshEntity(entity.id); cart.touch(); });
      sf.addBinding(sp, 'glyph', { label: 'Glyph' }).on('change', () => { view.refreshEntity(entity.id); cart.touch(); });
    }

    if (entity.components.model) {
      const mo = entity.components.model;
      const mf = pane.addFolder({ title: 'Model', expanded: true });
      mf.addBinding(mo, 'swatch', { view: 'color', label: 'Swatch' }).on('change', () => { view.refreshEntity(entity.id); cart.touch(); });
    }

    if (entity.components.body) {
      const bo = entity.components.body;
      const bf = pane.addFolder({ title: 'Body', expanded: false });
      bf.addBinding(bo, 'type', { options: { static: 'static', dynamic: 'dynamic', kinematic: 'kinematic' }, label: 'Type' }).on('change', () => cart.touch());
      bf.addBinding(bo, 'shape', { options: { box: 'box' }, label: 'Shape' }).on('change', () => cart.touch());
    }

    if (entity.components.logic) {
      const lo = entity.components.logic;
      const lf = pane.addFolder({ title: 'Logic', expanded: true });
      lf.addBinding(lo, 'kind', {
        options: { trigger: 'trigger', spawn: 'spawn', checkpoint: 'checkpoint', kill: 'kill' },
        label: 'Kind'
      }).on('change', () => { view.refreshEntity(entity.id); cart.touch(); });
    }

    if (entity.components.bricks) {
      const bricksDiv = document.createElement('div');
      bricksDiv.style.marginTop = '8px';
      const label = document.createElement('div');
      label.className = 'stage-hint';
      label.textContent = 'Bricksheet';
      bricksDiv.appendChild(label);
      const select = document.createElement('select');
      select.className = 'deck-select';
      select.style.width = '100%';
      const blank = document.createElement('option');
      blank.value = ''; blank.textContent = '(none)';
      select.appendChild(blank);
      const liveForList = cart.getCartridge();
      for (const id of Object.keys(liveForList.bricksheets)) {
        const opt = document.createElement('option');
        opt.value = id; opt.textContent = id;
        if (entity.components.bricks.sheet === id) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => {
        entity.components.bricks.sheet = select.value || null;
        cart.touch();
      });
      bricksDiv.appendChild(select);
      const newSheetBtn = document.createElement('button');
      newSheetBtn.className = 'bar'; newSheetBtn.textContent = 'New Sheet for This Entity';
      newSheetBtn.style.width = '100%'; newSheetBtn.style.marginTop = '4px';
      newSheetBtn.addEventListener('click', () => {
        const name = prompt('Name for the new bricksheet?', entity.name);
        if (name === null) return;
        const l2 = cart.getCartridge();
        const id = brickWorkshop.createSheet(l2, name);
        entity.components.bricks.sheet = id;
        cart.touch();
        refreshInspector();
        ctx.toast('Created and attached "' + id + '" — edit its cards in the Bricks tab.');
      });
      bricksDiv.appendChild(newSheetBtn);
      const hint = document.createElement('div');
      hint.className = 'stage-hint';
      hint.textContent = 'Edit this sheet\'s WHEN/IF/DO cards in the Bricks tab.';
      bricksDiv.appendChild(hint);
      inspCard.appendChild(bricksDiv);
    } else {
      const addBricksBtn = document.createElement('button');
      addBricksBtn.className = 'bar'; addBricksBtn.textContent = '+ Add Bricks';
      addBricksBtn.style.width = '100%'; addBricksBtn.style.marginTop = '8px';
      addBricksBtn.addEventListener('click', () => {
        entity.components.bricks = { sheet: null };
        cart.touch();
        refreshInspector();
      });
      inspCard.appendChild(addBricksBtn);
    }

    if (Array.isArray(entity.components.tags)) {
      const tagLabel = entity.components.tags.length ? entity.components.tags.join(', ') : '\u2014';
      pane.addFolder({ title: 'Tags: ' + tagLabel, expanded: false });
    }

    // actions
    const actionsDiv = document.createElement('div');
    actionsDiv.style.marginTop = '8px';

    const dupBtn = document.createElement('button');
    dupBtn.className = 'bar'; dupBtn.textContent = 'Duplicate'; dupBtn.style.width = '100%';
    dupBtn.style.marginBottom = '4px';
    dupBtn.addEventListener('click', () => {
      const copy = ent.deepClone(entity);
      copy.name = entity.name + ' copy';
      if (copy.components.transform) {
        copy.components.transform.p[0] += 1;
      }
      const l2 = cart.getCartridge();
      const s2 = ent.getScene(l2, currentSceneId);
      ent.addEntity(s2, copy);
      view.refreshEntity(copy.id);
      cart.touch();
      selectEntity(copy.id);
      refreshTree();
    });
    actionsDiv.appendChild(dupBtn);

    const prefabSaveBtn = document.createElement('button');
    prefabSaveBtn.className = 'bar'; prefabSaveBtn.textContent = 'Save as Prefab'; prefabSaveBtn.style.width = '100%';
    prefabSaveBtn.style.marginBottom = '4px';
    prefabSaveBtn.addEventListener('click', () => {
      const l2 = cart.getCartridge();
      const id = ent.saveAsPrefab(l2, entity, entity.name);
      cart.touch();
      ctx.toast('Saved prefab: ' + id);
      refreshPrefabs();
    });
    actionsDiv.appendChild(prefabSaveBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'bar bad-btn'; delBtn.textContent = 'Delete'; delBtn.style.width = '100%';
    delBtn.addEventListener('click', () => {
      const l2 = cart.getCartridge();
      const s2 = ent.getScene(l2, currentSceneId);
      ent.removeEntity(s2, selectedId);
      const obj = view.objects.get(selectedId);
      if (obj) { engine.contentRoot.remove(obj); view.objects.delete(selectedId); }
      cart.touch();
      deselect();
      refreshTree();
    });
    actionsDiv.appendChild(delBtn);

    inspCard.appendChild(actionsDiv);
  }

  /* ---------------------------------------------------------------- */
  /* prefabs                                                           */
  /* ---------------------------------------------------------------- */
  function refreshPrefabs() {
    prefabList.innerHTML = '';
    const live = cart.getCartridge();
    const ids = Object.keys(live.prefabs || {});
    if (!ids.length) {
      prefabList.innerHTML = '<div class="stage-hint">No prefabs yet.</div>';
      return;
    }
    for (const id of ids) {
      const def = live.prefabs[id];
      const row = document.createElement('div');
      row.className = 'stage-prefab-row';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = (def.name || id) + ' ';
      nameSpan.style.flex = '1';
      row.appendChild(nameSpan);
      const placeBtn = makeBtn('Place', () => {
        const l2 = cart.getCartridge();
        const s2 = ent.getScene(l2, currentSceneId);
        const entity = ent.instantiatePrefab(l2, id, s2, [0, 0, 0]);
        if (!entity) return;
        view.refreshEntity(entity.id);
        cart.touch();
        selectEntity(entity.id);
        refreshTree();
        ctx.toast('Placed ' + id);
      });
      const delPrefabBtn = makeBtn('\u2715', () => {
        if (!confirm('Delete prefab "' + id + '"?')) return;
        const l2 = cart.getCartridge();
        delete l2.prefabs[id];
        cart.touch();
        refreshPrefabs();
      });
      delPrefabBtn.className += ' bad-btn';
      row.appendChild(placeBtn);
      row.appendChild(delPrefabBtn);
      prefabList.appendChild(row);
    }
  }
  refreshPrefabs();

  /* ---------------------------------------------------------------- */
  /* tile brush                                                        */
  /* ---------------------------------------------------------------- */
  function refreshBrush() {
    brushMount.innerHTML = '';
    if (!brush) {
      brushMount.innerHTML = '<div class="stage-hint">Drag a tile from Warehouse.</div>';
      return;
    }
    const row = document.createElement('div');
    row.className = 'stage-brush';
    const swatch = document.createElement('span');
    swatch.className = 'stage-brush-swatch';
    swatch.style.background = brush.swatch || '#3b4a63';
    row.appendChild(swatch);
    row.appendChild(document.createTextNode(brush.name));
    brushMount.appendChild(row);
  }
  refreshBrush();

  /* ---------------------------------------------------------------- */
  /* warehouse drag-and-drop                                           */
  /* ---------------------------------------------------------------- */
  canvasWrap.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  canvasWrap.addEventListener('drop', async (e) => {
    e.preventDefault();
    const payload = readDragPayload(e);
    if (!payload) return;
    const items = await allItems();
    const item = items.find((i) => i.id === payload.itemId && i.packId === payload.packId);

    if (payload.kind === 'tile') {
      brush = { item: payload.itemId, swatch: (item && item.swatch) || '#3b4a63', name: payload.name };
      setTool('paint');
      refreshBrush();
      ctx.toast('Brush: ' + payload.name);
      return;
    }

    const entity = ent.entityFromWarehouseItem(payload, item, engine.mode);
    if (!entity) { ctx.toast('Cannot place ' + payload.kind + ' here yet.', true); return; }

    const rect = canvas.getBoundingClientRect();
    const ndc = {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1
    };
    const pt = groundPoint(engine, ndc) || [0, 0, 0];
    if (!entity.components.transform) entity.components.transform = ent.COMPONENT_TYPES.transform.defaults();
    entity.components.transform.p = [...pt];

    placeEntity(entity);
  });

  function placeEntity(entity) {
    const live = cart.getCartridge();
    const sc = ent.getScene(live, currentSceneId);
    ent.addEntity(sc, entity);
    view.refreshEntity(entity.id);
    cart.touch();
    selectEntity(entity.id);
    refreshTree();
    ctx.toast('Placed: ' + entity.name);
  }

  /* ---------------------------------------------------------------- */
  /* pointer: picking + tile painting                                  */
  /* ---------------------------------------------------------------- */
  let painting = false;
  let paintRaf = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (playSession) return;
    const ndc = ptrNdc(e, canvas);
    if (tool === 'select') {
      if (txControls.dragging) return;
      if (e.shiftKey) {
        // Shift+click the ground: next Play starts the player right here
        const pt = groundPoint(engine, ndc);
        if (pt) {
          setSpawnOverride(spawnOverride && Math.hypot(pt[0] - spawnOverride[0], (pt[2] || 0) - (spawnOverride[2] || 0)) < 0.4 ? null : pt);
          ctx.toast(spawnOverride ? '▶ Play will start here (Shift+click again to clear).' : 'Play-from-here cleared.');
        }
        return;
      }
      const id = pickEntity(engine, ndc);
      selectEntity(id || null);
    } else if (tool === 'terrain') {
      return; // the brush layer owns these clicks
    } else {
      painting = true;
      doPaint(ndc);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!painting || playSession) return;
    const ndc = ptrNdc(e, canvas);
    cancelAnimationFrame(paintRaf);
    paintRaf = requestAnimationFrame(() => doPaint(ndc));
  });
  canvas.addEventListener('pointerup', () => { painting = false; });

  // ---- terrain brush pointer layer (registered with the other live
  // handlers so it shares their exact conditions) ----
  canvas.addEventListener('pointerdown', (e) => {
    if (playSession || tool !== 'terrain') return;
    e.stopImmediatePropagation(); // the brush owns this drag, not orbit/gizmo
    stroking = true;
    strokeSet = new Set();
    applyBrush(ptrNdc(e, canvas));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (playSession || tool !== 'terrain') return;
    const scene = getTerrainScene();
    if (!scene || !scene.terrain) { brushStatus('No ground yet — press + Add ground first.'); return; }
    if (engine.mode !== '3d') { brushStatus('This scene is 2D — terrain sculpting needs a 3D scene.'); return; }
    const ndc = ptrNdc(e, canvas);
    const pt = groundPoint(engine, ndc);
    if (!pt) { brushStatus('Aim at the ground.'); return; }
    brushStatus((stroking ? '● ' : '○ ') + brushOp + ' at ' + pt[0].toFixed(1) + ', ' + pt[2].toFixed(1));
    if (stroking) applyBrush(ndc);
    else showBrushRing(pt);
  });
  window.addEventListener('pointerup', () => {
    if (stroking) {
      stroking = false;
      strokeSet = new Set();
      const scene = getTerrainScene();
      if (scene && scene.terrain && scene.terrain.smooth) commitMasks(scene.terrain);
    }
  });

  function doPaint(ndc) {
    const pt = groundPoint(engine, ndc);
    if (!pt) return;
    const live = cart.getCartridge();
    const sc = ent.getScene(live, currentSceneId);

    if (tool === 'erase') {
      for (const entity of sc.entities) {
        if (!entity.components.tilemap) continue;
        const { cx, cy } = cellAt(entity, pt);
        if (eraseTile(entity.components.tilemap, cx, cy)) { view.refreshEntity(entity.id); cart.touch(); }
      }
      return;
    }
    if (!brush) { ctx.toast('Set a tile brush first (drag from Warehouse).', true); return; }

    let tmEnt = sc.entities.find((e) => e.components.tilemap);
    if (!tmEnt) {
      tmEnt = ent.createEntity({ name: 'Tiles', components: { tilemap: { cell: 1, tiles: {} } } });
      ent.addEntity(sc, tmEnt);
    }
    const { cx, cy } = cellAt(tmEnt, pt);
    if (paintTile(tmEnt.components.tilemap, cx, cy, brush)) { view.refreshEntity(tmEnt.id); cart.touch(); }
  }

  /* ---------------------------------------------------------------- */
  /* keyboard                                                          */
  /* ---------------------------------------------------------------- */
  const playInput = { left: false, right: false, up: false, down: false, jump: false, yawDelta: 0, pitchDelta: 0 };

  function onKeyDown(e) {
    if (playSession) {
      const three = cart.getCartridge().settings.mode === '3d';
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') playInput.left = true;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') playInput.right = true;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') playInput.down = true;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); playInput.up = true; if (!three) playInput.jump = true; }
      if (e.code === 'Space') { e.preventDefault(); playInput.jump = true; if (!three) playInput.up = true; }
      if (e.code === 'Escape') doStop();
      return;
    }
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (e.code === 'KeyW') { gizmoMode = 'translate'; txControls.setMode('translate'); refreshGizmoBtns(); }
    if (e.code === 'KeyE') { gizmoMode = 'rotate'; txControls.setMode('rotate'); refreshGizmoBtns(); }
    if (e.code === 'KeyR') { gizmoMode = 'scale'; txControls.setMode('scale'); refreshGizmoBtns(); }
    if ((e.code === 'Delete' || e.code === 'Backspace') && selectedId) {
      const l2 = cart.getCartridge();
      const s2 = ent.getScene(l2, currentSceneId);
      ent.removeEntity(s2, selectedId);
      const obj = view.objects.get(selectedId);
      if (obj) { engine.contentRoot.remove(obj); view.objects.delete(selectedId); }
      cart.touch();
      deselect();
      refreshTree();
    }
    if (e.code === 'Escape') deselect();
  }
  function onKeyUp(e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') playInput.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') playInput.right = false;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') playInput.down = false;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { playInput.jump = false; playInput.up = false; }
  }
  /* first-person mouse look while testing: Play grabs the mouse, moving it
   * looks around, Esc gives it back (then Esc again stops the test) */
  function onPlayMouseMove(e) {
    if (!playSession || !document.pointerLockElement) return;
    playInput.yawDelta -= e.movementX * 0.0025;
    playInput.pitchDelta -= e.movementY * 0.0025;
  }
  function onPlayClick() {
    if (!playSession) return;
    if (cart.getCartridge().settings.controlScheme !== 'fps') return;
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  }
  window.addEventListener('mousemove', onPlayMouseMove);
  canvas.addEventListener('click', onPlayClick);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  /* ---------------------------------------------------------------- */
  /* scene selector                                                    */
  /* ---------------------------------------------------------------- */
  sceneSelect.addEventListener('change', () => {
    currentSceneId = sceneSelect.value;
    const live = cart.getCartridge();
    const sc = ent.getScene(live, currentSceneId);
    view.clear();
    if (sc) {
      view.refreshTerrain(sc); // clear() wipes the ground too — rebuild it
      sc.entities.forEach((e) => view.refreshEntity(e.id));
    }
    deselect();
    refreshTree();
  });

  /* ---------------------------------------------------------------- */
  /* play / stop                                                       */
  /* ---------------------------------------------------------------- */
  function logPlay(msg) {
    playLogMessages.unshift({ t: Date.now(), msg });
    if (playLogMessages.length > 60) playLogMessages.length = 60;
    refreshPlayLog();
  }

  function refreshPlayLog() {
    logList.innerHTML = playLogMessages.slice(0, 14).map((e) =>
      '<div class="deck-log-row"><span>' + new Date(e.t).toLocaleTimeString() +
      '</span><span>' + escapeHtml(e.msg) + '</span></div>'
    ).join('') || '<div class="deck-log-row"><span>\u2014</span><span>no events</span></div>';
  }

  playBtn.addEventListener('click', () => doPlay());
  stopBtn.addEventListener('click', () => doStop());

  /** @type {number[]|null} Shift+click sets this — Play starts the player here */
  let spawnOverride = null;
  let spawnMarker = null;
  let spawnStash = null; // player's real position, restored on Stop

  function setSpawnOverride(pt) {
    spawnOverride = pt;
    if (spawnMarker) { engine.scene.remove(spawnMarker); spawnMarker = null; }
    if (pt) {
      spawnMarker = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.4, 12),
        new THREE.MeshBasicMaterial({ color: '#67e39b', transparent: true, opacity: 0.8, depthTest: false })
      );
      spawnMarker.rotation.x = Math.PI;
      spawnMarker.renderOrder = 997;
      spawnMarker.position.set(pt[0], (pt[1] || 0) + 0.5, pt[2] || 0);
      engine.scene.add(spawnMarker);
    }
  }

  /** @type {THREE.LineSegments|null} */
  let wireframe = null;
  /** @type {THREE.BufferGeometry|null} */
  let wireGeo = null;

  async function doPlay() {
    if (playSession) return;
    await physicsReady;
    const live = cart.getCartridge();
    const sc = ent.getScene(live, currentSceneId);
    if (!sc) return;
    deselect();
    // play-from-here: temporarily move the player entity to the marker
    spawnStash = null;
    if (spawnOverride) {
      const player = sc.entities.find((en) => Array.isArray(en.components.tags) && en.components.tags.includes('player'));
      if (player) {
        spawnStash = { entity: player, p: [...player.components.transform.p] };
        player.components.transform.p = [spawnOverride[0], (spawnOverride[1] || 0) + 0.6, spawnOverride[2] || 0];
      }
    }
    canvasWrap.classList.add('playing');
    orbitControls.enabled = false;
    playBtn.style.display = 'none';
    stopBtn.style.display = '';
    playLogMessages.length = 0;
    try {
      playSession = await startRuntime(engine, live, currentSceneId, logPlay);
      // rules light up: green pulse on the entity whose cards fired
      if (playSession && playSession.session) {
        const pulse = (obj, on) => obj.traverse((child) => {
          if (!child.isMesh) return;
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) {
            if (!m || !m.emissive) continue;
            m.emissive.setHex(on ? 0x67e39b : 0x000000);
            m.emissiveIntensity = on ? 0.7 : 0;
          }
        });
        playSession.session.onBrickFire = (entityId, when) => {
          const obj = view.objects.get(entityId);
          if (!obj) return;
          pulse(obj, true);
          setTimeout(() => pulse(obj, false), 180);
          const sc2 = ent.getScene(cart.getCartridge(), currentSceneId);
          const en2 = sc2 && sc2.entities.find((en) => en.id === entityId);
          if (en2) logPlay('⚡ ' + en2.name + ': ' + when);
        };
      }
    } catch (err) {
      ctx.toast('Play failed: ' + (err && err.message || String(err)), true);
      doStop();
      return;
    }
    // editor-only debug overlay — the real game (and its exported build)
    // never draws this; it's purely a Stage authoring aid, same as P2.
    wireGeo = new THREE.BufferGeometry();
    wireframe = new THREE.LineSegments(
      wireGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })
    );
    wireframe.position.z = 0.3;
    engine.contentRoot.add(wireframe);
    setPhysicsSource(() => worldStats(playSession.session));
    logPlay('play started — ' + worldStats(playSession.session).colliders + ' colliders');
    if (live.settings.controlScheme === 'fps') canvas.requestPointerLock();
  }

  function doStop() {
    if (!playSession) return;
    playSession.stop();
    playSession = null;
    if (spawnStash) {
      spawnStash.entity.components.transform.p = spawnStash.p;
      const obj = view.objects.get(spawnStash.entity.id);
      if (obj) syncTransform(obj, spawnStash.entity, engine.mode);
      spawnStash = null;
    }
    setPhysicsSource(null);
    orbitControls.enabled = true;
    if (document.pointerLockElement) document.exitPointerLock();
    if (wireframe) { engine.contentRoot.remove(wireframe); wireGeo.dispose(); wireframe.material.dispose(); wireframe = null; wireGeo = null; }
    canvasWrap.classList.remove('playing');
    playBtn.style.display = '';
    stopBtn.style.display = 'none';
    playInput.left = false; playInput.right = false; playInput.up = false; playInput.down = false; playInput.jump = false;
    const live = cart.getCartridge();
    const sc = ent.getScene(live, currentSceneId);
    view.clear();
    if (sc) {
      view.refreshTerrain(sc); // clear() wipes the ground too — rebuild it
      sc.entities.forEach((e) => view.refreshEntity(e.id));
    }
    if (engine.mode === '2d') { engine.camera.position.x = 0; engine.camera.position.y = 0; }
    else if (engine.mode === '3d') { engine.camera.position.set(6, 6, 6); engine.camera.lookAt(0, 0, 0); }
    refreshTree();
    logPlay('stopped — edit state restored');
  }

  /* ---------------------------------------------------------------- */
  /* debug: crash banner + on-screen HUD                                */
  /* ---------------------------------------------------------------- */
  /**
   * Before this, a throw inside playSession.tick() silently killed the whole
   * render loop — no error, no message, just a frozen frame. This makes
   * crashes visible on-screen (not just in devtools) and stops the crashed
   * play session from being ticked again, without freezing the editor's own
   * camera/render loop around it.
   */
  const crashBanner = document.createElement('div');
  crashBanner.style.cssText =
    'display:none;position:absolute;left:8px;right:8px;top:8px;z-index:50;' +
    'background:#3a0d0d;border:1px solid #ff5555;color:#ffd6d6;padding:10px 12px;' +
    'font:12px/1.4 monospace;white-space:pre-wrap;border-radius:6px;max-height:40%;overflow:auto;';
  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = '✕ dismiss';
  dismissBtn.style.cssText = 'float:right;background:none;border:1px solid #ff5555;color:#ffd6d6;cursor:pointer;border-radius:4px;padding:2px 6px;';
  dismissBtn.addEventListener('click', () => { crashBanner.style.display = 'none'; });
  const crashText = document.createElement('div');
  crashBanner.appendChild(dismissBtn);
  crashBanner.appendChild(crashText);
  canvasWrap.appendChild(crashBanner);

  const debugHud = document.createElement('div');
  debugHud.style.cssText =
    'position:absolute;left:8px;bottom:8px;z-index:40;background:rgba(0,0,0,0.55);' +
    'color:#9be89b;font:11px/1.5 monospace;padding:6px 8px;border-radius:4px;pointer-events:none;white-space:pre;';
  canvasWrap.appendChild(debugHud);

  let crashed = false;
  function showCrash(err) {
    crashed = true;
    console.error('[stage] play session crashed:', err);
    crashText.textContent =
      'GAME CRASHED — ' + (err && err.message || String(err)) + '\n' +
      (err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : '');
    crashBanner.style.display = 'block';
  }

  let fpsSmoothed = 0;

  /* ---------------------------------------------------------------- */
  /* render loop                                                       */
  /* ---------------------------------------------------------------- */
  let rafId = null;
  let visible = true;
  let lastTs = performance.now();
  let announcedEnd = false;

  function loop(ts) {
    if (!visible) return;
    const dt = Math.min((ts - lastTs) / 1000, 0.1);
    lastTs = ts;
    fpsSmoothed = fpsSmoothed ? fpsSmoothed * 0.9 + (1 / Math.max(dt, 0.0001)) * 0.1 : 1 / Math.max(dt, 0.0001);
    if (playSession && !crashed) {
      let stepResult;
      try {
        stepResult = playSession.tick(dt, playInput);
      } catch (err) {
        showCrash(err);
        stepResult = null;
      }
      const info = crashed ? null : playSession.debugInfo;
      debugHud.textContent = crashed
        ? 'DEBUG HUD — crashed, see banner above'
        : 'FPS ' + Math.round(fpsSmoothed) +
          '  entities ' + info.entities +
          '  particles ' + info.particleSystems +
          '  activeMotion ' + info.activeMotion +
          '  t ' + info.elapsed.toFixed(1) + 's';
      const ended = stepResult && stepResult.ended;
      if (ended && !announcedEnd) {
        announcedEnd = true;
        logPlay(ended.result === 'win' ? 'You win! ' + (ended.message || '') : 'Game over. ' + (ended.message || ''));
        ctx.toast(ended.result === 'win' ? 'Level won!' : 'Level lost — try again.');
        doStop();
      }
      if (wireframe && getWireframesEnabled() && engine.mode === '2d') {
        wireframe.visible = true;
        const lines = debugLines(playSession.session);
        const points = lines.vertices.length / 2;
        const positions = new Float32Array(points * 3);
        const colors = new Float32Array(points * 3);
        for (let i = 0; i < points; i++) {
          positions[i * 3] = lines.vertices[i * 2];
          positions[i * 3 + 1] = lines.vertices[i * 2 + 1];
          positions[i * 3 + 2] = 0;
          colors[i * 3] = lines.colors[i * 4];
          colors[i * 3 + 1] = lines.colors[i * 4 + 1];
          colors[i * 3 + 2] = lines.colors[i * 4 + 2];
        }
        wireGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        wireGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      } else if (wireframe) {
        wireframe.visible = false;
      }
    } else {
      announcedEnd = false;
    }
    if (selectedId && selectionBox) {
      const obj = view.objects.get(selectedId);
      if (obj) { const b = new THREE.Box3().setFromObject(obj); if (!b.isEmpty()) selectionBox.box.copy(b); }
    }
    if (!playSession) {
      orbitControls.update();
      if (view.water) view.water.tick();
    }
    engine.tick();
    rafId = requestAnimationFrame(loop);
  }

  /* ---------------------------------------------------------------- */
  /* resize                                                            */
  /* ---------------------------------------------------------------- */
  let resizeObs = null;
  function doResize() {
    const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
    engine.resize(w, h);
  }
  resizeObs = new ResizeObserver(doResize);
  resizeObs.observe(canvasWrap);
  refreshTree();
  refreshInspector();
  requestAnimationFrame((ts) => { doResize(); lastTs = ts; loop(ts); });

  /* ---------------------------------------------------------------- */
  /* teardown                                                          */
  /* ---------------------------------------------------------------- */
  const stopObs = new MutationObserver(() => {
    if (!document.body.contains(panel)) teardown();
  });
  stopObs.observe(document.body, { childList: true, subtree: true });

  function teardown() {
    visible = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (paintRaf) cancelAnimationFrame(paintRaf);
    if (resizeObs) resizeObs.disconnect();
    stopObs.disconnect();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    if (playSession) doStop();
    if (pane) { pane.dispose(); pane = null; }
    txControls.detach();
    txControls.dispose();
    orbitControls.dispose();
    setEntitySource(null);
    engine.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
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
function rebuildSceneSelect(sel, c) {
  sel.innerHTML = '';
  for (const s of c.scenes) {
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.id;
    sel.appendChild(o);
  }
  sel.value = currentSceneId || (c.scenes[0] && c.scenes[0].id) || '';
}
function ptrNdc(e, canvas) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
