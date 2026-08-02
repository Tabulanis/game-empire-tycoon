/**
 * @file backup.js
 * @description Auto-backup vault: timestamped zips of the open cartridge in
 * IndexedDB, pruned to the most recent N. Ticket P0-3.
 * Losing a level once costs more morale than this file costs to maintain.
 * Phase 0.
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { getCartridge, serialize, loadFromText, downloadBlob } from './cartridge.js';

const DB_NAME = 'get-backups';
const STORE = 'zips';
const KEEP = 20;

/** Auto-backup interval in minutes. */
export const INTERVAL_MINUTES = 5;

let timer = null;

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBDatabase} db
 * @param {IDBTransactionMode} mode
 * @returns {IDBObjectStore}
 */
function store(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** @param {IDBRequest} req @returns {Promise<any>} */
function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Write one backup of the open cartridge.
 * @param {string} [reason] 'auto' | 'manual-save' | 'pre-load'
 * @returns {Promise<{ok: boolean, id?: number, error?: string}>}
 */
export async function makeBackup(reason = 'auto') {
  try {
    const cart = getCartridge();
    const stamp = new Date();
    const json = serialize();
    const note =
      'Game Empire Tycoon backup\n' +
      'title: ' + cart.meta.title + '\n' +
      'reason: ' + reason + '\n' +
      'taken: ' + stamp.toISOString() + '\n';

    const zipped = zipSync({
      'cartridge.json': strToU8(json),
      'backup-info.txt': strToU8(note)
    }, { level: 6 });

    const db = await openDb();
    const id = stamp.getTime();
    await wrap(store(db, 'readwrite').put({
      id,
      title: cart.meta.title,
      reason,
      taken: stamp.toISOString(),
      bytes: zipped.byteLength,
      blob: new Blob([zipped], { type: 'application/zip' })
    }));
    await prune(db);
    db.close();
    return { ok: true, id };
  } catch (err) {
    console.warn('[backup] failed', err);
    return { ok: false, error: String(err) };
  }
}

/**
 * Keep only the newest KEEP entries.
 * @param {IDBDatabase} db
 */
async function prune(db) {
  const all = await wrap(store(db, 'readonly').getAll());
  if (all.length <= KEEP) return;
  all.sort((a, b) => b.id - a.id);
  const doomed = all.slice(KEEP);
  const st = store(db, 'readwrite');
  for (const entry of doomed) st.delete(entry.id);
}

/**
 * @returns {Promise<Array<{id:number,title:string,reason:string,taken:string,bytes:number}>>}
 */
export async function listBackups() {
  try {
    const db = await openDb();
    const all = await wrap(store(db, 'readonly').getAll());
    db.close();
    return all
      .map(({ id, title, reason, taken, bytes }) => ({ id, title, reason, taken, bytes }))
      .sort((a, b) => b.id - a.id);
  } catch (err) {
    console.warn('[backup] list failed', err);
    return [];
  }
}

/**
 * Restore a backup into the open cartridge slot.
 * @param {number} id
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function restoreBackup(id) {
  try {
    const db = await openDb();
    const entry = await wrap(store(db, 'readonly').get(id));
    db.close();
    if (!entry) return { ok: false, error: 'Backup not found.' };
    const buf = new Uint8Array(await entry.blob.arrayBuffer());
    const files = unzipSync(buf);
    const json = files['cartridge.json'];
    if (!json) return { ok: false, error: 'Backup zip has no cartridge.json.' };
    const result = await loadFromText(strFromU8(json), null);
    return { ok: result.ok, error: result.error };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Download a backup zip to disk.
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function downloadBackup(id) {
  try {
    const db = await openDb();
    const entry = await wrap(store(db, 'readonly').get(id));
    db.close();
    if (!entry) return false;
    const name = 'get-backup-' + new Date(entry.id).toISOString().replace(/[:.]/g, '-') + '.zip';
    downloadBlob(entry.blob, name);
    return true;
  } catch (err) {
    console.warn('[backup] download failed', err);
    return false;
  }
}

/**
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function deleteBackup(id) {
  try {
    const db = await openDb();
    await wrap(store(db, 'readwrite').delete(id));
    db.close();
    return true;
  } catch (err) {
    return false;
  }
}

/** Begin the periodic auto-backup timer. Safe to call twice. */
export function startAutoBackup() {
  if (timer) return;
  timer = setInterval(() => { makeBackup('auto'); }, INTERVAL_MINUTES * 60 * 1000);
}

/** Stop the auto-backup timer. */
export function stopAutoBackup() {
  if (timer) clearInterval(timer);
  timer = null;
}
