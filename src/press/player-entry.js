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
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { createTouchControls } from '../engine/touch-controls.js';
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

  /** VR controllers: thumbstick walks, trigger or A jumps */
  function pollVRInput(input) {
    const xrSession = engine.renderer.xr.getSession && engine.renderer.xr.getSession();
    if (!xrSession) return;
    let ax = 0, ay = 0, jump = false;
    for (const src of xrSession.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      // thumbstick lives at axes[2,3] on Quest-style pads, [0,1] on simpler ones
      const sx = gp.axes.length >= 4 ? gp.axes[2] : (gp.axes[0] || 0);
      const sy = gp.axes.length >= 4 ? gp.axes[3] : (gp.axes[1] || 0);
      if (Math.abs(sx) > Math.abs(ax)) ax = sx;
      if (Math.abs(sy) > Math.abs(ay)) ay = sy;
      if ((gp.buttons[0] && gp.buttons[0].pressed) || (gp.buttons[4] && gp.buttons[4].pressed)) jump = true;
    }
    input.left = ax < -0.35;
    input.right = ax > 0.35;
    input.up = ay < -0.35;
    input.down = ay > 0.35;
    input.jump = jump;
  }

  function loop(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.1);
    lastTs = ts;
    if (engine.xrPresenting) pollVRInput(desk.input);
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
  }

  startLevel();
  // the renderer's own loop, not requestAnimationFrame — rAF freezes inside
  // a headset session, setAnimationLoop runs everywhere
  lastTs = performance.now();
  engine.renderer.setAnimationLoop((ts) => loop(ts));

  // fullscreen toggle: floats top-right, above everything, obvious on touch
  const fsBtn = document.createElement('button');
  fsBtn.className = 'player-fs-btn';
  fsBtn.textContent = '⛶';
  fsBtn.title = 'Fullscreen';
  fsBtn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:20;width:44px;height:44px;border-radius:8px;border:1px solid rgba(255,255,255,0.35);background:rgba(0,0,0,0.45);color:#fff;font-size:22px;cursor:pointer;';
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });
  document.addEventListener('fullscreenchange', () => {
    fsBtn.textContent = document.fullscreenElement ? '🗗' : '⛶';
  });
  document.body.appendChild(fsBtn);

  // phones and tablets get virtual pads — stick to move, buttons to act
  createTouchControls(canvas.parentElement || document.body, desk.input, {
    shoot: !!(cartridge.settings.input && cartridge.settings.input.shoot),
    look: cartridge.settings.controlScheme === 'fps'
  });

  // any browser with a headset gets an Enter VR button — no setup, no setting
  if (navigator.xr && cartridge.settings.mode === '3d') {
    const vrBtn = VRButton.createButton(engine.renderer);
    document.body.appendChild(vrBtn);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
