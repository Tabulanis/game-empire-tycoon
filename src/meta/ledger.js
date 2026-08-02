/**
 * @file ledger.js
 * @description The honest ledger: real sales only, logged by hand — no
 * payment processor integration (this is an offline, standalone app with
 * no network calls per Article XIII), no pretend in-game currency. A kid
 * who sells their exported game on itch.io (or anywhere else) types in
 * what actually happened. Persisted in localStorage — this is studio-level
 * history, not part of any one cartridge.
 * Ticket P8-3. Phase 8.
 */

const LEDGER_KEY = 'get.ledger.v1';

/** @returns {Array<{id: string, date: string, amount: number, description: string}>} */
export function loadEntries() {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

/** @param {Array<any>} entries */
function saveEntries(entries) {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(entries));
  } catch (err) {
    /* best-effort — a full or unavailable localStorage never blocks the app */
  }
}

/**
 * Log a real sale. No validation beyond "is this a sane positive number" —
 * the honesty is the kid's, not a UI's to police (Article I: "Honest about
 * money. Real sales are logged as the legendary events they are.").
 * @param {number} amount  dollars — whole or fractional, whatever actually happened
 * @param {string} description  e.g. "First sale on itch.io!"
 * @param {string} [date]  ISO date string, defaults to today
 * @returns {any} the new entry
 */
export function logSale(amount, description, date) {
  const entries = loadEntries();
  const entry = {
    id: 'sale-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    date: date || new Date().toISOString().slice(0, 10),
    amount: Math.max(0, Number(amount) || 0),
    description: description || ''
  };
  entries.push(entry);
  saveEntries(entries);
  return entry;
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function deleteSale(id) {
  const entries = loadEntries();
  const i = entries.findIndex((e) => e.id === id);
  if (i < 0) return false;
  entries.splice(i, 1);
  saveEntries(entries);
  return true;
}

/** @returns {number} total dollars ever logged */
export function totalEarned() {
  return loadEntries().reduce((sum, e) => sum + e.amount, 0);
}

/** @returns {boolean} true the instant a first real dollar has been logged — Phase 8's ships-when criterion */
export function hasFirstDollar() {
  return totalEarned() > 0;
}
