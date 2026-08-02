/**
 * @file atelier-panel.js
 * @description Pixel Atelier tab: sprite list, a paint-by-click pixel grid
 * (2 layers, curated palette), a flipbook frame strip, and Save (which
 * writes into cartridge.assets.sprites — the same "export to warehouse"
 * every other asset uses). Ticket P3-8. Phase 3.
 */

import * as cart from '../cartridge.js';
import * as atelier from '../atelier.js';

/** Screen size (px) the pixel grid renders at, regardless of resolution. */
const CANVAS_DISPLAY_SIZE = 384;

let currentSpriteId = null; // null = new/unsaved sprite
/** @type {any} working sprite (editable copy — see atelier.js loadSpriteForEditing) */
let working = atelier.createSprite('Sprite', 16);
let currentFrame = 0;
let currentLayer = 'fg';
let currentColor = atelier.PALETTE[4];
let tool = 'draw'; // draw | erase

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderAtelierPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Pixel Atelier</h2>' +
    '<div class="sub">Draw a sprite, pixel by pixel — two layers, a curated palette, flipbook frames. ' +
    'Save it and it shows up in the Warehouse, ready to drag into the Stage.</div>';

  const layout = document.createElement('div');
  layout.className = 'stage-layout';

  // ---------- left: canvas + tools ----------
  const left = document.createElement('div');

  const bar = document.createElement('div');
  bar.className = 'stage-bar';
  const newBtn = makeBtn('+ New Sprite', () => {
    const name = prompt('Sprite name?', 'Sprite');
    if (name === null) return;
    const sizeStr = prompt('Canvas size — 16, 32, or 64?', '16');
    const size = atelier.SIZES.includes(Number(sizeStr)) ? Number(sizeStr) : 16;
    working = atelier.createSprite(name, size);
    currentSpriteId = null;
    currentFrame = 0;
    renderAll();
  });
  bar.appendChild(newBtn);

  const spriteSelect = document.createElement('select');
  spriteSelect.className = 'deck-select';
  bar.appendChild(spriteSelect);
  spriteSelect.addEventListener('change', () => {
    if (!spriteSelect.value) return;
    const live = cart.getCartridge();
    const record = live.assets.sprites.find((s) => s.id === spriteSelect.value);
    if (!record) return;
    working = atelier.loadSpriteForEditing(record);
    currentSpriteId = record.id;
    currentFrame = 0;
    renderAll();
  });

  bar.appendChild(makeSep());
  const layerBg = makeBtn('Layer: BG', () => { currentLayer = 'bg'; refreshToolbar(); });
  const layerFg = makeBtn('Layer: FG', () => { currentLayer = 'fg'; refreshToolbar(); });
  bar.appendChild(layerBg); bar.appendChild(layerFg);

  bar.appendChild(makeSep());
  const drawBtn = makeBtn('\u270E Draw', () => { tool = 'draw'; refreshToolbar(); });
  const eraseBtn = makeBtn('\u2716 Erase', () => { tool = 'erase'; refreshToolbar(); });
  bar.appendChild(drawBtn); bar.appendChild(eraseBtn);

  left.appendChild(bar);

  const palette = document.createElement('div');
  palette.className = 'wh-grid';
  palette.style.gridTemplateColumns = 'repeat(16, 1fr)';
  palette.style.marginBottom = '8px';
  for (const color of atelier.PALETTE) {
    const swatch = document.createElement('div');
    swatch.className = 'stage-brush';
    swatch.style.width = '22px'; swatch.style.height = '22px';
    swatch.style.background = color === 'transparent' ? 'repeating-conic-gradient(#8a95ad 0% 25%, #3b4a63 0% 50%) 50% / 8px 8px' : color;
    swatch.title = color;
    swatch.addEventListener('click', () => { currentColor = color; refreshToolbar(); });
    palette.appendChild(swatch);
  }
  left.appendChild(palette);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'stage-canvas-wrap';
  canvasWrap.style.height = 'auto';
  canvasWrap.style.display = 'flex';
  canvasWrap.style.justifyContent = 'center';
  canvasWrap.style.padding = '8px';
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_DISPLAY_SIZE;
  canvas.height = CANVAS_DISPLAY_SIZE;
  canvas.style.cssText = 'image-rendering:pixelated;border:1px solid var(--line);background:repeating-conic-gradient(#232a3a 0% 25%,#181e2b 0% 50%) 50%/16px 16px;cursor:crosshair;';
  canvasWrap.appendChild(canvas);
  left.appendChild(canvasWrap);
  const ctx2d = canvas.getContext('2d');

  layout.appendChild(left);

  // ---------- right: frames + hitbox + save ----------
  const right = document.createElement('div');
  right.className = 'deck-right';

  const frameCard = document.createElement('div');
  frameCard.className = 'card';
  frameCard.innerHTML = '<h3>Frames</h3>';
  const frameStrip = document.createElement('div');
  frameStrip.className = 'wh-grid';
  frameStrip.style.gridTemplateColumns = 'repeat(4, 1fr)';
  frameCard.appendChild(frameStrip);
  const frameBtns = document.createElement('div');
  frameBtns.className = 'stage-bar';
  frameBtns.style.marginTop = '6px';
  const addFrameBtn = makeBtn('+ Frame', () => {
    working.frames.push(atelier.createBlankFrame(working.size));
    currentFrame = working.frames.length - 1;
    renderAll();
  });
  const dupFrameBtn = makeBtn('Duplicate', () => {
    const f = working.frames[currentFrame];
    working.frames.splice(currentFrame + 1, 0, { bg: [...f.bg], fg: [...f.fg] });
    currentFrame++;
    renderAll();
  });
  const delFrameBtn = makeBtn('Delete', () => {
    if (working.frames.length <= 1) { ctx.toast('A sprite needs at least one frame.', true); return; }
    working.frames.splice(currentFrame, 1);
    currentFrame = Math.max(0, currentFrame - 1);
    renderAll();
  });
  delFrameBtn.className += ' bad-btn';
  frameBtns.appendChild(addFrameBtn); frameBtns.appendChild(dupFrameBtn); frameBtns.appendChild(delFrameBtn);
  frameCard.appendChild(frameBtns);
  right.appendChild(frameCard);

  const hitboxCard = document.createElement('div');
  hitboxCard.className = 'card';
  hitboxCard.innerHTML = '<h3>Auto Hitbox</h3>';
  const hitboxInfo = document.createElement('div');
  hitboxInfo.className = 'stage-hint';
  hitboxCard.appendChild(hitboxInfo);
  right.appendChild(hitboxCard);

  const saveCard = document.createElement('div');
  saveCard.className = 'card';
  saveCard.innerHTML = '<h3>Save</h3>';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'title-input';
  nameInput.style.width = '100%';
  nameInput.style.marginBottom = '8px';
  nameInput.addEventListener('change', () => { working.name = nameInput.value; });
  saveCard.appendChild(nameInput);
  const saveBtn = makeBtn('Save to Warehouse', () => {
    const live = cart.getCartridge();
    working.name = nameInput.value || working.name;
    const id = atelier.saveSprite(live, working);
    cart.touch();
    currentSpriteId = id;
    ctx.toast('Saved "' + working.name + '" — find it in the Warehouse under My Assets.');
    renderAll();
  });
  saveBtn.className += ' primary';
  saveBtn.style.width = '100%';
  saveCard.appendChild(saveBtn);
  const deleteBtn = makeBtn('Delete Sprite', () => {
    if (!currentSpriteId) { ctx.toast('Nothing saved yet to delete.', true); return; }
    if (!confirm('Delete "' + working.name + '" from the Warehouse?')) return;
    const live = cart.getCartridge();
    atelier.deleteSprite(live, currentSpriteId);
    cart.touch();
    working = atelier.createSprite('Sprite', 16);
    currentSpriteId = null;
    currentFrame = 0;
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

  function refreshSpriteSelect() {
    const live = cart.getCartridge();
    spriteSelect.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = currentSpriteId ? '(switch sprite)' : '(new, unsaved)';
    spriteSelect.appendChild(blank);
    for (const s of live.assets.sprites) {
      const opt = document.createElement('option');
      opt.value = s.id; opt.textContent = s.name;
      if (s.id === currentSpriteId) opt.selected = true;
      spriteSelect.appendChild(opt);
    }
  }

  function refreshToolbar() {
    layerBg.classList.toggle('active', currentLayer === 'bg');
    layerFg.classList.toggle('active', currentLayer === 'fg');
    drawBtn.classList.toggle('active', tool === 'draw');
    eraseBtn.classList.toggle('active', tool === 'erase');
    for (const child of palette.children) {
      child.style.outline = child.title === currentColor ? '2px solid var(--gold)' : 'none';
    }
  }

  function drawCanvas() {
    const frame = working.frames[currentFrame];
    const composite = atelier.compositeFrame(frame, working.size);
    ctx2d.clearRect(0, 0, CANVAS_DISPLAY_SIZE, CANVAS_DISPLAY_SIZE);
    ctx2d.imageSmoothingEnabled = false;
    ctx2d.drawImage(composite, 0, 0, working.size, working.size, 0, 0, CANVAS_DISPLAY_SIZE, CANVAS_DISPLAY_SIZE);
  }

  function refreshFrameStrip() {
    frameStrip.innerHTML = '';
    working.frames.forEach((frame, i) => {
      const cell = document.createElement('div');
      cell.className = 'wh-item';
      cell.style.outline = i === currentFrame ? '2px solid var(--gold)' : 'none';
      const thumb = document.createElement('div');
      thumb.className = 'wh-thumb';
      const img = document.createElement('img');
      img.src = atelier.frameToDataURL(frame, working.size);
      img.style.cssText = 'width:100%;height:100%;object-fit:contain;image-rendering:pixelated;';
      thumb.appendChild(img);
      cell.appendChild(thumb);
      const label = document.createElement('div');
      label.className = 'wh-name';
      label.textContent = 'Frame ' + (i + 1);
      cell.appendChild(label);
      cell.addEventListener('click', () => { currentFrame = i; renderAll(); });
      frameStrip.appendChild(cell);
    });
  }

  function refreshHitbox() {
    const box = atelier.computeHitbox(working.frames[currentFrame], working.size);
    hitboxInfo.textContent = 'x:' + box[0].toFixed(2) + ' y:' + box[1].toFixed(2) +
      ' w:' + box[2].toFixed(2) + ' h:' + box[3].toFixed(2) + ' (normalized to the frame)';
  }

  function renderAll() {
    nameInput.value = working.name;
    refreshSpriteSelect();
    refreshToolbar();
    drawCanvas();
    refreshFrameStrip();
    refreshHitbox();
  }

  /* ---------------------------------------------------------------- */
  /* painting                                                           */
  /* ---------------------------------------------------------------- */
  let painting = false;

  function paintAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = Math.floor((clientX - rect.left) / rect.width * working.size);
    const py = Math.floor((clientY - rect.top) / rect.height * working.size);
    const color = tool === 'erase' ? null : currentColor;
    atelier.setPixel(working.frames[currentFrame], currentLayer, px, py, working.size, color);
    drawCanvas();
  }

  canvas.addEventListener('pointerdown', (e) => { painting = true; paintAt(e.clientX, e.clientY); });
  canvas.addEventListener('pointermove', (e) => { if (painting) paintAt(e.clientX, e.clientY); });
  window.addEventListener('pointerup', () => {
    if (painting) { painting = false; refreshFrameStrip(); refreshHitbox(); }
  });

  renderAll();
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
