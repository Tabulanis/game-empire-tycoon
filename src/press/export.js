/**
 * @file export.js
 * @description Cartridge Press: turns the open cartridge into one playable
 * HTML file. Fetches the pre-built player shell (public/player.html — built
 * by `npm run build:player`, chained into the main `npm run build`), splices
 * the cartridge's JSON in place of a placeholder string (a string literal
 * survives production minification; a comment marker would not), and
 * triggers a browser download.
 *
 * Requires the app to be running from a production build (`npm run build`,
 * then serve/open dist/) — the dev server (`npm run dev`) has no reason to
 * also run the player's separate build, so public/player.html may be stale
 * or absent there. This is a Phase-3 v1 limitation, not a bug: the Constitution
 * doesn't require exporting to work from `npm run dev`.
 * Ticket P3-10. Phase 3.
 */

const PLACEHOLDER_RE = /(['"])__GET_CARTRIDGE_JSON_PLACEHOLDER__\1/;
const SHIPPED_COUNT_KEY = 'get.shipped.v1';

/** @returns {number} how many cartridges have ever been successfully exported from this browser */
export function shippedCount() {
  try {
    return Number(localStorage.getItem(SHIPPED_COUNT_KEY)) || 0;
  } catch (err) {
    return 0;
  }
}

function recordShip() {
  try {
    localStorage.setItem(SHIPPED_COUNT_KEY, String(shippedCount() + 1));
  } catch (err) {
    /* best-effort — a full or unavailable localStorage never blocks export */
  }
}

/**
 * @param {any} cartridge
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function exportGame(cartridge) {
  let html;
  try {
    const res = await fetch('./player.html');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    html = await res.text();
  } catch (err) {
    return {
      ok: false,
      error: 'Could not load the player shell (' + (err && err.message || err) + '). ' +
        'Cartridge Press needs a production build — run "npm run build" (which builds the player ' +
        'automatically), then open or serve the dist/ folder rather than the dev server.'
    };
  }

  if (!PLACEHOLDER_RE.test(html)) {
    return { ok: false, error: 'The player shell is missing its cartridge placeholder — it may be out of date. Rebuild with "npm run build".' };
  }

  const injected = JSON.stringify(JSON.stringify(cartridge));
  const finalHtml = html.replace(PLACEHOLDER_RE, () => injected);

  const blob = new Blob([finalHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const filename = slugify(cartridge.meta.title || 'game') + '.html';
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  recordShip();

  return { ok: true };
}

/**
 * @param {string} s
 * @returns {string}
 */
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
}
