/**
 * @file atelier.js
 * @description Pixel Atelier data/logic: the pixel grid model (2 layers per
 * frame), a curated palette, compositing to a canvas/dataURL, auto-hitbox
 * suggestion, and saving a sprite into cartridge.assets.sprites (exported to
 * the Warehouse the same way every other asset is). The DOM lives in
 * panels/atelier-panel.js.
 * Ticket P3-8. Phase 3.
 */

/** Canvas resolutions. 16/32/64 per Article IX, plus 128/256 for big
 * sprites and imported PNGs. */
export const SIZES = [16, 32, 64, 128, 256];

/**
 * A small curated palette — enough range for a first cartridge without
 * overwhelming a kid with a full color wheel. Free-pick a custom color too.
 */
export const PALETTE = [
  '#0b0e16', '#232a3a', '#3b4a63', '#6fb2dc', '#6fd3ff', '#9fe6b3',
  '#67e39b', '#f0c463', '#e0a83a', '#ff6b8b', '#c95b8f', '#8a6bd6',
  '#ffffff', '#c7d0de', '#8a95ad', 'transparent'
];

/**
 * @param {number} size
 * @returns {{bg: Array<string|null>, fg: Array<string|null>}}
 */
export function createBlankFrame(size) {
  return { bg: new Array(size * size).fill(null), fg: new Array(size * size).fill(null) };
}

/**
 * @param {string} name
 * @param {number} size
 * @returns {any} a new, unsaved sprite — call saveSprite to add it to the cartridge
 */
export function createSprite(name, size) {
  return {
    id: '', name, size,
    frames: [createBlankFrame(size)],
    swatch: '#6fb2dc', thumbnail: null, hitbox: [0, 0, 1, 1]
  };
}

/**
 * @param {{bg: Array, fg: Array}} frame
 * @param {'bg'|'fg'} layer
 * @param {number} x @param {number} y @param {number} size
 * @param {string|null} color  null (or 'transparent') erases
 */
export function setPixel(frame, layer, x, y, size, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  frame[layer][y * size + x] = color === 'transparent' ? null : color;
}

/**
 * @param {{bg: Array, fg: Array}} frame
 * @param {'bg'|'fg'} layer
 * @param {number} x @param {number} y @param {number} size
 * @returns {string|null}
 */
export function getPixel(frame, layer, x, y, size) {
  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  return frame[layer][y * size + x];
}

/**
 * Composite a frame (bg under fg) onto a fresh canvas at 1 device pixel per
 * sprite pixel — callers scale up for on-screen editing.
 * @param {{bg: Array, fg: Array}} frame
 * @param {number} size
 * @returns {HTMLCanvasElement}
 */
export function compositeFrame(frame, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = frame.fg[y * size + x] || frame.bg[y * size + x];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

/**
 * @param {{bg: Array, fg: Array}} frame
 * @param {number} size
 * @returns {string} data URL
 */
export function frameToDataURL(frame, size) {
  return compositeFrame(frame, size).toDataURL('image/png');
}

/**
 * Bounding box of every non-transparent pixel across both layers, normalized
 * to 0..1 — the "auto-hitbox suggestion" Article IX calls for. Falls back to
 * the full canvas when the frame is entirely empty (nothing drawn yet).
 * @param {{bg: Array, fg: Array}} frame
 * @param {number} size
 * @returns {[number, number, number, number]} [x, y, w, h] normalized
 */
export function computeHitbox(frame, size) {
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (frame.fg[y * size + x] || frame.bg[y * size + x]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return [0, 0, 1, 1]; // nothing drawn — suggest the full frame
  return [minX / size, minY / size, (maxX - minX + 1) / size, (maxY - minY + 1) / size];
}

/**
 * A representative solid color for warehouse fallback display — the most
 * common non-transparent color across the composited frame.
 * @param {{bg: Array, fg: Array}} frame
 * @param {number} size
 * @returns {string}
 */
export function dominantColor(frame, size) {
  const counts = new Map();
  for (let i = 0; i < size * size; i++) {
    const color = frame.fg[i] || frame.bg[i];
    if (!color) continue;
    counts.set(color, (counts.get(color) || 0) + 1);
  }
  let best = '#6fb2dc', bestCount = 0;
  for (const [color, count] of counts) {
    if (count > bestCount) { best = color; bestCount = count; }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* saving into the cartridge                                           */
/* ------------------------------------------------------------------ */

/**
 * Save (create or update) a sprite into cartridge.assets.sprites, baking
 * frame 0's dataURL as the thumbnail and a dominant-color swatch as the
 * fallback. This IS "export to warehouse" — warehouse.js reads
 * cartridge.assets.sprites directly, no separate publish step.
 * @param {any} cartridge
 * @param {any} sprite  {id, name, size, frames}; id is assigned here if blank
 * @returns {string} the sprite's id
 */
export function saveSprite(cartridge, sprite) {
  if (!sprite.id) {
    const slug = String(sprite.name || 'sprite').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sprite';
    let id = slug, n = 2;
    while (cartridge.assets.sprites.find((s) => s.id === id)) { id = slug + '-' + n; n++; }
    sprite.id = id;
  }
  const frame0 = sprite.frames[0];
  const thumbnail = frameToDataURL(frame0, sprite.size);
  const swatch = dominantColor(frame0, sprite.size);
  const hitbox = computeHitbox(frame0, sprite.size);
  // Each frame keeps its raw bg/fg layers (so reopening this sprite can
  // restore true layer separation) AND a flattened dataURL (what the
  // renderer actually loads — see meshes.js). Losing the layers on a
  // dataURL-only round-trip would silently merge them the moment an author
  // reopens their own sprite to keep working on it.
  const frames = sprite.frames.map((f) => ({ bg: f.bg, fg: f.fg, dataURL: frameToDataURL(f, sprite.size) }));
  const existing = cartridge.assets.sprites.findIndex((s) => s.id === sprite.id);
  const record = { id: sprite.id, name: sprite.name, size: sprite.size, frames, swatch, thumbnail, hitbox };
  if (existing >= 0) cartridge.assets.sprites[existing] = record; else cartridge.assets.sprites.push(record);
  sprite.thumbnail = thumbnail; sprite.swatch = swatch; sprite.hitbox = hitbox;
  return sprite.id;
}

/**
 * Load a saved sprite back into an editable working copy — deep-cloned so
 * edits never touch the cartridge until saveSprite is called again.
 * @param {any} record  an entry from cartridge.assets.sprites
 * @returns {any} a working sprite, same shape createSprite returns
 */
export function loadSpriteForEditing(record) {
  return {
    id: record.id, name: record.name, size: record.size,
    frames: record.frames.map((f) => ({ bg: [...f.bg], fg: [...f.fg] })),
    swatch: record.swatch, thumbnail: record.thumbnail, hitbox: record.hitbox
  };
}

/**
 * @param {any} cartridge
 * @param {string} id
 * @returns {boolean}
 */
export function deleteSprite(cartridge, id) {
  const i = cartridge.assets.sprites.findIndex((s) => s.id === id);
  if (i < 0) return false;
  cartridge.assets.sprites.splice(i, 1);
  return true;
}

/* ------------------------------------------------------------------ */
/* tools                                                               */
/* ------------------------------------------------------------------ */

/**
 * Flood fill from (x, y): every connected pixel of the same color becomes
 * the new color.
 * @param {{bg: Array, fg: Array}} frame @param {'bg'|'fg'} layer
 * @param {number} x @param {number} y @param {number} size
 * @param {string|null} color
 */
export function floodFill(frame, layer, x, y, size, color) {
  const target = getPixel(frame, layer, x, y, size);
  const next = color === 'transparent' ? null : color;
  if (target === next) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
    if (frame[layer][cy * size + cx] !== target) continue;
    frame[layer][cy * size + cx] = next;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

/**
 * Bresenham line.
 * @param {{bg: Array, fg: Array}} frame @param {'bg'|'fg'} layer
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 * @param {number} size @param {string|null} color
 */
export function drawLine(frame, layer, x0, y0, x1, y1, size, color) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPixel(frame, layer, x0, y0, size, color);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/**
 * Rectangle outline between two corners.
 */
export function drawRect(frame, layer, x0, y0, x1, y1, size, color) {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
  for (let x = ax; x <= bx; x++) { setPixel(frame, layer, x, ay, size, color); setPixel(frame, layer, x, by, size, color); }
  for (let y = ay; y <= by; y++) { setPixel(frame, layer, ax, y, size, color); setPixel(frame, layer, bx, y, size, color); }
}

/**
 * Import an image into a fresh frame at the given canvas size — scaled to
 * fit, alpha under 50% becomes transparent, colors quantized to hex.
 * @param {HTMLImageElement} img @param {number} size
 * @returns {{bg: Array, fg: Array}}
 */
export function importImageToFrame(img, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = size >= 128; // crisp for pixel sizes, smooth for big
  const scale = Math.min(size / img.width, size / img.height);
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  ctx.drawImage(img, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
  const data = ctx.getImageData(0, 0, size, size).data;
  const frame = createBlankFrame(size);
  const hex = (n) => n.toString(16).padStart(2, '0');
  for (let i = 0; i < size * size; i++) {
    if (data[i * 4 + 3] < 128) continue;
    frame.bg[i] = '#' + hex(data[i * 4]) + hex(data[i * 4 + 1]) + hex(data[i * 4 + 2]);
  }
  return frame;
}
