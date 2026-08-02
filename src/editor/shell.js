/**
 * @file shell.js
 * @description The app frame: top bar, tab strip, panel host, status bar, and
 * project management wiring. Ticket P0-1. Panels beyond Warehouse/Backups are
 * intentionally stubs until their phase opens (Constitution Article XII).
 * Phase 0.
 */

import * as cart from './cartridge.js';
import * as backup from './backup.js';
import { loadTemplate, applyTemplate } from './templates.js';
import { renderWarehousePanel } from './panels/warehouse-panel.js';
import { renderBackupsPanel } from './panels/backups-panel.js';
import { renderStudioPanel } from './panels/studio-panel.js';
import { renderAboutPanel } from './panels/about-panel.js';
import { renderDeckPanel } from './panels/deck-panel.js';
import { renderStagePanel } from './panels/stage-panel.js';
import { renderBricksPanel } from './panels/bricks-panel.js';
import { renderAtelierPanel } from './panels/atelier-panel.js';
import { renderFoundryPanel } from './panels/foundry-panel.js';
import { renderSoundboothPanel } from './panels/soundbooth-panel.js';
import { renderPitchPanel } from './panels/pitch-panel.js';
import { renderCodexPanel } from './panels/codex-panel.js';
import { renderKitbayPanel } from './panels/kitbay-panel.js';
import { renderLoftPanel } from './panels/loft-panel.js';
import { renderLabPanel } from './panels/lab-panel.js';
import { renderTycoonPanel } from './panels/tycoon-panel.js';
import { renderPressPanel } from './panels/press-panel.js';

/** Tab registry. `locked` marks phases not yet open. */
const TABS = [
  { id: 'studio', label: 'Studio', render: renderStudioPanel },
  { id: 'warehouse', label: 'Warehouse', render: renderWarehousePanel },
  { id: 'deck', label: 'Deck', render: renderDeckPanel },
  { id: 'backups', label: 'Backups', render: renderBackupsPanel },
  { id: 'stage', label: 'Stage', render: renderStagePanel },
  { id: 'bricks', label: 'Bricks', render: renderBricksPanel },
  { id: 'atelier', label: 'Atelier', render: renderAtelierPanel },
  { id: 'foundry', label: 'Foundry', render: renderFoundryPanel },
  { id: 'soundbooth', label: 'Sound Booth', render: renderSoundboothPanel },
  { id: 'pitch', label: 'Pitch Meeting', render: renderPitchPanel },
  { id: 'codex', label: 'Codex', render: renderCodexPanel },
  { id: 'kitbay', label: 'Kit Bay', render: renderKitbayPanel },
  { id: 'loft', label: 'Animation Loft', render: renderLoftPanel },
  { id: 'lab', label: 'Particle Lab', render: renderLabPanel },
  { id: 'tycoon', label: 'Tycoon Shell', render: renderTycoonPanel },
  { id: 'about', label: 'About', render: renderAboutPanel }
];

let currentTab = 'studio';
/** @type {HTMLElement} */
let host;
/** @type {HTMLElement} */
let statusText;
/** @type {HTMLElement} */
let statusDot;
/** @type {HTMLInputElement} */
let titleInput;

/**
 * Mount the whole application.
 * @param {HTMLElement} root
 */
export function bootShell(root) {
  root.innerHTML = '';
  root.appendChild(buildTopBar());
  root.appendChild(buildTabs());

  host = document.createElement('div');
  host.className = 'panel-host';
  root.appendChild(host);

  root.appendChild(buildStatusBar());

  const session = cart.restoreSession();
  cart.onChange(syncChrome);
  syncChrome();

  if (session.restored) {
    toast('Session restored: ' + cart.getCartridge().meta.title);
  }
  backup.startAutoBackup();

  window.addEventListener('beforeunload', (e) => {
    cart.saveSession();
    if (cart.isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      doSave(e.shiftKey);
    } else if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      doOpen();
    }
  });

  showTab(currentTab);
}

/* ------------------------------------------------------------------ */
/* chrome                                                              */
/* ------------------------------------------------------------------ */

function buildTopBar() {
  const bar = document.createElement('div');
  bar.className = 'topbar';

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.textContent = 'GAME EMPIRE TYCOON';
  bar.appendChild(brand);

  titleInput = document.createElement('input');
  titleInput.className = 'title-input';
  titleInput.setAttribute('aria-label', 'Cartridge title');
  titleInput.addEventListener('change', () => {
    const c = cart.getCartridge();
    c.meta.title = titleInput.value.trim() || 'Untitled Game';
    cart.touch();
  });
  bar.appendChild(titleInput);

  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  bar.appendChild(spacer);

  bar.appendChild(barButton('New', doNew));
  bar.appendChild(barButton('Open', doOpen));
  bar.appendChild(barButton('Save', () => doSave(false), true));
  bar.appendChild(barButton('Save As', () => doSave(true)));
  return bar;
}

/**
 * @param {string} label
 * @param {Function} fn
 * @param {boolean} [primary]
 */
function barButton(label, fn, primary = false) {
  const b = document.createElement('button');
  b.className = 'bar' + (primary ? ' primary' : '');
  b.textContent = label;
  b.addEventListener('click', () => fn());
  return b;
}

function buildTabs() {
  const strip = document.createElement('div');
  strip.className = 'tabs';
  for (const tab of TABS) {
    const b = document.createElement('button');
    b.className = 'tab';
    b.dataset.tab = tab.id;
    b.setAttribute('role', 'tab');
    b.textContent = tab.label;
    if (tab.locked) {
      b.disabled = true;
      b.title = 'Opens in ' + tab.locked;
    } else {
      b.addEventListener('click', () => showTab(tab.id));
    }
    strip.appendChild(b);
  }
  return strip;
}

function buildStatusBar() {
  const bar = document.createElement('div');
  bar.className = 'statusbar';
  statusDot = document.createElement('span');
  statusDot.className = 'dot';
  statusText = document.createElement('span');
  bar.appendChild(statusDot);
  bar.appendChild(statusText);

  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  bar.appendChild(spacer);

  const mode = document.createElement('span');
  mode.textContent = cart.hasFileSystemAccess()
    ? 'file access: direct'
    : 'file access: download fallback';
  bar.appendChild(mode);

  const phase = document.createElement('span');
  phase.textContent = 'Phase 2';
  bar.appendChild(phase);
  return bar;
}

/** Refresh title field + status line from cartridge state. */
function syncChrome() {
  const c = cart.getCartridge();
  if (document.activeElement !== titleInput) titleInput.value = c.meta.title;
  const dirty = cart.isDirty();
  statusDot.className = 'dot ' + (dirty ? 'dirty' : 'saved');
  const file = cart.getFileName();
  statusText.textContent =
    (dirty ? 'unsaved changes' : 'saved') +
    ' \u00B7 ' + (file || 'no file bound') +
    ' \u00B7 era: ' + c.meta.era;
}

/** @param {string} id */
function showTab(id) {
  currentTab = id;
  for (const b of document.querySelectorAll('.tab')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === id));
  }
  const tab = TABS.find((t) => t.id === id);
  host.innerHTML = '';
  if (tab && tab.render) tab.render(host, { toast, refresh: () => showTab(id) });
}

/* ------------------------------------------------------------------ */
/* project commands                                                    */
/* ------------------------------------------------------------------ */

async function doNew() {
  if (cart.isDirty() && !confirm('Discard unsaved changes and start a new cartridge?')) return;
  const fromTemplate = confirm('Start from the Platformer template? (Cancel for a blank cartridge)');
  await backup.makeBackup('pre-new');
  if (fromTemplate) {
    try {
      const loaded = await loadTemplate('platformer');
      cart.newCartridge('Untitled Game', (c) => applyTemplate(c, loaded));
      toast('New cartridge started from the Platformer template.');
    } catch (err) {
      toast('Could not load the template (' + (err && err.message || err) + ') — starting blank instead.', true);
      cart.newCartridge();
    }
  } else {
    cart.newCartridge();
    toast('New cartridge started.');
  }
  showTab(currentTab);
}

async function doOpen() {
  if (cart.isDirty() && !confirm('Discard unsaved changes and open another cartridge?')) return;
  await backup.makeBackup('pre-load');
  const res = await cart.open();
  if (res.error === 'cancelled') return;
  if (!res.ok) {
    toast(res.error || 'Could not open that file.', true);
    return;
  }
  if (res.errors && res.errors.length) {
    toast('Opened with repairs: ' + res.errors[0]);
  } else {
    toast('Cartridge loaded.');
  }
  showTab(currentTab);
}

/** @param {boolean} forcePicker */
async function doSave(forcePicker) {
  const res = await cart.save(forcePicker);
  if (res.error === 'cancelled') return;
  await backup.makeBackup('manual-save');
  toast(res.method === 'download' ? 'Downloaded cartridge file.' : 'Saved.');
}

/* ------------------------------------------------------------------ */
/* toast                                                               */
/* ------------------------------------------------------------------ */

let toastTimer = null;

/**
 * @param {string} msg
 * @param {boolean} [bad]
 */
export function toast(msg, bad = false) {
  for (const el of document.querySelectorAll('.toast')) el.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}
