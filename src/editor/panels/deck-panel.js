/**
 * @file deck-panel.js
 * @description The Deck tab: the render engine's canvas, the effect-channel
 * toggles, mode switch, GLB/sprite demo, and the Debug Deck overlay (FPS,
 * event log, seeded RNG). As of Phase 2 the entity inspector and collision
 * wireframe slots are live: entities read from the open cartridge, wireframes
 * are toggled here and drawn in the Stage's play viewport.
 * Phase 1, extended in Phase 2 (ticket P2-7).
 */

import { createEngine, CHANNEL_IDS, CHANNEL_LABELS } from '../../engine/renderer.js';
import {
  createDebugDeck,
  setEntitySource,
  getWireframesEnabled,
  setWireframesEnabled
} from '../../engine/debug.js';
import * as cart from '../cartridge.js';

const TEST_CUBE_URL = new URL('../../data/test-assets/test-cube.glb', import.meta.url).href;
const FPS_WINDOW_HINT = 90;
const INSPECTOR_REFRESH_MS = 500;

let engine = null;
let deck = null;
let rafId = null;
let visible = false;
let resizeObserver = null;

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderDeckPanel(host, ctx) {
  visible = true;
  const c = cart.getCartridge();

  const panel = document.createElement('div');
  panel.className = 'panel deck-panel';
  panel.innerHTML =
    '<h2>Deck</h2>' +
    '<div class="sub">The renderer, the effect channels chain, and the Debug Deck watching all of it. ' +
    'Entity and collision readouts went live in Phase 2.</div>';

  const layout = document.createElement('div');
  layout.className = 'deck-layout';

  // ---- left: canvas + controls ----
  const left = document.createElement('div');
  left.className = 'deck-left';

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'deck-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'deck-canvas';
  canvasWrap.appendChild(canvas);
  left.appendChild(canvasWrap);

  const controls = document.createElement('div');
  controls.className = 'card';
  controls.innerHTML = '<h3>Scene</h3>';

  const modeRow = document.createElement('div');
  modeRow.className = 'deck-row';
  const modeBtn = document.createElement('button');
  modeBtn.className = 'bar primary';
  modeBtn.textContent = 'Mode: ' + c.settings.mode.toUpperCase();
  modeRow.appendChild(modeBtn);

  const glbBtn = document.createElement('button');
  glbBtn.className = 'bar';
  glbBtn.textContent = 'Load test GLB (cube)';
  modeRow.appendChild(glbBtn);

  const toneSelect = document.createElement('select');
  toneSelect.className = 'deck-select';
  toneSelect.setAttribute('aria-label', 'Tone mapping');
  for (const [id, label] of Object.entries({ none: 'Tone: None', aces: 'Tone: ACES Filmic', agx: 'Tone: AgX', neutral: 'Tone: Neutral', reinhard: 'Tone: Reinhard' })) {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = label;
    toneSelect.appendChild(opt);
  }
  modeRow.appendChild(toneSelect);
  controls.appendChild(modeRow);

  const channelsHead = document.createElement('div');
  channelsHead.className = 'deck-subhead';
  channelsHead.textContent = 'Effect channels';
  controls.appendChild(channelsHead);

  const channelGrid = document.createElement('div');
  channelGrid.className = 'deck-channels';
  const checks = {};
  for (const id of CHANNEL_IDS) {
    const label = document.createElement('label');
    label.className = 'deck-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = c.settings.channels.includes(id);
    input.dataset.channel = id;
    checks[id] = input;
    label.appendChild(input);
    label.appendChild(document.createTextNode(' ' + CHANNEL_LABELS[id]));
    channelGrid.appendChild(label);
  }
  controls.appendChild(channelGrid);
  left.appendChild(controls);
  layout.appendChild(left);

  // ---- right: debug deck ----
  const right = document.createElement('div');
  right.className = 'deck-right';

  const fpsCard = document.createElement('div');
  fpsCard.className = 'card';
  fpsCard.innerHTML = '<h3>Debug Deck &mdash; performance</h3>';
  const fpsVal = document.createElement('div');
  fpsVal.className = 'deck-fps';
  fpsVal.textContent = '\u2014 fps';
  fpsCard.appendChild(fpsVal);
  const spark = document.createElement('canvas');
  spark.className = 'deck-sparkline';
  spark.width = 260; spark.height = 40;
  fpsCard.appendChild(spark);
  right.appendChild(fpsCard);

  const rngCard = document.createElement('div');
  rngCard.className = 'card';
  rngCard.innerHTML = '<h3>Seeded RNG</h3><div class="sub" style="margin-bottom:8px">Same seed, same rolls, every time &mdash; that\'s what "no Math.random() in engine code" buys us.</div>';
  const rngRow = document.createElement('div');
  rngRow.className = 'deck-row';
  const seedInput = document.createElement('input');
  seedInput.type = 'number'; seedInput.value = '1'; seedInput.className = 'deck-select';
  seedInput.style.width = '90px';
  const reseedBtn = document.createElement('button');
  reseedBtn.className = 'bar'; reseedBtn.textContent = 'Reseed';
  const rollBtn = document.createElement('button');
  rollBtn.className = 'bar'; rollBtn.textContent = 'Roll x8';
  rngRow.appendChild(seedInput); rngRow.appendChild(reseedBtn); rngRow.appendChild(rollBtn);
  rngCard.appendChild(rngRow);
  const rollOut = document.createElement('div');
  rollOut.className = 'deck-rolls';
  rngCard.appendChild(rollOut);
  right.appendChild(rngCard);

  const inspectCard = document.createElement('div');
  inspectCard.className = 'card';
  inspectCard.innerHTML = '<h3>Entities &amp; Collisions</h3>';
  const entList = document.createElement('div');
  entList.className = 'deck-log';
  inspectCard.appendChild(entList);
  const wireRow = document.createElement('label');
  wireRow.className = 'deck-check';
  wireRow.style.marginTop = '8px';
  const wireCheck = document.createElement('input');
  wireCheck.type = 'checkbox';
  wireCheck.checked = getWireframesEnabled();
  wireCheck.addEventListener('change', () => {
    setWireframesEnabled(wireCheck.checked);
    deck.logEvent('Collision wireframes ' + (wireCheck.checked ? 'enabled' : 'disabled') + '.');
  });
  wireRow.appendChild(wireCheck);
  wireRow.appendChild(document.createTextNode(' collision wireframes (drawn in the Stage while playing)'));
  inspectCard.appendChild(wireRow);
  const physLine = document.createElement('div');
  physLine.className = 'sub';
  physLine.style.marginTop = '6px';
  inspectCard.appendChild(physLine);
  right.appendChild(inspectCard);

  const logCard = document.createElement('div');
  logCard.className = 'card';
  logCard.innerHTML = '<h3>Event log</h3>';
  const logList = document.createElement('div');
  logList.className = 'deck-log';
  logCard.appendChild(logList);
  right.appendChild(logCard);

  layout.appendChild(right);
  panel.appendChild(layout);
  host.appendChild(panel);

  // ---- engine wiring ----
  engine = createEngine(canvas, { demo: true });
  deck = createDebugDeck();
  deck.logEvent('Deck opened. Mode: ' + c.settings.mode + '.');

  // the Deck's entity source: every scene in the open cartridge
  setEntitySource(() => {
    const live = cart.getCartridge();
    const out = [];
    for (const scene of live.scenes) {
      for (const e of scene.entities) {
        out.push({
          id: scene.id + ' / ' + e.id,
          name: e.name,
          components: Object.keys(e.components)
        });
      }
    }
    return out;
  });

  engine.setMode(c.settings.mode);
  engine.rebuildChannels(c.settings.channels);
  toneSelect.value = c.settings.tone || 'none';
  engine.setToneMap(toneSelect.value);

  function persistChannels() {
    const live = cart.getCartridge();
    live.settings.channels = CHANNEL_IDS.filter((id) => checks[id].checked);
    cart.touch();
  }

  modeBtn.addEventListener('click', () => {
    const live = cart.getCartridge();
    live.settings.mode = live.settings.mode === '2d' ? '3d' : '2d';
    cart.touch();
    modeBtn.textContent = 'Mode: ' + live.settings.mode.toUpperCase();
    engine.setMode(live.settings.mode);
    engine.rebuildChannels(live.settings.channels);
    engine.setToneMap(toneSelect.value);
    deck.logEvent('Switched to ' + live.settings.mode.toUpperCase() + ' mode.');
  });

  glbBtn.addEventListener('click', async () => {
    glbBtn.disabled = true;
    glbBtn.textContent = 'Loading\u2026';
    const res = await engine.loadGLB(TEST_CUBE_URL);
    glbBtn.disabled = false;
    glbBtn.textContent = 'Load test GLB (cube)';
    if (res.ok) {
      deck.logEvent('GLB loaded: ' + res.meshes + ' mesh, ' + res.vertices + ' verts, ' + res.triangles + ' tris.');
      ctx.toast('GLB imported: ' + res.meshes + ' mesh / ' + res.triangles + ' triangles.');
    } else {
      deck.logEvent('GLB load FAILED: ' + res.error);
      ctx.toast('GLB load failed: ' + res.error, true);
    }
  });

  toneSelect.addEventListener('change', () => {
    engine.setToneMap(toneSelect.value);
    const live = cart.getCartridge();
    live.settings.tone = toneSelect.value;
    cart.touch();
    deck.logEvent('Tone map: ' + toneSelect.value);
  });

  for (const id of CHANNEL_IDS) {
    checks[id].addEventListener('change', () => {
      persistChannels();
      engine.rebuildChannels(cart.getCartridge().settings.channels);
      deck.logEvent('Channel "' + id + '" ' + (checks[id].checked ? 'enabled' : 'disabled') + '.');
    });
  }

  reseedBtn.addEventListener('click', () => {
    deck.reseed(Number(seedInput.value) || 0);
    rollOut.textContent = '';
  });
  rollBtn.addEventListener('click', () => {
    rollOut.textContent = deck.roll(8).join(', ');
  });

  function drawSpark() {
    const s = deck.fpsSamples();
    const g = spark.getContext('2d');
    g.clearRect(0, 0, spark.width, spark.height);
    if (!s.length) return;
    g.strokeStyle = '#6fd3ff';
    g.lineWidth = 1.5;
    g.beginPath();
    const max = 90;
    s.forEach((v, i) => {
      const x = (i / FPS_WINDOW_HINT) * spark.width;
      const y = spark.height - Math.min(1, v / max) * spark.height;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    });
    g.stroke();
  }

  function refreshLog() {
    const entries = deck.getLog().slice(0, 12);
    logList.innerHTML = entries.map((e) =>
      '<div class="deck-log-row"><span>' + new Date(e.t).toLocaleTimeString() + '</span><span>' + escapeHtml(e.msg) + '</span></div>'
    ).join('') || '<div class="deck-log-row"><span>\u2014</span><span>no events yet</span></div>';
  }

  function refreshInspector() {
    const ins = deck.entityInspector();
    if (!ins.available) {
      entList.innerHTML = '<div class="deck-log-row"><span>\u2014</span><span>' + escapeHtml(ins.reason) + '</span></div>';
    } else if (!ins.entities.length) {
      entList.innerHTML = '<div class="deck-log-row"><span>\u2014</span><span>no entities yet \u2014 build a level in the Stage</span></div>';
    } else {
      const rows = ins.entities.slice(0, 8).map((e) =>
        '<div class="deck-log-row"><span>' + escapeHtml(e.id) + '</span><span>' + escapeHtml(e.components.join(', ')) + '</span></div>'
      );
      if (ins.entities.length > 8) {
        rows.push('<div class="deck-log-row"><span>\u2026</span><span>' + (ins.entities.length - 8) + ' more</span></div>');
      }
      entList.innerHTML = rows.join('');
    }

    const wires = deck.collisionWireframes();
    physLine.textContent = wires.available
      ? 'physics live: ' + wires.bodies + ' bodies \u00B7 ' + wires.colliders + ' colliders'
      : wires.reason;
  }

  let lastLogLen = -1;
  let lastInspect = 0;
  function loop() {
    if (!visible) return;
    const dt = engine.tick();
    deck.sample(dt);
    fpsVal.textContent = deck.avgFps() + ' fps';
    drawSpark();
    if (deck.getLog().length !== lastLogLen) {
      lastLogLen = deck.getLog().length;
      refreshLog();
    }
    const now = performance.now();
    if (now - lastInspect > INSPECTOR_REFRESH_MS) {
      lastInspect = now;
      refreshInspector();
    }
    rafId = requestAnimationFrame(loop);
  }

  function doResize() {
    const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
    engine.resize(w, h);
  }
  resizeObserver = new ResizeObserver(doResize);
  resizeObserver.observe(canvasWrap);
  requestAnimationFrame(() => { doResize(); loop(); refreshLog(); refreshInspector(); });

  // teardown when the tab changes away
  const stopObserver = new MutationObserver(() => {
    if (!document.body.contains(panel)) teardown();
  });
  stopObserver.observe(document.body, { childList: true, subtree: true });

  function teardown() {
    visible = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (resizeObserver) resizeObserver.disconnect();
    stopObserver.disconnect();
    if (engine) { engine.dispose(); engine = null; }
  }
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
