/**
 * @file warehouse-panel.js
 * @description Warehouse browser UI: searchable grid of bundled CC0 assets,
 * grouped by pack, draggable via the Stage payload contract. Ticket P0-4.
 * Phase 0.
 */

import * as wh from '../warehouse.js';

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderWarehousePanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Warehouse</h2>' +
    '<div class="sub">Bundled CC0 assets. Drag an item toward the Stage once Phase 2 opens &mdash; ' +
    'the drag payload contract is already live.</div>';

  const search = document.createElement('input');
  search.className = 'wh-search';
  search.placeholder = 'search assets \u2014 e.g. "tile forest" or "character"';
  search.setAttribute('aria-label', 'Search warehouse');
  panel.appendChild(search);

  const results = document.createElement('div');
  panel.appendChild(results);
  host.appendChild(panel);

  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => draw(results, search.value, ctx), 120);
  });

  draw(results, '', ctx);
}

/**
 * @param {HTMLElement} mount
 * @param {string} query
 * @param {{toast: Function}} ctx
 */
async function draw(mount, query, ctx) {
  const items = await wh.search(query);
  mount.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'stub';
    empty.innerHTML = query
      ? 'Nothing matches <b>' + escapeHtml(query) + '</b>.'
      : '<b>The warehouse is empty.</b><br />Drop CC0 packs into <code>src/data/warehouse/</code> ' +
        'and list them in <code>index.json</code>.';
    mount.appendChild(empty);
    return;
  }

  const byPack = new Map();
  for (const item of items) {
    if (!byPack.has(item.packId)) byPack.set(item.packId, []);
    byPack.get(item.packId).push(item);
  }

  for (const [packId, packItems] of byPack) {
    const head = document.createElement('div');
    head.className = 'wh-pack';
    head.textContent = packItems[0].packName + ' \u00B7 ' + packItems[0].license +
      ' \u00B7 ' + packItems.length + ' item' + (packItems.length === 1 ? '' : 's');
    mount.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'wh-grid';
    for (const item of packItems) grid.appendChild(itemCell(item, ctx));
    mount.appendChild(grid);
  }
}

/**
 * @param {any} item
 * @param {{toast: Function}} ctx
 * @returns {HTMLElement}
 */
function itemCell(item, ctx) {
  const cell = document.createElement('div');
  cell.className = 'wh-item';
  cell.draggable = true;
  cell.title = (item.tags || []).join(', ');

  const thumb = document.createElement('div');
  thumb.className = 'wh-thumb';
  if (item.thumbnail) {
    thumb.style.background = item.swatch || '#232a3a';
    const img = document.createElement('img');
    img.src = item.thumbnail;
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;image-rendering:pixelated;';
    thumb.appendChild(img);
  } else {
    thumb.style.background = item.swatch || '#232a3a';
    thumb.textContent = wh.glyphFor(item.kind);
  }
  cell.appendChild(thumb);

  const name = document.createElement('div');
  name.className = 'wh-name';
  name.textContent = item.name;
  cell.appendChild(name);

  const kind = document.createElement('div');
  kind.className = 'wh-kind';
  kind.textContent = item.kind;
  cell.appendChild(kind);

  cell.addEventListener('dragstart', (e) => wh.attachDragPayload(e, item));
  cell.addEventListener('click', () => ctx.toast(item.name + ' \u00B7 ' + item.license + ' \u00B7 ' + item.source));
  return cell;
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
