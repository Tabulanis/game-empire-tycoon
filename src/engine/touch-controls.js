/**
 * @file touch-controls.js
 * @description Virtual game controls for phones and tablets: a floating
 * thumbstick that appears wherever the left thumb lands, big action buttons
 * under the right thumb (Jump always, Shoot when the game maps one), and —
 * in first-person games — drag-to-look on the right half of the screen.
 * Writes into the same input object the keyboard uses, so the runtime never
 * knows the difference. Created on play, disposed on stop; returns null on
 * mouse-only machines so desktops never see it.
 */

/** @returns {boolean} */
export function isTouchDevice() {
  return (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) ||
    (typeof window !== 'undefined' && 'ontouchstart' in window);
}

/**
 * @param {HTMLElement} container  positioned element covering the game view
 * @param {any} input  the runtime input object (left/right/up/down/jump/actions/yawDelta/pitchDelta)
 * @param {{shoot?: boolean, look?: boolean}} [opts]
 * @returns {{dispose: () => void}|null}
 */
export function createTouchControls(container, input, opts = {}) {
  if (!isTouchDevice()) return null;

  const layer = document.createElement('div');
  layer.className = 'touch-controls';

  const stickBase = document.createElement('div');
  stickBase.className = 'tc-stick';
  const stickThumb = document.createElement('div');
  stickThumb.className = 'tc-thumb';
  stickBase.appendChild(stickThumb);
  stickBase.style.display = 'none';
  layer.appendChild(stickBase);

  const RADIUS = 52;
  const DEAD = 0.28;

  const makeButton = (label, cls, press, release) => {
    const b = document.createElement('div');
    b.className = 'tc-btn ' + cls;
    b.textContent = label;
    const down = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('held'); press(); };
    const up = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.remove('held'); release(); };
    b.addEventListener('touchstart', down, { passive: false });
    b.addEventListener('touchend', up, { passive: false });
    b.addEventListener('touchcancel', up, { passive: false });
    layer.appendChild(b);
    return b;
  };

  makeButton('⤒', 'tc-jump', () => {
    input.jump = true;
    if (input.actions) input.actions.jump = true;
  }, () => {
    input.jump = false;
    if (input.actions) input.actions.jump = false;
  });
  if (opts.shoot) {
    makeButton('✦', 'tc-shoot', () => {
      if (input.actions) input.actions.shoot = true;
    }, () => {
      if (input.actions) input.actions.shoot = false;
    });
  }

  let stickId = null;
  let stickOrigin = [0, 0];
  let lookId = null;
  let lookLast = [0, 0];

  const applyStick = (dx, dy) => {
    const len = Math.hypot(dx, dy);
    const cl = len > RADIUS ? RADIUS / len : 1;
    stickThumb.style.transform = `translate(${dx * cl}px, ${dy * cl}px)`;
    const nx = (dx * cl) / RADIUS, ny = (dy * cl) / RADIUS;
    input.left = nx < -DEAD;
    input.right = nx > DEAD;
    input.up = ny < -DEAD;    // push forward = up
    input.down = ny > DEAD;
  };
  const resetStick = () => {
    stickId = null;
    stickBase.style.display = 'none';
    stickThumb.style.transform = '';
    input.left = input.right = input.up = input.down = false;
  };

  function onStart(e) {
    for (const t of e.changedTouches) {
      const rect = layer.getBoundingClientRect();
      const x = t.clientX - rect.left, y = t.clientY - rect.top;
      if (x < rect.width * 0.45 && stickId === null) {
        // stick spawns under the thumb, wherever it lands
        stickId = t.identifier;
        stickOrigin = [t.clientX, t.clientY];
        stickBase.style.left = (x - 60) + 'px';
        stickBase.style.top = (y - 60) + 'px';
        stickBase.style.display = '';
        applyStick(0, 0);
      } else if (opts.look && lookId === null) {
        lookId = t.identifier;
        lookLast = [t.clientX, t.clientY];
      }
    }
    e.preventDefault();
  }
  function onMove(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        applyStick(t.clientX - stickOrigin[0], t.clientY - stickOrigin[1]);
      } else if (t.identifier === lookId) {
        input.yawDelta = (input.yawDelta || 0) - (t.clientX - lookLast[0]) * 0.006;
        input.pitchDelta = (input.pitchDelta || 0) - (t.clientY - lookLast[1]) * 0.006;
        lookLast = [t.clientX, t.clientY];
      }
    }
    e.preventDefault();
  }
  function onEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) resetStick();
      if (t.identifier === lookId) lookId = null;
    }
  }
  layer.addEventListener('touchstart', onStart, { passive: false });
  layer.addEventListener('touchmove', onMove, { passive: false });
  layer.addEventListener('touchend', onEnd);
  layer.addEventListener('touchcancel', onEnd);

  container.appendChild(layer);

  return {
    dispose() {
      resetStick();
      if (input.actions) { input.actions.jump = false; input.actions.shoot = false; }
      input.jump = false;
      layer.remove();
    }
  };
}
