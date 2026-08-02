/**
 * @file press-panel.js
 * @description Cartridge Press tab: one button that turns the open
 * cartridge into a single downloadable HTML file, via press/export.js.
 * Ticket P3-10. Phase 3.
 */

import * as cart from '../cartridge.js';
import { exportGame, shippedCount } from '../../press/export.js';

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderPressPanel(host, ctx) {
  const c = cart.getCartridge();
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Cartridge Press</h2>' +
    '<div class="sub">Turn this cartridge into one playable HTML file — no editor, no Warehouse, ' +
    'just the game. Send it to anyone; it opens straight in a browser, no install.</div>';

  const info = document.createElement('div');
  info.className = 'card';
  info.innerHTML =
    '<h3>Ready to export</h3>' +
    '<div class="kv"><span>Title</span><span>' + escapeHtml(c.meta.title) + '</span></div>' +
    '<div class="kv"><span>Scenes</span><span>' + c.scenes.length + '</span></div>' +
    '<div class="kv"><span>Bricksheets</span><span>' + Object.keys(c.bricksheets).length + '</span></div>' +
    '<div class="kv"><span>File name</span><span>' + slugify(c.meta.title) + '.html</span></div>';

  const btn = document.createElement('button');
  btn.className = 'bar primary';
  btn.style.width = '100%';
  btn.style.marginTop = '10px';
  btn.textContent = 'Export Game';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Exporting\u2026';
    const live = cart.getCartridge();
    const res = await exportGame(live);
    btn.disabled = false;
    btn.textContent = 'Export Game';
    if (res.ok) {
      const count = shippedCount();
      ctx.toast('Downloaded ' + slugify(live.meta.title) + '.html \u2014 ' + count + ' cartridge' + (count === 1 ? '' : 's') + ' shipped. Ready to sell it? See the Tycoon Shell for the itch.io guide.');
    } else {
      ctx.toast(res.error, true);
    }
  });
  info.appendChild(btn);
  panel.appendChild(info);

  const note = document.createElement('div');
  note.className = 'stub';
  note.innerHTML =
    '<b>One requirement:</b> Export needs a production build. If you\'re running <code>npm run dev</code>, ' +
    'run <code>npm run build</code> first and serve or open the <code>dist/</code> folder instead — ' +
    '<code>npm run build</code> builds the player shell automatically.';
  panel.appendChild(note);

  host.appendChild(panel);
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
