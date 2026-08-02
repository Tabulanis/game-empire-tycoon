/**
 * @file warehouse.js
 * @description Warehouse: the bundled CC0 asset library. Loads the pack index,
 * searches it, and exposes the drag-out payload contract the Stage will consume
 * at Phase 2. Ticket P0-4.
 * LICENSE LAW: only CC0 content is ever indexed here. Never vendor Mixamo clips.
 * Phase 0.
 */

import { getCartridge } from './cartridge.js';

/** MIME-ish type used on dataTransfer for warehouse drags. */
export const DRAG_TYPE = 'application/x-get-warehouse-item';

/** @type {{packs: Array<any>}|null} */
let index = null;

/**
 * Load and cache the warehouse index.
 * @returns {Promise<{packs: Array<any>}>}
 */
export async function loadIndex() {
  if (index) return index;
  try {
    const res = await fetch(new URL('../data/warehouse/index.json', import.meta.url));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    index = { packs: Array.isArray(data.packs) ? data.packs : [] };
  } catch (err) {
    console.warn('[warehouse] index load failed', err);
    index = { packs: [] };
  }
  return index;
}

/**
 * Flatten every pack into a single item list with pack context attached.
 * @returns {Promise<Array<any>>}
 */
export async function allItems() {
  const idx = await loadIndex();
  const out = [];
  for (const pack of idx.packs) {
    for (const item of (pack.items || [])) {
      out.push({
        ...item,
        packId: pack.id,
        packName: pack.name,
        license: pack.license,
        source: pack.source,
        tags: [...(pack.tags || []), ...(item.tags || [])]
      });
    }
  }
  out.push(...cartridgeItems());
  return out;
}

/**
 * Sprites (Pixel Atelier) and sfx (SFX Foundry) the author has made for THIS
 * cartridge — presented as a "My Assets" pack so the Stage's existing drag
 * contract needs no changes to accept them.
 * @returns {Array<any>}
 */
function cartridgeItems() {
  const cartridge = getCartridge();
  const out = [];
  for (const sprite of (cartridge.assets.sprites || [])) {
    out.push({
      id: sprite.id, name: sprite.name, kind: 'sprite',
      packId: 'cartridge', packName: 'My Assets', license: 'yours', source: 'cartridge',
      tags: ['custom'], swatch: sprite.swatch, thumbnail: sprite.thumbnail, assetId: sprite.id
    });
  }
  for (const sfx of (cartridge.assets.sfx || [])) {
    out.push({
      id: sfx.id, name: sfx.name, kind: 'sfx',
      packId: 'cartridge', packName: 'My Assets', license: 'yours', source: 'cartridge',
      tags: ['custom'], swatch: '#e0a83a', assetId: sfx.id
    });
  }
  for (const song of (cartridge.assets.songs || [])) {
    out.push({
      id: song.id, name: song.name, kind: 'song',
      packId: 'cartridge', packName: 'My Assets', license: 'yours', source: 'cartridge',
      tags: ['custom'], swatch: '#8a6bd6', assetId: song.id
    });
  }
  return out;
}

/**
 * Search items by free text across name, kind, tags, and pack name.
 * @param {string} query
 * @returns {Promise<Array<any>>}
 */
export async function search(query) {
  const items = await allItems();
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items;
  const terms = q.split(/\s+/);
  return items.filter((item) => {
    const hay = [item.name, item.kind, item.packName, ...(item.tags || [])]
      .join(' ')
      .toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * The drag-out contract. Phase 2's Stage reads exactly this shape.
 * @param {DragEvent} event
 * @param {any} item
 */
export function attachDragPayload(event, item) {
  const payload = {
    type: 'get/warehouse-item',
    packId: item.packId,
    itemId: item.id,
    kind: item.kind,
    name: item.name,
    path: item.path || null,
    assetId: item.assetId || null
  };
  const text = JSON.stringify(payload);
  if (event.dataTransfer) {
    event.dataTransfer.setData(DRAG_TYPE, text);
    event.dataTransfer.setData('text/plain', text);
    event.dataTransfer.effectAllowed = 'copy';
  }
}

/**
 * Read a warehouse payload from a drop event. Returns null when the drop
 * did not come from the warehouse.
 * @param {DragEvent} event
 * @returns {any|null}
 */
export function readDragPayload(event) {
  if (!event.dataTransfer) return null;
  const raw = event.dataTransfer.getData(DRAG_TYPE) || event.dataTransfer.getData('text/plain');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.type === 'get/warehouse-item' ? parsed : null;
  } catch (err) {
    return null;
  }
}

/** Emoji stand-in per asset kind, used until real thumbnails are bundled. */
const KIND_GLYPH = {
  sprite: '\u25A0',
  tile: '\u2591',
  model: '\u25C6',
  character: '\u265F',
  sfx: '\u266A',
  song: '\u266B',
  ui: '\u25A3'
};

/**
 * @param {string} kind
 * @returns {string}
 */
export function glyphFor(kind) {
  return KIND_GLYPH[kind] || '\u25CB';
}
