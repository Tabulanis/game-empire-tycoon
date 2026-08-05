/**
 * @file atelier.js
 * @description Pixel Atelier data/logic: the layered pixel model (any number
 * of named layers per frame, each with opacity + visibility), a curated
 * palette, compositing to a canvas/dataURL, tools (fill, line, rect, blur),
 * PNG import, auto-hitbox, and saving into cartridge.assets.sprites. The
 * engine only ever consumes the flattened per-frame dataURL, so the layer
 * model is the editor's own business. Old two-layer (bg/fg) sprites migrate
 * on load. The DOM lives in panels/atelier-panel.js.
 * Ticket P3-8. Phase 3.
 */

/** Preset canvas resolutions; any custom square 8-512 is also legal. */
export const SIZES = [16, 32, 64, 128, 256];
export const MIN_SIZE = 8;
export const MAX_SIZE = 512;

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
 * @param {string} name @param {number} size
 * @returns {any} one layer
 */
export function createLayer(name, size) {
  return { name, pixels: new Array(size * size).fill(null), opacity: 1, visible: true };
}

/**
 * @param {number} size
 * @returns {{layers: Array}} a frame with one starting layer
 */
export function createBlankFrame(size) {
  return { layers: [createLayer('Layer 1', size)] };
}

/**
 * Migrate any frame shape to the layered model: old {bg, fg} frames become
 * two layers; layered frames pass through (deep-cloned).
 * @param {any} frame @param {number} size
 * @returns {{layers: Array}}
 */
export function migrateFrame(frame, size) {
  if (frame.layers) {
    return {
      layers: frame.layers.map((l) => ({
        name: l.name || 'Layer', pixels: [...l.pixels],
        opacity: l.opacity == null ? 1 : l.opacity,
        visible: l.visible !== false
      }))
    };
  }
  const back = createLayer('Back', size); back.pixels = [...(frame.bg || [])];
  const front = createLayer('Front', size); front.pixels = [...(frame.fg || [])];
  if (back.pixels.length !== size * size) back.pixels = new Array(size * size).fill(null);
  if (front.pixels.length !== size * size) front.pixels = new Array(size * size).fill(null);
  return { layers: [back, front] };
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
 * @param {any} frame @param {number} layerIndex
 * @param {number} x @param {number} y @param {number} size
 * @param {string|null} color  null (or 'transparent') erases
 */
export function setPixel(frame, layerIndex, x, y, size, color) {
  const layer = frame.layers[layerIndex];
  if (!layer || x < 0 || y < 0 || x >= size || y >= size) return;
  layer.pixels[y * size + x] = color === 'transparent' ? null : color;
}

/**
 * @returns {string|null}
 */
export function getPixel(frame, layerIndex, x, y, size) {
  const layer = frame.layers[layerIndex];
  if (!layer || x < 0 || y < 0 || x >= size || y >= size) return null;
  return layer.pixels[y * size + x];
}

/** Topmost visible color at (x, y) — what the eyedropper sees. */
export function getCompositePixel(frame, x, y, size) {
  for (let i = frame.layers.length - 1; i >= 0; i--) {
    const layer = frame.layers[i];
    if (!layer.visible) continue;
    const c = layer.pixels[y * size + x];
    if (c) return c;
  }
  return null;
}

/**
 * Composite a frame (layers bottom-up, honoring opacity + visibility) onto
 * a fresh canvas at 1 device pixel per sprite pixel.
 * @param {any} frame @param {number} size
 * @returns {HTMLCanvasElement}
 */
export function compositeFrame(frame, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (const layer of frame.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.globalAlpha = layer.opacity;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const color = layer.pixels[y * size + x];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  ctx.globalAlpha = 1;
  return canvas;
}

/** @returns {string} data URL */
export function frameToDataURL(frame, size) {
  return compositeFrame(frame, size).toDataURL('image/png');
}

/**
 * Bounding box of every visible pixel, normalized 0..1 — the auto-hitbox.
 * Falls back to the full canvas when the frame is empty.
 * @returns {[number, number, number, number]} [x, y, w, h]
 */
export function computeHitbox(frame, size) {
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (getCompositePixel(frame, x, y, size)) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return [0, 0, 1, 1];
  return [minX / size, minY / size, (maxX - minX + 1) / size, (maxY - minY + 1) / size];
}

/** Most common visible color — the sprite's warehouse swatch. */
export function dominantColor(frame, size) {
  const counts = {};
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = getCompositePixel(frame, x, y, size);
      if (c) counts[c] = (counts[c] || 0) + 1;
    }
  }
  let best = '#6fb2dc', bestN = 0;
  for (const [c, n] of Object.entries(counts)) if (n > bestN) { best = c; bestN = n; }
  return best;
}

/* ------------------------------------------------------------------ */
/* layers                                                              */
/* ------------------------------------------------------------------ */

/** @returns {number} new layer's index (added on top) */
export function addLayer(frame, size) {
  frame.layers.push(createLayer('Layer ' + (frame.layers.length + 1), size));
  return frame.layers.length - 1;
}

/** @returns {boolean} */
export function removeLayer(frame, index) {
  if (frame.layers.length <= 1) return false;
  frame.layers.splice(index, 1);
  return true;
}

/** Move a layer up (+1, toward the front) or down (-1). @returns {number} new index */
export function moveLayer(frame, index, dir) {
  const to = index + dir;
  if (to < 0 || to >= frame.layers.length) return index;
  const [layer] = frame.layers.splice(index, 1);
  frame.layers.splice(to, 0, layer);
  return to;
}

/* ------------------------------------------------------------------ */
/* tools                                                               */
/* ------------------------------------------------------------------ */

/**
 * Flood fill from (x, y) on one layer.
 */
export function floodFill(frame, layerIndex, x, y, size, color) {
  const layer = frame.layers[layerIndex];
  if (!layer) return;
  const target = getPixel(frame, layerIndex, x, y, size);
  const next = color === 'transparent' ? null : color;
  if (target === next) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
    if (layer.pixels[cy * size + cx] !== target) continue;
    layer.pixels[cy * size + cx] = next;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

/** Bresenham line on one layer. */
export function drawLine(frame, layerIndex, x0, y0, x1, y1, size, color) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPixel(frame, layerIndex, x0, y0, size, color);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Rectangle outline between two corners on one layer. */
export function drawRect(frame, layerIndex, x0, y0, x1, y1, size, color) {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
  for (let x = ax; x <= bx; x++) { setPixel(frame, layerIndex, x, ay, size, color); setPixel(frame, layerIndex, x, by, size, color); }
  for (let y = ay; y <= by; y++) { setPixel(frame, layerIndex, ax, y, size, color); setPixel(frame, layerIndex, bx, y, size, color); }
}

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');

/**
 * Box blur (3×3) on one layer, alpha-aware — optionally only inside a
 * selection rect [x0, y0, x1, y1] inclusive.
 * @param {any} frame @param {number} layerIndex @param {number} size
 * @param {number[]} [sel]
 */
export function blurLayer(frame, layerIndex, size, sel) {
  const layer = frame.layers[layerIndex];
  if (!layer) return;
  const [ax, ay, bx, by] = sel || [0, 0, size - 1, size - 1];
  const src = layer.pixels;
  const out = [...src];
  const parse = (c) => c ? [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255] : [0, 0, 0, 0];
  for (let y = Math.max(0, ay); y <= Math.min(size - 1, by); y++) {
    for (let x = Math.max(0, ax); x <= Math.min(size - 1, bx); x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cx = x + ox, cy = y + oy;
          if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
          const [pr, pg, pb, pa] = parse(src[cy * size + cx]);
          r += pr * pa; g += pg * pa; b += pb * pa; a += pa; n++;
        }
      }
      if (!n || a < n * 25) { out[y * size + x] = null; continue; }
      out[y * size + x] = '#' + hex2(r / a) + hex2(g / a) + hex2(b / a);
    }
  }
  layer.pixels = out;
}

/**
 * Clear (erase) a selection rect on one layer.
 */
export function clearRegion(frame, layerIndex, size, sel) {
  const [ax, ay, bx, by] = sel;
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) setPixel(frame, layerIndex, x, y, size, null);
}

/**
 * Import an image into a fresh single-layer frame at the given size.
 * @param {HTMLImageElement} img @param {number} size
 * @returns {any} frame
 */
export function importImageToFrame(img, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = size >= 128;
  const scale = Math.min(size / img.width, size / img.height);
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  ctx.drawImage(img, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
  const data = ctx.getImageData(0, 0, size, size).data;
  const frame = createBlankFrame(size);
  frame.layers[0].name = 'Imported';
  for (let i = 0; i < size * size; i++) {
    if (data[i * 4 + 3] < 128) continue;
    frame.layers[0].pixels[i] = '#' + hex2(data[i * 4]) + hex2(data[i * 4 + 1]) + hex2(data[i * 4 + 2]);
  }
  return frame;
}

/* ------------------------------------------------------------------ */
/* export                                                              */
/* ------------------------------------------------------------------ */

/**
 * @param {any} frame @param {number} size
 * @param {'png'|'jpeg'} format  JPEG gets a white ground (no alpha there)
 * @returns {string} data URL
 */
export function exportFrame(frame, size, format) {
  const composite = compositeFrame(frame, size);
  if (format === 'jpeg') {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(composite, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
  }
  return composite.toDataURL('image/png');
}

/* ------------------------------------------------------------------ */
/* saving into the cartridge                                           */
/* ------------------------------------------------------------------ */

/**
 * Save (create or update) a sprite. Each frame keeps its full layer stack
 * (reopening restores true separation) AND a flattened dataURL — the only
 * part the renderer (meshes.js) ever reads.
 * @param {any} cartridge @param {any} sprite
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
  const frames = sprite.frames.map((f) => ({
    layers: f.layers.map((l) => ({ name: l.name, pixels: [...l.pixels], opacity: l.opacity, visible: l.visible })),
    dataURL: frameToDataURL(f, sprite.size)
  }));
  const existing = cartridge.assets.sprites.findIndex((s) => s.id === sprite.id);
  const record = { id: sprite.id, name: sprite.name, size: sprite.size, frames, swatch, thumbnail, hitbox };
  if (existing >= 0) cartridge.assets.sprites[existing] = record; else cartridge.assets.sprites.push(record);
  sprite.thumbnail = thumbnail; sprite.swatch = swatch; sprite.hitbox = hitbox;
  return sprite.id;
}

/**
 * Load a saved sprite back into an editable working copy — deep-cloned, and
 * migrated to the layered model if it predates it.
 * @param {any} record
 * @returns {any}
 */
export function loadSpriteForEditing(record) {
  return {
    id: record.id, name: record.name, size: record.size,
    frames: record.frames.map((f) => migrateFrame(f, record.size)),
    swatch: record.swatch, thumbnail: record.thumbnail, hitbox: record.hitbox
  };
}

/**
 * @returns {boolean}
 */
export function deleteSprite(cartridge, id) {
  const i = cartridge.assets.sprites.findIndex((s) => s.id === id);
  if (i < 0) return false;
  cartridge.assets.sprites.splice(i, 1);
  return true;
}
