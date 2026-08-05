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
let working = atelier.createSprite('Image', 64, 64);
let currentFrame = 0;
let currentLayer = 0; // index into frame.layers
let currentColor = atelier.PALETTE[4];
let tool = 'draw'; // draw | erase | fill | line | rect | pick
let mirror = false;
let sel = null; // [x0,y0,x1,y1] pixel selection
let anchor = null; // line/rect start pixel

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
    const sizeStr = prompt('Canvas size? width x height, e.g. 64x64 or 320x180 (8-1024 each)', '64x64');
    if (sizeStr === null) return;
    const m = /^\s*(\d+)\s*[x×,\s]\s*(\d+)\s*$/.exec(sizeStr) || [null, sizeStr, sizeStr];
    const clampDim = (v) => Math.max(8, Math.min(1024, Math.round(Number(v) || 64)));
    working = atelier.createSprite(name, clampDim(m[1]), clampDim(m[2]));
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
  const toolBtns = {};
  const TOOLS = [['draw', '✎ Draw'], ['erase', '✖ Erase'], ['fill', '🪣 Fill'], ['line', '📏 Line'], ['rect', '▭ Box'], ['pick', '💉 Pick'], ['select', '⬚ Select']];
  for (const [id, label] of TOOLS) {
    const b = makeBtn(label, () => { tool = id; anchor = null; refreshToolbar(); });
    toolBtns[id] = b;
    bar.appendChild(b);
  }
  const mirrorBtn = makeBtn('🪞 Mirror', () => { mirror = !mirror; refreshToolbar(); });
  bar.appendChild(mirrorBtn);
  bar.appendChild(makeSep());
  bar.appendChild(makeBtn('\ud83c\udf2b Blur', () => {
    atelier.blurLayer(working.frames[currentFrame], currentLayer, working.w, working.h, sel);
    renderAll();
  }));
  bar.appendChild(makeBtn('\ud83e\uddf9 Clear', () => {
    const region = sel || [0, 0, working.w - 1, working.h - 1];
    atelier.clearRegion(working.frames[currentFrame], currentLayer, working.w, working.h, region);
    renderAll();
  }));
  bar.appendChild(makeSep());
  const importInput = document.createElement('input');
  importInput.type = 'file'; importInput.accept = 'image/*'; importInput.style.display = 'none';
  importInput.addEventListener('change', () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      // Import replaces the current frame, scaled to this sprite's canvas.
      // the image arrives at its own size — this becomes the canvas
      const res = atelier.importImageNative(img);
      working.w = res.w; working.h = res.h; working.size = Math.max(res.w, res.h);
      working.frames = [res.frame];
      currentFrame = 0; currentLayer = 0; sel = null;
      URL.revokeObjectURL(img.src);
      renderAll();
      ctx.toast('Imported at ' + res.w + '×' + res.h + '.');
    };
    img.onerror = () => ctx.toast('Could not read that image.', true);
    img.src = URL.createObjectURL(file);
    importInput.value = '';
  });
  bar.appendChild(importInput);
  bar.appendChild(makeBtn('🖼 Import PNG…', () => importInput.click()));
  // tablets/phones: snap a photo straight onto the canvas
  const camInput = document.createElement('input');
  camInput.type = 'file'; camInput.accept = 'image/*'; camInput.style.display = 'none';
  camInput.setAttribute('capture', 'environment');
  camInput.addEventListener('change', () => {
    const file = camInput.files && camInput.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const res = atelier.importImageNative(img);
      working.w = res.w; working.h = res.h; working.size = Math.max(res.w, res.h);
      working.frames = [res.frame];
      currentFrame = 0; currentLayer = 0; sel = null;
      URL.revokeObjectURL(img.src);
      renderAll();
      ctx.toast('📷 Snapped at ' + res.w + '×' + res.h + '!');
    };
    img.onerror = () => ctx.toast('Could not read that photo.', true);
    img.src = URL.createObjectURL(file);
    camInput.value = '';
  });
  bar.appendChild(camInput);
  bar.appendChild(makeBtn('📷 Camera', () => camInput.click()));

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

  const layersCard = document.createElement('div');
  layersCard.className = 'card';
  layersCard.innerHTML = '<h3>Layers</h3>';
  const layersList = document.createElement('div');
  layersCard.appendChild(layersList);
  const addLayerBtn = makeBtn('+ Layer', () => {
    currentLayer = atelier.addLayer(working.frames[currentFrame], working.w, working.h);
    renderAll();
  });
  addLayerBtn.style.marginTop = '6px';
  layersCard.appendChild(addLayerBtn);
  right.appendChild(layersCard);

  const exportCard = document.createElement('div');
  exportCard.className = 'card';
  exportCard.innerHTML = '<h3>Export</h3>';
  const dl = (href, filename) => {
    const a = document.createElement('a');
    a.href = href; a.download = filename; a.click();
  };
  const exRow = document.createElement('div');
  exRow.className = 'stage-bar';
  exRow.style.flexWrap = 'wrap';
  exRow.appendChild(makeBtn('PNG', () => dl(atelier.exportFrame(working.frames[currentFrame], working.w, working.h, 'png'), (working.name || 'sprite') + '.png')));
  exRow.appendChild(makeBtn('JPEG', () => dl(atelier.exportFrame(working.frames[currentFrame], working.w, working.h, 'jpeg'), (working.name || 'sprite') + '.jpg')));
  exRow.appendChild(makeBtn('Sprite File', () => {
    // the proprietary format: the full layered sprite as JSON
    const blob = new Blob([JSON.stringify(working)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    dl(url, (working.name || 'sprite') + '.getsprite.json');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  const spriteFileInput = document.createElement('input');
  spriteFileInput.type = 'file'; spriteFileInput.accept = '.json,application/json'; spriteFileInput.style.display = 'none';
  spriteFileInput.addEventListener('change', () => {
    const file = spriteFileInput.files && spriteFileInput.files[0];
    if (!file) return;
    file.text().then((text) => {
      const data = JSON.parse(text);
      if (!data.frames || !data.size) throw new Error('not a sprite file');
      const iw = data.w || data.size, ih = data.h || data.size;
      working = {
        id: '', name: data.name || 'Imported Image', w: iw, h: ih, size: Math.max(iw, ih),
        frames: data.frames.map((f) => atelier.migrateFrame(f, iw, ih)),
        swatch: data.swatch || '#6fb2dc', thumbnail: null, hitbox: data.hitbox || [0, 0, 1, 1]
      };
      currentSpriteId = null; currentFrame = 0; currentLayer = 0; sel = null;
      renderAll();
      ctx.toast('Sprite file loaded.');
    }).catch(() => ctx.toast('That file is not a sprite file.', true));
    spriteFileInput.value = '';
  });
  exRow.appendChild(spriteFileInput);
  exRow.appendChild(makeBtn('Open File\u2026', () => spriteFileInput.click()));
  exportCard.appendChild(exRow);
  right.appendChild(exportCard);

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
    working.frames.push(atelier.createBlankFrame(working.w, working.h));
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
    working = atelier.createSprite('Image', 64, 64);
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
    for (const [id, b] of Object.entries(toolBtns)) b.classList.toggle('active', tool === id);
    mirrorBtn.classList.toggle('active', mirror);
    for (const child of palette.children) {
      child.style.outline = child.title === currentColor ? '2px solid var(--gold)' : 'none';
    }
  }

  function drawCanvas() {
    const frame = working.frames[currentFrame];
    const composite = atelier.compositeFrame(frame, working.w, working.h);
    const maxDim = Math.max(working.w, working.h);
    canvas.width = Math.round(CANVAS_DISPLAY_SIZE * working.w / maxDim);
    canvas.height = Math.round(CANVAS_DISPLAY_SIZE * working.h / maxDim);
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    ctx2d.imageSmoothingEnabled = false;
    ctx2d.drawImage(composite, 0, 0, working.w, working.h, 0, 0, canvas.width, canvas.height);
    if (sel) {
      const k = canvas.width / working.w;
      ctx2d.strokeStyle = '#f0c463';
      ctx2d.setLineDash([5, 4]);
      ctx2d.strokeRect(sel[0] * k + 0.5, sel[1] * k + 0.5, (sel[2] - sel[0] + 1) * k - 1, (sel[3] - sel[1] + 1) * k - 1);
      ctx2d.setLineDash([]);
    }
  }

  function refreshLayers() {
    const frame = working.frames[currentFrame];
    if (currentLayer >= frame.layers.length) currentLayer = frame.layers.length - 1;
    layersList.innerHTML = '';
    // top layer first, like every art program
    for (let i = frame.layers.length - 1; i >= 0; i--) {
      const layer = frame.layers[i];
      const row = document.createElement('div');
      row.className = 'stage-prefab-row';
      if (i === currentLayer) row.style.outline = '1px solid var(--accent)';
      const vis = document.createElement('input');
      vis.type = 'checkbox'; vis.checked = layer.visible; vis.title = 'Visible';
      vis.addEventListener('change', () => { layer.visible = vis.checked; drawCanvas(); refreshFrameStrip(); });
      row.appendChild(vis);
      const label = document.createElement('span');
      label.textContent = layer.name;
      label.style.cursor = 'pointer';
      label.addEventListener('click', () => { currentLayer = i; refreshLayers(); });
      label.addEventListener('dblclick', () => {
        const name = prompt('Layer name?', layer.name);
        if (name) { layer.name = name; refreshLayers(); }
      });
      row.appendChild(label);
      const op = document.createElement('input');
      op.type = 'range'; op.min = '0'; op.max = '1'; op.step = '0.05'; op.value = String(layer.opacity);
      op.style.width = '52px'; op.title = 'Opacity';
      op.addEventListener('input', () => { layer.opacity = Number(op.value); drawCanvas(); });
      row.appendChild(op);
      const upBtn = makeBtn('\u25b2', () => { currentLayer = atelier.moveLayer(frame, i, 1); renderAll(); });
      const dnBtn = makeBtn('\u25bc', () => { currentLayer = atelier.moveLayer(frame, i, -1); renderAll(); });
      const delBtn = makeBtn('\u2715', () => {
        if (!atelier.removeLayer(frame, i)) { ctx.toast('A frame needs at least one layer.', true); return; }
        currentLayer = Math.max(0, Math.min(currentLayer, frame.layers.length - 1));
        renderAll();
      });
      delBtn.className += ' bad-btn';
      row.appendChild(upBtn); row.appendChild(dnBtn); row.appendChild(delBtn);
      layersList.appendChild(row);
    }
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
      img.src = atelier.frameToDataURL(frame, working.w, working.h);
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
    const box = atelier.computeHitbox(working.frames[currentFrame], working.w, working.h);
    hitboxInfo.textContent = 'x:' + box[0].toFixed(2) + ' y:' + box[1].toFixed(2) +
      ' w:' + box[2].toFixed(2) + ' h:' + box[3].toFixed(2) + ' (normalized to the frame)';
  }

  function renderAll() {
    nameInput.value = working.name;
    refreshSpriteSelect();
    refreshToolbar();
    refreshLayers();
    drawCanvas();
    refreshFrameStrip();
    refreshHitbox();
  }

  /* ---------------------------------------------------------------- */
  /* painting                                                           */
  /* ---------------------------------------------------------------- */
  let painting = false;

  function pixelAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return [
      Math.floor((clientX - rect.left) / rect.width * working.w),
      Math.floor((clientY - rect.top) / rect.height * working.h)
    ];
  }

  function paintAt(clientX, clientY) {
    const [px, py] = pixelAt(clientX, clientY);
    const frame = working.frames[currentFrame];
    const color = tool === 'erase' ? null : currentColor;
    atelier.setPixel(frame, currentLayer, px, py, working.w, working.h, color);
    if (mirror) atelier.setPixel(frame, currentLayer, working.w - 1 - px, py, working.w, working.h, color);
    drawCanvas();
  }

  canvas.addEventListener('pointerdown', (e) => {
    const [px, py] = pixelAt(e.clientX, e.clientY);
    const frame = working.frames[currentFrame];
    if (tool === 'pick') {
      const picked = atelier.getCompositePixel(frame, px, py, working.w, working.h);
      if (picked) { currentColor = picked; tool = 'draw'; refreshToolbar(); }
      return;
    }
    if (tool === 'select') {
      anchor = [px, py];
      sel = null;
      return;
    }
    if (tool === 'fill') {
      atelier.floodFill(frame, currentLayer, px, py, working.w, working.h, currentColor);
      drawCanvas(); refreshFrameStrip(); refreshHitbox();
      return;
    }
    if (tool === 'line' || tool === 'rect') {
      anchor = [px, py];   // committed on release
      return;
    }
    painting = true;
    paintAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => { if (painting) paintAt(e.clientX, e.clientY); });
  window.addEventListener('pointerup', (e) => {
    if (anchor && tool === 'select') {
      const [px, py] = pixelAt(e.clientX, e.clientY);
      const cw = (v) => Math.max(0, Math.min(working.w - 1, v)); const chh = (v) => Math.max(0, Math.min(working.h - 1, v));
      sel = [
        cw(Math.min(anchor[0], px)), chh(Math.min(anchor[1], py)),
        cw(Math.max(anchor[0], px)), chh(Math.max(anchor[1], py))
      ];
      if (sel[2] - sel[0] < 1 && sel[3] - sel[1] < 1) sel = null; // a click clears
      anchor = null;
      drawCanvas();
      return;
    }
    if (anchor && (tool === 'line' || tool === 'rect')) {
      const [px, py] = pixelAt(e.clientX, e.clientY);
      const frame = working.frames[currentFrame];
      const op = tool === 'line' ? atelier.drawLine : atelier.drawRect;
      op(frame, currentLayer, anchor[0], anchor[1], px, py, working.w, working.h, currentColor);
      anchor = null;
      drawCanvas(); refreshFrameStrip(); refreshHitbox();
      return;
    }
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
