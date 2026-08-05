/**
 * @file materials.js
 * @description Material Maker data/logic: parameterized procedural texture
 * generation (slider-driven patterns, not fixed graphics) baked into four
 * PBR slots — diffuse (color), specular (shine-where-bright, wired to the
 * metalness map), roughness, and normal (bumps, computed from the pattern's
 * height via a Sobel filter). Saved materials live in
 * cartridge.assets.materials with every slot pre-baked to a dataURL, so
 * prefabs that wear them stay self-contained. The DOM lives in
 * panels/materials-panel.js; consumption is meshes.js (part.mat.matMaps).
 */

const SIZE = 128;

export const PATTERNS = ['plain', 'checker', 'bricks', 'stripes', 'dots', 'noise', 'wood', 'grid'];

export const SLOT_KINDS = ['diffuse', 'specular', 'roughness', 'normal'];

/** Deterministic PRNG — noisy patterns look identical every boot. */
function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {string} kind @returns {any} a slot's starting parameters */
export function defaultSlot(kind) {
  return {
    on: kind === 'diffuse',
    pattern: kind === 'diffuse' ? 'checker' : 'noise',
    scale: 4,
    colorA: '#8a6bd6',
    colorB: '#2b2440',
    level: kind === 'roughness' ? 0.7 : 0.5,
    strength: 0.6
  };
}

/** @returns {any} a blank, unsaved material */
export function createMaterial(name) {
  const slots = {};
  for (const kind of SLOT_KINDS) slots[kind] = defaultSlot(kind);
  return { id: '', name, slots };
}

/**
 * Draw one pattern as grayscale heights 0..1 into a Float32Array — the
 * single source every slot renders from (diffuse tints it, spec/rough
 * level it, normal differentiates it).
 * @param {any} slot @returns {Float32Array} SIZE*SIZE heights
 */
function patternHeights(slot) {
  const h = new Float32Array(SIZE * SIZE);
  const n = Math.max(1, Math.round(slot.scale));
  const cell = SIZE / n;
  const rand = mulberry(41);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const fx = (x % cell) / cell, fy = (y % cell) / cell;
      let v = 0.5;
      switch (slot.pattern) {
        case 'plain': v = 1; break;
        case 'checker': v = (cx + cy) % 2 ? 1 : 0; break;
        case 'stripes': v = cx % 2 ? 1 : 0; break;
        case 'grid': v = (fx < 0.08 || fy < 0.08) ? 0 : 1; break;
        case 'dots': {
          const dx = fx - 0.5, dy = fy - 0.5;
          v = Math.hypot(dx, dy) < 0.3 ? 1 : 0;
          break;
        }
        case 'bricks': {
          const off = cy % 2 ? 0.5 : 0;
          const bx = (fx + off) % 1;
          v = (bx < 0.06 || fy < 0.12) ? 0 : 1;
          break;
        }
        case 'wood': {
          // wavy vertical grain
          const wave = Math.sin((x / SIZE) * n * Math.PI * 2 + Math.sin(y / 9) * 1.4);
          v = 0.5 + wave * 0.5;
          break;
        }
        case 'noise':
        default:
          v = rand();
      }
      h[y * SIZE + x] = v;
    }
  }
  return h;
}

const hex2 = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
const parseHex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/**
 * Bake one slot to a canvas.
 * diffuse: heights blend colorB→colorA. specular/roughness: grayscale,
 * heights scaled around the Level slider. normal: Sobel of heights at
 * Strength, encoded as a tangent-space normal map.
 * @param {any} slot @param {string} kind
 * @returns {HTMLCanvasElement}
 */
export function bakeSlotCanvas(slot, kind) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const heights = patternHeights(slot);

  if (kind === 'normal') {
    const k = slot.strength * 4;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const hL = heights[y * SIZE + ((x - 1 + SIZE) % SIZE)];
        const hR = heights[y * SIZE + ((x + 1) % SIZE)];
        const hU = heights[((y - 1 + SIZE) % SIZE) * SIZE + x];
        const hD = heights[((y + 1) % SIZE) * SIZE + x];
        let nx = (hL - hR) * k, ny = (hD - hU) * k, nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len; ny /= len; nz /= len;
        const i = (y * SIZE + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
  } else if (kind === 'diffuse') {
    const a = parseHex(slot.colorA), b = parseHex(slot.colorB);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const t = heights[i];
      img.data[i * 4] = b[0] + (a[0] - b[0]) * t;
      img.data[i * 4 + 1] = b[1] + (a[1] - b[1]) * t;
      img.data[i * 4 + 2] = b[2] + (a[2] - b[2]) * t;
      img.data[i * 4 + 3] = 255;
    }
  } else {
    // specular / roughness: grayscale centered on Level
    for (let i = 0; i < SIZE * SIZE; i++) {
      const v = Math.max(0, Math.min(1, slot.level + (heights[i] - 0.5) * slot.strength)) * 255;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Bake every enabled slot to dataURLs — what gets stored and what the
 * engine loads. Diffuse always bakes (it's the face of the material).
 * @param {any} material
 * @returns {{diffuse: string, specular: string|null, roughness: string|null, normal: string|null}}
 */
export function bakeMaterial(material) {
  const out = {};
  for (const kind of SLOT_KINDS) {
    const slot = material.slots[kind];
    out[kind] = (kind === 'diffuse' || slot.on)
      ? bakeSlotCanvas(slot, kind).toDataURL('image/png')
      : null;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* saving into the cartridge                                           */
/* ------------------------------------------------------------------ */

/**
 * Save (create or update) a material into cartridge.assets.materials —
 * slot parameters for re-editing AND baked maps for consumption.
 * @param {any} cartridge @param {any} material
 * @returns {string} the material's id
 */
export function saveMaterial(cartridge, material) {
  if (!cartridge.assets.materials) cartridge.assets.materials = [];
  if (!material.id) {
    const slug = String(material.name || 'material').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'material';
    let id = slug, n = 2;
    while (cartridge.assets.materials.find((m) => m.id === id)) { id = slug + '-' + n; n++; }
    material.id = id;
  }
  const maps = bakeMaterial(material);
  const record = {
    id: material.id, name: material.name,
    slots: JSON.parse(JSON.stringify(material.slots)),
    maps
  };
  const existing = cartridge.assets.materials.findIndex((m) => m.id === material.id);
  if (existing >= 0) cartridge.assets.materials[existing] = record; else cartridge.assets.materials.push(record);
  return material.id;
}

/** @returns {boolean} */
export function deleteMaterial(cartridge, id) {
  if (!cartridge.assets.materials) return false;
  const i = cartridge.assets.materials.findIndex((m) => m.id === id);
  if (i < 0) return false;
  cartridge.assets.materials.splice(i, 1);
  return true;
}
