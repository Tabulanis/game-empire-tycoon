/**
 * @file player-entry.js
 * @description The exported game's entire runtime bootstrap. This file (and
 * everything it imports from engine/) is ALL that ships inside a Cartridge
 * Press export — no editor/ code, no Tweakpane, no Warehouse browser. It
 * reads the cartridge baked into the page by press/export.js, boots the
 * real game (engine/runtime.js — the exact same interpreter the Stage's
 * Play button runs), and shows a plain win/lose screen.
 * Ticket P3-10. Phase 3.
 */

import { createEngine } from '../engine/renderer.js';
import { startRuntime, createInputDesk } from '../engine/runtime.js';

/**
 * The cartridge is injected as a JSON string literal by press/export.js,
 * replacing this exact placeholder text. A string (not a bare object
 * literal in a comment) survives production minification, which strips
 * comments but never rewrites string contents.
 */
const CARTRIDGE_JSON = '__GET_CARTRIDGE_JSON_PLACEHOLDER__';

function boot() {
  const cartridge = JSON.parse(CARTRIDGE_JSON);

  document.title = cartridge.meta.title || 'A Game Empire Tycoon Game';

  const canvas = document.getElementById('game-canvas');
  const overlay = document.getElementById('game-overlay');
  const overlayText = document.getElementById('game-overlay-text');
  const overlayBtn = document.getElementById('game-overlay-btn');

  const engine = createEngine(canvas, { demo: false });
  { const _l = (typeof cart !== 'undefined' && cart.getCartridge) ? cart.getCartridge().settings.lighting : (typeof cartridge !== 'undefined' && cartridge.settings ? cartridge.settings.lighting : null); if (_l && engine.setLighting) engine.setLighting(_l); }
  engine.resolveSpriteAsset = (assetId) => {
    const sprite = (cartridge.assets.sprites || []).find((s) => s.id === assetId);
    return sprite && sprite.frames && sprite.frames[0] ? sprite.frames[0].dataURL : null;
  };
  engine.resolveModelAsset = (assetId) => {
    const live = cartridge;
    return (live.assets.models || []).find((m) => m.id === assetId) || null;
  };
  engine.setMode(cartridge.settings.mode);

  function resize() {
    engine.resize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);
  resize();

  const desk = createInputDesk(cartridge);
  desk.bind();

  const firstSceneId = cartridge.scenes[0] && cartridge.scenes[0].id;

  /** @type {any} */
  let runtime = null;
  let lastTs = performance.now();
  let running = true;

  function showOverlay(text, buttonLabel, onClick) {
    overlayText.textContent = text;
    overlayBtn.textContent = buttonLabel;
    overlayBtn.onclick = onClick;
    overlay.style.display = 'flex';
  }
  function hideOverlay() {
    overlay.style.display = 'none';
  }

  async function startLevel() {
    hideOverlay();
    running = true;
    runtime = await startRuntime(engine, cartridge, firstSceneId, () => {});
  }

  function loop(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.1);
    lastTs = ts;
    if (running && runtime) {
      const { ended } = runtime.tick(dt, desk.input);
      if (ended) {
        running = false;
        showOverlay(
          ended.result === 'win' ? (ended.message || 'You win!') : (ended.message || 'Game over.'),
          'Play Again',
          () => { runtime.stop(); startLevel(); }
        );
      }
    }
    engine.tick();
    requestAnimationFrame(loop);
  }

  startLevel();
  requestAnimationFrame((ts) => { lastTs = ts; loop(ts); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
