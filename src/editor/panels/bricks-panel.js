/**
 * @file bricks-panel.js
 * @description Brick Workshop tab: pick a bricksheet, add cards, and build
 * each card's WHEN / IF / DO out of the catalog. Mirrors the Stage panel's
 * structure (module-level state that survives tab re-renders, a teardown
 * observer). Ticket P3-7. Phase 3.
 */

import * as cart from '../cartridge.js';
import * as bricks from '../bricks.js';
import { GATED_BRICKS, isUnlocked } from '../codex.js';

let currentSheetId = null;
/** @type {Array<any>} */
let brickCatalog = [];
/** @type {Array<any>} */
let codexCatalog = [];

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderBricksPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Bricks</h2>' +
    '<div class="sub">Build behavior out of WHEN / IF / DO cards — the same grammar for every entity in the game. ' +
    'No loops, no expressions: just named counters and the cards you can see.</div>';

  const layout = document.createElement('div');
  layout.className = 'bricks-layout';

  // ---------- left: sheet list ----------
  const sheetCard = document.createElement('div');
  sheetCard.className = 'card';
  sheetCard.innerHTML = '<h3>Bricksheets</h3>';
  const sheetList = document.createElement('div');
  sheetCard.appendChild(sheetList);
  const newSheetBtn = makeBtn('+ New Sheet', () => {
    const name = prompt('Name for the new bricksheet?', 'sheet');
    if (name === null) return;
    const live = cart.getCartridge();
    const id = bricks.createSheet(live, name);
    cart.touch();
    currentSheetId = id;
    ctx.refresh();
  });
  newSheetBtn.style.width = '100%';
  newSheetBtn.style.marginTop = '8px';
  sheetCard.appendChild(newSheetBtn);
  layout.appendChild(sheetCard);

  // ---------- middle: card editor ----------
  const editorCard = document.createElement('div');
  editorCard.className = 'card';
  const editorHead = document.createElement('div');
  editorHead.style.display = 'flex';
  editorHead.style.alignItems = 'center';
  editorHead.style.gap = '8px';
  editorHead.style.marginBottom = '8px';
  const editorTitle = document.createElement('h3');
  editorTitle.style.margin = '0';
  editorHead.appendChild(editorTitle);
  const renameBtn = makeBtn('Rename', () => {
    if (!currentSheetId) return;
    const name = prompt('New name?', currentSheetId);
    if (name === null) return;
    const live = cart.getCartridge();
    const newId = bricks.renameSheet(live, currentSheetId, name);
    if (!newId) { ctx.toast('That name is taken or unchanged.', true); return; }
    cart.touch();
    currentSheetId = newId;
    ctx.refresh();
  });
  const deleteBtn = makeBtn('Delete', () => {
    if (!currentSheetId) return;
    if (!confirm('Delete bricksheet "' + currentSheetId + '"? Entities using it will need a new one.')) return;
    const live = cart.getCartridge();
    bricks.deleteSheet(live, currentSheetId);
    cart.touch();
    currentSheetId = null;
    ctx.refresh();
  });
  deleteBtn.className += ' bad-btn';
  editorHead.appendChild(renameBtn);
  editorHead.appendChild(deleteBtn);
  editorCard.appendChild(editorHead);

  const cardList = document.createElement('div');
  editorCard.appendChild(cardList);

  const addCardBtn = makeBtn('+ Card', () => {
    if (!currentSheetId) return;
    const live = cart.getCartridge();
    bricks.addCard(live, currentSheetId);
    cart.touch();
    ctx.refresh();
  });
  addCardBtn.style.width = '100%';
  addCardBtn.style.marginTop = '6px';
  editorCard.appendChild(addCardBtn);
  layout.appendChild(editorCard);

  // ---------- right: catalog reference ----------
  const catalogCard = document.createElement('div');
  catalogCard.className = 'card';
  catalogCard.innerHTML = '<h3>Catalog</h3>';
  const catalogList = document.createElement('div');
  catalogCard.appendChild(catalogList);
  layout.appendChild(catalogCard);

  panel.appendChild(layout);
  host.appendChild(panel);

  /* ---------------------------------------------------------------- */
  /* rendering                                                         */
  /* ---------------------------------------------------------------- */

  function refreshSheetList() {
    const live = cart.getCartridge();
    const ids = bricks.listSheets(live);
    if (!currentSheetId || !ids.includes(currentSheetId)) currentSheetId = ids[0] || null;
    sheetList.innerHTML = '';
    if (!ids.length) {
      sheetList.innerHTML = '<div class="stage-hint">No bricksheets yet.</div>';
    }
    for (const id of ids) {
      const row = document.createElement('div');
      row.className = 'brick-sheet-row' + (id === currentSheetId ? ' selected' : '');
      const label = document.createElement('span');
      label.textContent = id + ' (' + live.bricksheets[id].length + ')';
      row.appendChild(label);
      row.addEventListener('click', () => { currentSheetId = id; renderAll(); });
      sheetList.appendChild(row);
    }
  }

  function refreshCardEditor() {
    editorTitle.textContent = currentSheetId ? currentSheetId : 'No sheet selected';
    renameBtn.style.display = currentSheetId ? '' : 'none';
    deleteBtn.style.display = currentSheetId ? '' : 'none';
    addCardBtn.style.display = currentSheetId ? '' : 'none';
    cardList.innerHTML = '';
    if (!currentSheetId) {
      cardList.innerHTML = '<div class="stage-hint">Create or pick a bricksheet on the left to start adding cards.</div>';
      return;
    }
    const live = cart.getCartridge();
    const cards = live.bricksheets[currentSheetId] || [];
    if (!cards.length) {
      cardList.innerHTML = '<div class="stage-hint">No cards yet — add one below.</div>';
    }
    cards.forEach((card, index) => cardList.appendChild(buildCardEl(card, index, cards.length)));
  }

  function refreshCatalog() {
    catalogList.innerHTML = '';
    for (const brick of brickCatalog) {
      const codex = codexCatalog.find((c) => c.id === brick.id);
      const el = document.createElement('div');
      el.className = 'brick-catalog-item';
      el.innerHTML = '<b>' + escapeHtml(brick.label) + '</b> <span style="color:var(--dim);font-size:10px;">(' +
        brick.category.toUpperCase() + ')</span><div>' + escapeHtml(codex ? codex.oneLiner : brick.description) + '</div>';
      catalogList.appendChild(el);
    }
  }

  function renderAll() {
    refreshSheetList();
    refreshCardEditor();
  }

  /* ---------------------------------------------------------------- */
  /* card element builder                                              */
  /* ---------------------------------------------------------------- */

  /**
   * @param {any} card
   * @param {number} index
   * @param {number} total
   * @returns {HTMLElement}
   */
  function buildCardEl(card, index, total) {
    const el = document.createElement('div');
    el.className = 'brick-card';

    // head: WHEN select + card-level controls
    const head = document.createElement('div');
    head.className = 'brick-card-head';

    const whenSelect = document.createElement('select');
    const blankOpt = document.createElement('option');
    blankOpt.value = ''; blankOpt.textContent = '— choose WHEN —';
    whenSelect.appendChild(blankOpt);
    for (const brick of brickCatalog.filter((b) => b.category === 'when')) {
      const opt = document.createElement('option');
      const locked = GATED_BRICKS.has(brick.id) && !isUnlocked(brick.id);
      opt.value = brick.id; opt.textContent = (locked ? '\u{1F512} ' : '') + brick.label;
      if (card.when === brick.id) opt.selected = true;
      whenSelect.appendChild(opt);
    }
    whenSelect.addEventListener('change', () => {
      const brickDef = bricks.findBrick(brickCatalog, whenSelect.value);
      if (brickDef && GATED_BRICKS.has(brickDef.id) && !isUnlocked(brickDef.id)) {
        ctx.toast(brickDef.label + ' is locked — run its sandbox in the Codex to unlock it.', true);
        whenSelect.value = card.when || '';
        return;
      }
      if (!brickDef) { card.when = null; } else { bricks.setCardWhen(card, brickDef); }
      cart.touch();
      renderAll();
    });
    head.appendChild(whenSelect);

    const upBtn = makeBtn('\u2191', () => { const live = cart.getCartridge(); bricks.moveCard(live, currentSheetId, index, -1); cart.touch(); renderAll(); });
    const downBtn = makeBtn('\u2193', () => { const live = cart.getCartridge(); bricks.moveCard(live, currentSheetId, index, 1); cart.touch(); renderAll(); });
    if (index === 0) upBtn.disabled = true;
    if (index === total - 1) downBtn.disabled = true;
    const delBtn = makeBtn('\u2715', () => { const live = cart.getCartridge(); bricks.removeCard(live, currentSheetId, index); cart.touch(); renderAll(); });
    delBtn.className += ' bad-btn';
    head.appendChild(upBtn); head.appendChild(downBtn); head.appendChild(delBtn);
    el.appendChild(head);

    // WHEN params (inline, on the card itself — e.g. "from: above")
    if (card.when) {
      const whenDef = bricks.findBrick(brickCatalog, card.when);
      if (whenDef && whenDef.params.length) {
        const row = document.createElement('div');
        row.className = 'brick-row';
        for (const p of whenDef.params) row.appendChild(buildParamInput(card, p, () => { cart.touch(); }));
        el.appendChild(row);
      }
      const codex = codexCatalog.find((c) => c.id === card.when);
      if (codex) {
        const hint = document.createElement('div');
        hint.className = 'brick-hint';
        hint.textContent = codex.oneLiner;
        el.appendChild(hint);
      }
    }

    // IF section
    const ifLabel = document.createElement('div');
    ifLabel.className = 'brick-section-label';
    ifLabel.textContent = 'IF (all must be true)';
    el.appendChild(ifLabel);
    const ifSection = document.createElement('div');
    ifSection.className = 'brick-section';
    (card.if || []).forEach((cond, ci) => {
      const brickDef = bricks.findBrick(brickCatalog, cond.check);
      const row = document.createElement('div');
      row.className = 'brick-row';
      const label = document.createElement('span');
      label.textContent = brickDef ? brickDef.label : cond.check;
      label.style.minWidth = '110px';
      row.appendChild(label);
      if (brickDef) {
        for (const p of brickDef.params) row.appendChild(buildParamInput(cond, p, () => cart.touch()));
      }
      const rm = makeBtn('\u2715', () => { bricks.removeCondition(card, ci); cart.touch(); renderAll(); });
      rm.className += ' bad-btn';
      row.appendChild(rm);
      ifSection.appendChild(row);
    });
    const addIfSelect = buildAddSelect('if', '+ Condition', (brickDef) => {
      bricks.addCondition(card, brickDef);
      cart.touch();
      renderAll();
    });
    ifSection.appendChild(addIfSelect);
    el.appendChild(ifSection);

    // DO section
    const doLabel = document.createElement('div');
    doLabel.className = 'brick-section-label';
    doLabel.textContent = 'DO (in order)';
    el.appendChild(doLabel);
    const doSection = document.createElement('div');
    doSection.className = 'brick-section';
    (card.do || []).forEach((action, ai) => {
      const brickDef = bricks.findBrick(brickCatalog, action.do);
      const row = document.createElement('div');
      row.className = 'brick-row';
      const label = document.createElement('span');
      label.textContent = brickDef ? brickDef.label : action.do;
      label.style.minWidth = '110px';
      row.appendChild(label);
      if (brickDef) {
        for (const p of brickDef.params) row.appendChild(buildParamInput(action, p, () => cart.touch()));
      }
      const upA = makeBtn('\u2191', () => { bricks.moveAction(card, ai, -1); cart.touch(); renderAll(); });
      const downA = makeBtn('\u2193', () => { bricks.moveAction(card, ai, 1); cart.touch(); renderAll(); });
      if (ai === 0) upA.disabled = true;
      if (ai === card.do.length - 1) downA.disabled = true;
      const rm = makeBtn('\u2715', () => { bricks.removeAction(card, ai); cart.touch(); renderAll(); });
      rm.className += ' bad-btn';
      row.appendChild(upA); row.appendChild(downA); row.appendChild(rm);
      doSection.appendChild(row);
    });
    const addDoSelect = buildAddSelect('do', '+ Action', (brickDef) => {
      bricks.addAction(card, brickDef);
      cart.touch();
      renderAll();
    });
    doSection.appendChild(addDoSelect);
    el.appendChild(doSection);

    return el;
  }

  /**
   * A "+ X" control implemented as a select that immediately fires on
   * choosing a real option, then resets to its placeholder.
   * @param {'if'|'do'} category
   * @param {string} placeholder
   * @param {(brickDef: any) => void} onPick
   * @returns {HTMLSelectElement}
   */
  function buildAddSelect(category, placeholder, onPick) {
    const select = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = placeholder;
    select.appendChild(blank);
    for (const brick of brickCatalog.filter((b) => b.category === category)) {
      const opt = document.createElement('option');
      const locked = GATED_BRICKS.has(brick.id) && !isUnlocked(brick.id);
      opt.value = brick.id; opt.textContent = (locked ? '\u{1F512} ' : '') + brick.label;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      if (!select.value) return;
      const brickDef = bricks.findBrick(brickCatalog, select.value);
      if (!brickDef) return;
      if (GATED_BRICKS.has(brickDef.id) && !isUnlocked(brickDef.id)) {
        ctx.toast(brickDef.label + ' is locked — run its sandbox in the Codex to unlock it.', true);
        select.value = '';
        return;
      }
      onPick(brickDef);
      select.value = '';
    });
    return select;
  }

  /**
   * Render one param's input control, wired to read/write it directly on
   * `target[param.name]`.
   * @param {any} target  the card, condition, or action object
   * @param {any} param  {name, type, default, label}
   * @param {() => void} onChange
   * @returns {HTMLElement}
   */
  function buildParamInput(target, param, onChange) {
    const wrap = document.createElement('span');
    wrap.className = 'brick-param';
    const labelText = document.createElement('span');
    labelText.textContent = param.label + ':';
    wrap.appendChild(labelText);

    if (param.type === 'number') {
      const input = document.createElement('input');
      input.type = 'number';
      input.value = target[param.name] !== undefined && target[param.name] !== null ? target[param.name] : (param.default || 0);
      input.addEventListener('change', () => { target[param.name] = Number(input.value); onChange(); });
      wrap.appendChild(input);
    } else if (param.type === 'boolean') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = target[param.name] !== undefined ? !!target[param.name] : !!param.default;
      input.addEventListener('change', () => { target[param.name] = input.checked; onChange(); });
      wrap.appendChild(input);
    } else if (param.type.startsWith('enum:')) {
      const options = param.type.slice(5).split(',');
      const select = document.createElement('select');
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = o;
        if ((target[param.name] || param.default) === o) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => { target[param.name] = select.value; onChange(); });
      wrap.appendChild(select);
    } else if (param.type === 'point') {
      const px = document.createElement('input'); px.type = 'number'; px.style.width = '48px';
      const py = document.createElement('input'); py.type = 'number'; py.style.width = '48px';
      const cur = target[param.name] || [0, 0];
      px.value = cur[0]; py.value = cur[1];
      function sync() { target[param.name] = [Number(px.value), Number(py.value)]; onChange(); }
      px.addEventListener('change', sync); py.addEventListener('change', sync);
      wrap.appendChild(px); wrap.appendChild(py);
    } else if (param.type === 'points') {
      wrap.appendChild(buildPointsEditor(target, param, onChange));
    } else if (param.type === 'prefab') {
      const select = document.createElement('select');
      const live = cart.getCartridge();
      const blank = document.createElement('option'); blank.value = ''; blank.textContent = '(none)';
      select.appendChild(blank);
      for (const id of Object.keys(live.prefabs || {})) {
        const opt = document.createElement('option');
        opt.value = id; opt.textContent = live.prefabs[id].name || id;
        if (target[param.name] === id) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => { target[param.name] = select.value || null; onChange(); });
      wrap.appendChild(select);
    } else {
      // string, tag, item, message — free text
      const input = document.createElement('input');
      input.type = 'text';
      input.value = target[param.name] || '';
      input.placeholder = param.default || '';
      input.addEventListener('change', () => { target[param.name] = input.value || null; onChange(); });
      wrap.appendChild(input);
    }
    return wrap;
  }

  /**
   * Minimal list-of-points editor for patrol-between / follow-path waypoints.
   * @param {any} target
   * @param {any} param
   * @param {() => void} onChange
   * @returns {HTMLElement}
   */
  function buildPointsEditor(target, param, onChange) {
    const container = document.createElement('div');
    container.className = 'brick-points-list';
    const points = target[param.name] && target[param.name].length ? target[param.name] : [];
    target[param.name] = points;

    function redraw() {
      container.innerHTML = '';
      points.forEach((pt, i) => {
        const row = document.createElement('div');
        row.className = 'brick-points-row';
        const px = document.createElement('input'); px.type = 'number'; px.style.width = '48px'; px.value = pt[0];
        const py = document.createElement('input'); py.type = 'number'; py.style.width = '48px'; py.value = pt[1];
        px.addEventListener('change', () => { pt[0] = Number(px.value); onChange(); });
        py.addEventListener('change', () => { pt[1] = Number(py.value); onChange(); });
        const rm = makeBtn('\u2715', () => { points.splice(i, 1); onChange(); redraw(); });
        rm.className += ' bad-btn';
        row.appendChild(px); row.appendChild(py); row.appendChild(rm);
        container.appendChild(row);
      });
      const addBtn = makeBtn('+ point', () => { points.push([0, 0]); onChange(); redraw(); });
      container.appendChild(addBtn);
    }
    redraw();
    return container;
  }

  /* ---------------------------------------------------------------- */
  /* boot                                                               */
  /* ---------------------------------------------------------------- */
  Promise.all([bricks.loadBrickCatalog(), bricks.loadCodexCatalog()]).then(([bc, cc]) => {
    brickCatalog = bc;
    codexCatalog = cc;
    refreshCatalog();
    renderAll();
  }).catch((err) => {
    ctx.toast('Could not load the brick catalog: ' + err.message, true);
  });

  refreshSheetList();
  refreshCardEditor();

  /* ---------------------------------------------------------------- */
  /* teardown (no persistent resources here — nothing to release)      */
  /* ---------------------------------------------------------------- */
}

function makeBtn(label, fn) {
  const b = document.createElement('button');
  b.className = 'bar';
  b.textContent = label;
  if (fn) b.addEventListener('click', fn);
  return b;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
