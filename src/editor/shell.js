/**
 * @file shell.js
 * @description The app frame: top bar, room strip, panel host, status bar, and
 * project management wiring. Ticket P0-1, reshaped for the garage-era shell:
 * flat tabs became rooms (Constitution Article II — departments open era by
 * era; locked rooms stay visible as doors to look forward to). Room structure
 * and every kid-facing string live in src/data/rooms.json.
 */

import * as cart from './cartridge.js';
import * as undoSvc from './undo.js';
import * as backup from './backup.js';
import ROOMS from '../data/rooms.json';
import HELP from '../data/help.json';
import TOURS from '../data/tours.json';
import { startTour } from './tour.js';
import { renderWarehousePanel } from './panels/warehouse-panel.js';
import { renderBackupsPanel } from './panels/backups-panel.js';
import { renderStudioPanel } from './panels/studio-panel.js';
import { renderAboutPanel } from './panels/about-panel.js';
import { renderDeckPanel } from './panels/deck-panel.js';
import { renderStagePanel } from './panels/stage-panel.js';
import { renderBricksPanel } from './panels/bricks-panel.js';
import { renderAtelierPanel } from './panels/atelier-panel.js';
import { renderFoundryPanel } from './panels/foundry-panel.js';
import { renderSfxeditPanel } from './panels/sfxedit-panel.js';
import { renderSoundboothPanel } from './panels/soundbooth-panel.js';
import { renderPitchPanel } from './panels/pitch-panel.js';
import { renderCodexPanel } from './panels/codex-panel.js';
import { renderKitbayPanel } from './panels/kitbay-panel.js';
import { renderMaterialsPanel } from './panels/materials-panel.js';
import { renderLoftPanel } from './panels/loft-panel.js';
import { renderRigPanel } from './panels/rig-panel.js';
import { renderLabPanel } from './panels/lab-panel.js';
import { renderTycoonPanel } from './panels/tycoon-panel.js';
import { renderPressPanel } from './panels/press-panel.js';

/** Panel registry: tab id → renderer. Structure/labels live in rooms.json. */
const PANELS = {
  studio: renderStudioPanel,
  warehouse: renderWarehousePanel,
  deck: renderDeckPanel,
  backups: renderBackupsPanel,
  stage: renderStagePanel,
  bricks: renderBricksPanel,
  atelier: renderAtelierPanel,
  foundry: renderFoundryPanel,
  sfxedit: renderSfxeditPanel,
  soundbooth: renderSoundboothPanel,
  pitch: renderPitchPanel,
  codex: renderCodexPanel,
  kitbay: renderKitbayPanel,
  materials: renderMaterialsPanel,
  loft: renderLoftPanel,
  rig: renderRigPanel,
  lab: renderLabPanel,
  tycoon: renderTycoonPanel,
  press: renderPressPanel,
  about: renderAboutPanel
};

/** Current view: a room id, 'play', or 'office'. */
let currentRoom = 'build';
/** Remembered member tab per room (and for the office). */
const roomMemory = {};
/** @type {HTMLElement} */
let host;
/** @type {HTMLElement} */
let roomStrip;
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
  roomStrip = buildRoomStrip();
  root.appendChild(roomStrip);

  host = document.createElement('div');
  host.className = 'panel-host';
  root.appendChild(host);

  root.appendChild(buildStatusBar());

  const session = cart.restoreSession();
  undoSvc.initUndo({
    serialize: () => JSON.stringify(cart.getCartridge()),
    restore: (json) => cart.replaceForUndo(JSON.parse(json))
  });
  cart.setTouchHook(undoSvc.recordChange);
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

  // collapsible cards: tap any card title to fold it away, tap again to open.
  // One delegated listener covers every room, present and future.
  document.addEventListener('click', (e) => {
    const h = e.target.closest('.card > h3');
    if (!h) return;
    if (e.target.closest('button, input, select, a, textarea')) return;
    h.parentElement.classList.toggle('collapsed');
  });

  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      doSave(e.shiftKey);
    } else if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      doOpen();
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // native field undo
      e.preventDefault();
      if (undoSvc.undo()) { showRoom(currentRoom); toast('↶ Undone'); }
      else toast('Nothing to undo.');
    } else if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    } else if (mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      if (undoSvc.redo()) { showRoom(currentRoom); toast('↷ Redone'); }
      else toast('Nothing to redo.');
    }
  });

  showRoom(currentRoom);
}

/* ------------------------------------------------------------------ */
/* eras                                                                */
/* ------------------------------------------------------------------ */

/** @param {string} era @returns {number} index in the era ladder (-1 unknown) */
function eraIndex(era) {
  return ROOMS.eras.indexOf(era);
}

/** Current cartridge era index (unknown eras behave like garage). */
function currentEraIndex() {
  const i = eraIndex(cart.getCartridge().meta.era);
  return i === -1 ? 0 : i;
}

/** @param {string} required @returns {boolean} */
function eraOpen(required) {
  return currentEraIndex() >= eraIndex(required);
}

/** Warm locked-door message for a room or member. */
function lockedMessage(label, requiredEra) {
  return '🔒 ' + label + ' ' + ROOMS.lockedLine + ' ' + ROOMS.eraNames[requiredEra] + '!';
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

/** The room strip: every door in the studio, locked ones included. */
function buildRoomStrip() {
  const strip = document.createElement('div');
  strip.className = 'rooms';

  for (const room of ROOMS.rooms) {
    strip.appendChild(roomButton({
      id: room.id,
      icon: room.icon,
      label: room.label,
      title: room.title,
      locked: !eraOpen(room.era),
      lockedEra: room.era,
      onOpen: () => showRoom(room.id)
    }));
  }

  strip.appendChild(roomButton({
    id: 'play',
    icon: ROOMS.play.icon,
    label: ROOMS.play.label,
    title: ROOMS.play.title,
    extraClass: 'play',
    onOpen: () => showRoom('play')
  }));

  strip.appendChild(roomButton({
    id: 'office',
    icon: ROOMS.office.icon,
    label: ROOMS.office.label,
    title: ROOMS.office.title,
    extraClass: 'office',
    onOpen: () => showRoom('office')
  }));

  return strip;
}

/**
 * @param {{id:string, icon:string, label:string, title:string,
 *          locked?:boolean, lockedEra?:string, extraClass?:string,
 *          onOpen:Function}} spec
 */
function roomButton(spec) {
  const b = document.createElement('button');
  b.className = 'room' + (spec.extraClass ? ' ' + spec.extraClass : '') + (spec.locked ? ' locked' : '');
  b.dataset.room = spec.id;
  b.title = spec.title;
  b.setAttribute('role', 'tab');

  const icon = document.createElement('span');
  icon.className = 'room-icon';
  icon.textContent = spec.locked ? '🔒' : spec.icon;
  b.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'room-label';
  label.textContent = spec.label;
  b.appendChild(label);

  if (spec.locked) {
    b.addEventListener('click', () => toast(lockedMessage(spec.label, spec.lockedEra)));
  } else {
    b.addEventListener('click', () => spec.onOpen());
  }
  return b;
}

/** Rebuild the room strip in place (era may have changed). */
function refreshRoomStrip() {
  const fresh = buildRoomStrip();
  roomStrip.replaceWith(fresh);
  roomStrip = fresh;
  markSelectedRoom();
}

function markSelectedRoom() {
  for (const b of roomStrip.querySelectorAll('.room')) {
    b.setAttribute('aria-selected', String(b.dataset.room === currentRoom));
  }
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

let lastSeenEra = null;

/** Refresh title field + status line from cartridge state. */
function syncChrome() {
  const c = cart.getCartridge();
  // Era changes (pitch build, open, switcher) re-gate the room strip.
  if (lastSeenEra !== null && lastSeenEra !== c.meta.era) refreshRoomStrip();
  lastSeenEra = c.meta.era;
  if (document.activeElement !== titleInput) titleInput.value = c.meta.title;
  const dirty = cart.isDirty();
  statusDot.className = 'dot ' + (dirty ? 'dirty' : 'saved');
  const file = cart.getFileName();
  statusText.textContent =
    (dirty ? 'unsaved changes' : 'saved') +
    ' · ' + (file || 'no file bound') +
    ' · era: ' + (ROOMS.eraNames[c.meta.era] || c.meta.era);
}

/* ------------------------------------------------------------------ */
/* rooms & panels                                                      */
/* ------------------------------------------------------------------ */

/**
 * Open a room (or 'play' / 'office' / 'pitch').
 * @param {string} id
 */
function showRoom(id) {
  currentRoom = id;
  markSelectedRoom();
  host.innerHTML = '';

  if (id === 'play') {
    renderPanelInto(host, ROOMS.play.tab);
    return;
  }
  if (id === 'office') {
    renderMemberView(ROOMS.office.members.map((m) => ({ ...m, open: true })), 'office', buildEraSwitcher());
    return;
  }
  if (id === 'pitch') {
    renderPanelInto(host, 'pitch');
    return;
  }

  const room = ROOMS.rooms.find((r) => r.id === id);
  if (!room) return;

  const members = room.members.map((m) => ({
    ...m,
    open: eraOpen(m.era)
  }));
  renderMemberView(members, room.id, null);
}

/**
 * Render a room's member tabs (locked ones stay visible) plus the active panel.
 * @param {Array<{tab:string,label:string,era?:string,open:boolean}>} members
 * @param {string} memoryKey
 * @param {HTMLElement|null} extraChrome appended after the member strip
 */
function renderMemberView(members, memoryKey, extraChrome) {
  const openMembers = members.filter((m) => m.open);
  if (openMembers.length === 0) return;

  let active = roomMemory[memoryKey] || openMembers[0].tab;
  if (!openMembers.some((m) => m.tab === active)) active = openMembers[0].tab;
  roomMemory[memoryKey] = active;

  // A room with a single visible door skips the inner strip entirely.
  if (members.length > 1) {
    const strip = document.createElement('div');
    strip.className = 'tabs room-sub';
    for (const m of members) {
      const b = document.createElement('button');
      b.className = 'tab';
      b.dataset.tab = m.tab;
      b.setAttribute('role', 'tab');
      b.textContent = m.open ? m.label : '🔒 ' + m.label;
      b.setAttribute('aria-selected', String(m.tab === active));
      if (m.open) {
        b.addEventListener('click', () => {
          roomMemory[memoryKey] = m.tab;
          showRoom(currentRoom);
        });
      } else {
        b.addEventListener('click', () => toast(lockedMessage(m.label, m.era)));
      }
      strip.appendChild(b);
    }
    host.appendChild(strip);
  }

  if (extraChrome) host.appendChild(extraChrome);

  const panelHost = document.createElement('div');
  panelHost.className = 'room-panel';
  host.appendChild(panelHost);
  renderPanelInto(panelHost, active);
}

/**
 * @param {HTMLElement} target
 * @param {string} tabId
 */
function renderPanelInto(target, tabId) {
  const render = PANELS[tabId];
  if (!render) return;
  // Every panel gets a ? in the corner that explains what the room does
  // and why — content lives in data/help.json.
  const entry = HELP[tabId];
  if (entry) {
    const wrap = document.createElement('div');
    wrap.className = 'help-wrap';
    const fab = document.createElement('button');
    fab.className = 'help-fab';
    fab.textContent = '?';
    fab.title = 'What is this room?';
    const note = document.createElement('div');
    note.className = 'help-note';
    const heading = document.createElement('h4');
    heading.textContent = entry.title;
    note.appendChild(heading);
    for (const line of entry.lines) {
      const para = document.createElement('p');
      para.textContent = line;
      note.appendChild(para);
    }
    fab.addEventListener('click', () => note.classList.toggle('open'));
    wrap.appendChild(fab);
    wrap.appendChild(note);
    if (TOURS[tabId] && tabId !== 'stage') {
      // every toured room gets the 🎓 next to the ? — and offers itself once
      const tourFab = document.createElement('button');
      tourFab.className = 'help-fab tour-fab';
      tourFab.textContent = '🎓';
      tourFab.title = 'Show me around';
      tourFab.addEventListener('click', () => startTour(tabId, target));
      wrap.appendChild(tourFab);
      if (!localStorage.getItem('get-tour-' + tabId)) {
        localStorage.setItem('get-tour-' + tabId, 'seen');
        setTimeout(() => startTour(tabId, target), 600);
      }
    }
    target.appendChild(wrap);
  }
  render(target, { toast, refresh: () => showRoom(currentRoom) });
}

/** Office-only: let a grown-up (or tester) move the studio between eras. */
function buildEraSwitcher() {
  const wrap = document.createElement('div');
  wrap.className = 'card era-switcher';

  const label = document.createElement('label');
  label.textContent = 'Studio era (grown-ups & testing): ';
  const sel = document.createElement('select');
  for (const era of ROOMS.eras) {
    const opt = document.createElement('option');
    opt.value = era;
    opt.textContent = ROOMS.eraNames[era] || era;
    sel.appendChild(opt);
  }
  sel.value = cart.getCartridge().meta.era;
  if (!ROOMS.eras.includes(sel.value)) sel.value = ROOMS.eras[0];
  sel.addEventListener('change', () => {
    cart.getCartridge().meta.era = sel.value;
    cart.touch();
    refreshRoomStrip();
    toast('Studio era: ' + (ROOMS.eraNames[sel.value] || sel.value));
  });
  label.appendChild(sel);
  wrap.appendChild(label);
  return wrap;
}

/* ------------------------------------------------------------------ */
/* project commands                                                    */
/* ------------------------------------------------------------------ */

/** "New" hands off to the Pitch Meeting, which walks through picking (or
 * being matched to) any of the real templates. The unsaved-changes guard and
 * pre-replace backup live at the point data is actually replaced — Pitch
 * Meeting's "Build It" — not here, since just opening the tab doesn't
 * discard anything. */
function doNew() {
  showRoom('pitch');
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
  undoSvc.resetUndo();
  refreshRoomStrip();
  showRoom(currentRoom);
}

/** @param {boolean} forcePicker */
async function doSave(forcePicker) {
  const res = await cart.save(forcePicker);
  if (res.error === 'cancelled') return;
  await backup.makeBackup('manual-save');
  toast(res.method === 'download' ? 'Downloaded cartridge file.' : 'Saved.');
}

/* ------------------------------------------------------------------ */
/* command palette (Ctrl+K): search rooms, tools, and everything saved  */
/* ------------------------------------------------------------------ */

function paletteEntries() {
  const out = [];
  for (const room of ROOMS.rooms) {
    if (!eraOpen(room.era)) continue;
    out.push({ label: room.icon + ' ' + room.label + ' — room', go: () => showRoom(room.id) });
    for (const m of room.members) {
      if (!eraOpen(m.era)) continue;
      out.push({ label: room.icon + ' ' + m.label + ' (' + room.label + ')', go: () => { roomMemory[room.id] = m.tab; showRoom(room.id); } });
    }
  }
  out.push({ label: ROOMS.play.icon + ' Play — try your game', go: () => showRoom('play') });
  out.push({ label: ROOMS.office.icon + ' Office', go: () => showRoom('office') });
  const c = cart.getCartridge();
  const jump = (roomId, tab) => () => { roomMemory[roomId] = tab; showRoom(roomId); };
  for (const sp of c.assets.sprites || []) out.push({ label: '🖼 ' + sp.name + ' — image', go: jump('art', 'atelier') });
  for (const m of c.assets.materials || []) out.push({ label: '✨ ' + m.name + ' — material', go: jump('art', 'materials') });
  for (const sfx of c.assets.sfx || []) out.push({ label: '🔊 ' + sfx.name + ' — sound', go: jump('sound', 'foundry') });
  for (const song of c.assets.songs || []) out.push({ label: '🎵 ' + song.name + ' — song', go: jump('music', 'soundbooth') });
  for (const mo of c.assets.models || []) out.push({ label: '🕺 ' + mo.name + ' — character', go: jump('animate', 'rig') });
  for (const sc of c.scenes || []) out.push({ label: '🗺 ' + (sc.id || 'scene') + ' — scene', go: () => showRoom('build') });
  return out;
}

function openPalette() {
  const existing = document.getElementById('cmdPalette');
  if (existing) { existing.remove(); return; }
  const wrap = document.createElement('div');
  wrap.className = 'palette-wrap';
  wrap.id = 'cmdPalette';
  const box = document.createElement('div');
  box.className = 'palette-box';
  const input = document.createElement('input');
  input.className = 'palette-input';
  input.placeholder = 'Jump anywhere… (rooms, sounds, images, characters)';
  const list = document.createElement('div');
  list.className = 'palette-list';
  box.appendChild(input);
  box.appendChild(list);
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  const entries = paletteEntries();
  let filtered = entries;
  let cursor = 0;

  function renderList() {
    list.innerHTML = '';
    filtered.slice(0, 12).forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'palette-row' + (i === cursor ? ' active' : '');
      row.textContent = entry.label;
      row.addEventListener('click', () => { close(); entry.go(); });
      list.appendChild(row);
    });
    if (!filtered.length) list.innerHTML = '<div class="palette-row">nothing matches</div>';
  }

  function close() { wrap.remove(); }

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    filtered = q ? entries.filter((entry) => entry.label.toLowerCase().includes(q)) : entries;
    cursor = 0;
    renderList();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); }
    else if (e.key === 'ArrowDown') { cursor = Math.min(filtered.length - 1, cursor + 1); renderList(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { cursor = Math.max(0, cursor - 1); renderList(); e.preventDefault(); }
    else if (e.key === 'Enter' && filtered[cursor]) { close(); filtered[cursor].go(); }
    e.stopPropagation();
  });
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  renderList();
  input.focus();
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
