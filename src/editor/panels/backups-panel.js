/**
 * @file backups-panel.js
 * @description Backups tab: list, restore, download, delete. Ticket P0-3.
 * Phase 0.
 */

import * as backup from '../backup.js';

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export async function renderBackupsPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Backups</h2>' +
    '<div class="sub">Timestamped zips of the open cartridge, kept on this device. ' +
    'Automatic every ' + backup.INTERVAL_MINUTES + ' minutes and on every save. ' +
    'The newest 20 survive; older ones are pruned.</div>';

  const actions = document.createElement('div');
  actions.style.marginBottom = '12px';
  const now = document.createElement('button');
  now.className = 'bar primary';
  now.textContent = 'Back up now';
  now.addEventListener('click', async () => {
    const res = await backup.makeBackup('manual');
    ctx.toast(res.ok ? 'Backup written.' : 'Backup failed: ' + res.error, !res.ok);
    ctx.refresh();
  });
  actions.appendChild(now);
  panel.appendChild(actions);

  const list = document.createElement('div');
  panel.appendChild(list);
  host.appendChild(panel);

  const entries = await backup.listBackups();
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'stub';
    empty.innerHTML = '<b>No backups yet.</b><br />One will appear on your next save.';
    list.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'bk-row';

    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = new Date(entry.id).toLocaleString();
    row.appendChild(when);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = entry.title + '  \u00B7  ' + entry.reason + '  \u00B7  ' + formatBytes(entry.bytes);
    row.appendChild(name);

    row.appendChild(rowButton('Restore', async () => {
      if (!confirm('Restore this backup over the open cartridge?')) return;
      await backup.makeBackup('pre-restore');
      const res = await backup.restoreBackup(entry.id);
      ctx.toast(res.ok ? 'Backup restored.' : 'Restore failed: ' + res.error, !res.ok);
      ctx.refresh();
    }));
    row.appendChild(rowButton('Zip', async () => {
      const ok = await backup.downloadBackup(entry.id);
      if (!ok) ctx.toast('Could not download that backup.', true);
    }));
    row.appendChild(rowButton('Delete', async () => {
      if (!confirm('Delete this backup permanently?')) return;
      await backup.deleteBackup(entry.id);
      ctx.refresh();
    }));

    list.appendChild(row);
  }
}

/**
 * @param {string} label
 * @param {Function} fn
 * @returns {HTMLElement}
 */
function rowButton(label, fn) {
  const b = document.createElement('button');
  b.className = 'bar';
  b.textContent = label;
  b.addEventListener('click', () => fn());
  return b;
}

/**
 * @param {number} n
 * @returns {string}
 */
function formatBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
