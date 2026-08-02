/**
 * @file codex-panel.js
 * @description Codex tab: browse every brick's one-liner, staff explainer,
 * and — for gated "advanced" bricks — a real, playable sandbox (not just a
 * description) that must run once before the brick unlocks. The tutorial
 * IS the lock (Constitution Article X).
 * Ticket P5-7. Phase 5.
 */

import { createEngine } from '../../engine/renderer.js';
import { initPhysics } from '../../engine/physics.js';
import { startRuntime } from '../../engine/runtime.js';
import { loadBrickCatalog, loadCodexCatalog, findBrick } from '../bricks.js';
import { GATED_BRICKS, isUnlocked, markCompleted, buildSandboxCartridge } from '../codex.js';

let brickCatalog = [];
let codexCatalog = [];
let selectedId = null;

const physicsReady = initPhysics().catch(() => null);

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderCodexPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Codex</h2>' +
    '<div class="sub">Every brick, explained — and for the advanced ones, a real sandbox to learn them in. ' +
    'Run the sandbox once and the brick unlocks for good.</div>';

  const layout = document.createElement('div');
  layout.className = 'stage-layout';

  // ---------- left: catalog list ----------
  const left = document.createElement('div');
  left.className = 'card';
  left.innerHTML = '<h3>Bricks</h3>';
  const list = document.createElement('div');
  list.className = 'stage-tree';
  list.style.maxHeight = '60vh';
  list.style.overflowY = 'auto';
  left.appendChild(list);
  layout.appendChild(left);

  // ---------- right: details + sandbox ----------
  const right = document.createElement('div');
  right.className = 'deck-right';

  const detailCard = document.createElement('div');
  detailCard.className = 'card';
  const detailBody = document.createElement('div');
  detailCard.appendChild(detailBody);
  right.appendChild(detailCard);

  const sandboxCard = document.createElement('div');
  sandboxCard.className = 'card';
  sandboxCard.innerHTML = '<h3>Sandbox</h3>';
  const sandboxHint = document.createElement('div');
  sandboxHint.className = 'stage-hint';
  sandboxCard.appendChild(sandboxHint);
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'stage-canvas-wrap';
  canvasWrap.style.height = '40vh';
  canvasWrap.style.display = 'none';
  const canvas = document.createElement('canvas');
  canvas.className = 'deck-canvas';
  canvasWrap.appendChild(canvas);
  sandboxCard.appendChild(canvasWrap);
  const sandboxBtns = document.createElement('div');
  sandboxBtns.className = 'stage-bar';
  sandboxCard.appendChild(sandboxBtns);
  right.appendChild(sandboxCard);

  layout.appendChild(right);
  panel.appendChild(layout);
  host.appendChild(panel);

  /* ---------------------------------------------------------------- */
  /* sandbox engine (created lazily, torn down between bricks)          */
  /* ---------------------------------------------------------------- */
  let engine = null;
  let runtime = null;
  let rafId = null;
  let lastTs = 0;
  let resizeObs = null;
  const sandboxInput = { left: false, right: false, up: false, down: false, jump: false };

  function stopSandbox() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (runtime) { runtime.stop(); runtime = null; }
    if (engine) { engine.dispose(); engine = null; }
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    canvasWrap.style.display = 'none';
  }

  async function playSandbox(brickId, brickDef) {
    stopSandbox();
    await physicsReady;
    canvasWrap.style.display = '';
    engine = createEngine(canvas, { demo: false });
    engine.setMode('2d');
    function resize() { engine.resize(canvasWrap.clientWidth, canvasWrap.clientHeight); }
    resizeObs = new ResizeObserver(resize);
    resizeObs.observe(canvasWrap);
    resize();

    const cartridge = buildSandboxCartridge(brickId, brickDef);
    try {
      runtime = await startRuntime(engine, cartridge, 'sandbox', () => {});
    } catch (err) {
      ctx.toast('Sandbox failed to start: ' + (err && err.message || err), true);
      stopSandbox();
      return;
    }

    lastTs = performance.now();
    function loop(ts) {
      const dt = Math.min((ts - lastTs) / 1000, 0.1);
      lastTs = ts;
      if (runtime) runtime.tick(dt, sandboxInput);
      if (engine) engine.tick();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame((ts) => { lastTs = ts; loop(ts); });
  }

  // basic WASD/arrow control for sandboxes that involve the player
  function onKeyDown(e) {
    if (['ArrowLeft', 'KeyA'].includes(e.code)) sandboxInput.left = true;
    if (['ArrowRight', 'KeyD'].includes(e.code)) sandboxInput.right = true;
    if (['ArrowUp', 'KeyW'].includes(e.code)) sandboxInput.up = true;
    if (['ArrowDown', 'KeyS'].includes(e.code)) sandboxInput.down = true;
  }
  function onKeyUp(e) {
    if (['ArrowLeft', 'KeyA'].includes(e.code)) sandboxInput.left = false;
    if (['ArrowRight', 'KeyD'].includes(e.code)) sandboxInput.right = false;
    if (['ArrowUp', 'KeyW'].includes(e.code)) sandboxInput.up = false;
    if (['ArrowDown', 'KeyS'].includes(e.code)) sandboxInput.down = false;
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  /* ---------------------------------------------------------------- */
  /* rendering                                                          */
  /* ---------------------------------------------------------------- */
  function refreshList() {
    list.innerHTML = '';
    for (const brick of brickCatalog) {
      const row = document.createElement('div');
      row.className = 'stage-tree-row' + (brick.id === selectedId ? ' selected' : '');
      const dot = document.createElement('span');
      dot.className = 'stage-dot';
      const locked = GATED_BRICKS.has(brick.id) && !isUnlocked(brick.id);
      dot.style.background = locked ? 'var(--dim)' : 'var(--good)';
      row.appendChild(dot);
      const label = document.createElement('span');
      label.textContent = (locked ? '\u{1F512} ' : '') + brick.label;
      row.appendChild(label);
      row.addEventListener('click', () => { selectedId = brick.id; renderAll(); });
      list.appendChild(row);
    }
  }

  function refreshDetail() {
    stopSandbox();
    detailBody.innerHTML = '';
    sandboxHint.textContent = '';
    sandboxBtns.innerHTML = '';
    if (!selectedId) {
      detailBody.innerHTML = '<h3>Pick a brick</h3><div class="stage-hint">Select one on the left to read about it.</div>';
      return;
    }
    const brickDef = findBrick(brickCatalog, selectedId);
    const codexEntry = codexCatalog.find((c) => c.id === selectedId);
    if (!brickDef) return;

    const gated = GATED_BRICKS.has(selectedId);
    const unlocked = isUnlocked(selectedId);

    const title = document.createElement('h3');
    title.textContent = brickDef.label + (gated ? (unlocked ? ' \u2713' : ' \u{1F512}') : '');
    detailBody.appendChild(title);

    const oneLiner = document.createElement('div');
    oneLiner.style.fontWeight = '600';
    oneLiner.style.marginBottom = '8px';
    oneLiner.textContent = codexEntry ? codexEntry.oneLiner : brickDef.description;
    detailBody.appendChild(oneLiner);

    if (codexEntry) {
      const voice = document.createElement('div');
      voice.className = 'stage-hint';
      voice.style.marginBottom = '4px';
      voice.textContent = '\u2014 ' + codexEntry.voice;
      detailBody.appendChild(voice);

      const explainer = document.createElement('div');
      explainer.style.lineHeight = '1.6';
      explainer.style.marginBottom = '10px';
      explainer.textContent = codexEntry.explainer;
      detailBody.appendChild(explainer);

      const sandboxDesc = document.createElement('div');
      sandboxDesc.className = 'brick-hint';
      sandboxDesc.textContent = codexEntry.sandbox;
      detailBody.appendChild(sandboxDesc);
    }

    if (!gated) {
      sandboxHint.textContent = 'This brick is available right away — no sandbox required.';
      return;
    }

    if (unlocked) {
      sandboxHint.textContent = 'Unlocked! Replay the sandbox any time from here.';
    } else {
      sandboxHint.textContent = 'Locked — run the sandbox below once to unlock this brick everywhere.';
    }

    const playBtn = document.createElement('button');
    playBtn.className = 'bar primary';
    playBtn.textContent = '\u25B6 Run Sandbox';
    playBtn.addEventListener('click', () => playSandbox(selectedId, brickDef));
    sandboxBtns.appendChild(playBtn);

    const stopBtn = document.createElement('button');
    stopBtn.className = 'bar';
    stopBtn.textContent = '\u25A0 Stop';
    stopBtn.addEventListener('click', () => stopSandbox());
    sandboxBtns.appendChild(stopBtn);

    if (!unlocked) {
      const understoodBtn = document.createElement('button');
      understoodBtn.className = 'bar';
      understoodBtn.style.borderColor = 'var(--good)';
      understoodBtn.textContent = 'I Understand This \u2014 Unlock It';
      understoodBtn.addEventListener('click', () => {
        markCompleted(selectedId);
        ctx.toast(brickDef.label + ' unlocked! Find it in the Bricks Workshop now.');
        renderAll();
      });
      sandboxBtns.appendChild(understoodBtn);
    }
  }

  function renderAll() {
    refreshList();
    refreshDetail();
  }

  Promise.all([loadBrickCatalog(), loadCodexCatalog()]).then(([bc, cc]) => {
    brickCatalog = bc;
    codexCatalog = cc;
    renderAll();
  }).catch((err) => {
    ctx.toast('Could not load the Codex: ' + err.message, true);
  });

  /* ---------------------------------------------------------------- */
  /* teardown                                                           */
  /* ---------------------------------------------------------------- */
  const stopObs = new MutationObserver(() => {
    if (!document.body.contains(panel)) teardown();
  });
  stopObs.observe(document.body, { childList: true, subtree: true });

  function teardown() {
    stopObs.disconnect();
    stopSandbox();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  }
}
