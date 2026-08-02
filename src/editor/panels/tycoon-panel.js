/**
 * @file tycoon-panel.js
 * @description The Tycoon Shell tab: era progress dashboard, staff roster,
 * the honest real-sale ledger, and a step-by-step itch.io shipping guide.
 * Ticket P8-1/P8-3/P8-4. Phase 8.
 */

import * as tycoon from '../../meta/tycoon.js';
import * as ledger from '../../meta/ledger.js';

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderTycoonPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>The Tycoon Shell</h2>' +
    '<div class="sub">Your studio\u2019s story so far \u2014 no era is time-locked, everything you\u2019ve already built ' +
    'stays exactly as available as it always was. This just keeps score.</div>';

  const progress = tycoon.currentProgress();
  const era = tycoon.currentEra(progress);
  const next = tycoon.nextEra(era);

  /* ---------------------------------------------------------------- */
  /* era dashboard                                                       */
  /* ---------------------------------------------------------------- */
  const eraCard = document.createElement('div');
  eraCard.className = 'card';
  eraCard.innerHTML =
    '<h3>' + era.name + ' <span class="stage-hint">(' + era.months + ' months, in the fiction)</span></h3>' +
    '<div style="margin-bottom:8px;">' + era.fiction + '</div>' +
    '<div class="brick-hint"><b>Unlocked so far:</b> ' + era.unlocks + '</div>' +
    '<div class="brick-hint"><b>Real skills:</b> ' + era.skills + '</div>' +
    '<div class="stage-hint" style="margin-top:8px;">' +
      'Shipped cartridges: ' + progress.shipped + ' \u00b7 Codex sandboxes completed: ' + progress.sandboxes +
    '</div>';
  if (next) {
    eraCard.innerHTML += '<div class="stage-hint" style="margin-top:6px;">Next up: <b>' + next.name +
      '</b> \u2014 ship ' + next.shippedThreshold + ' cartridges or complete ' + next.sandboxThreshold +
      ' Codex sandboxes to open it.</div>';
  } else {
    eraCard.innerHTML += '<div class="stage-hint" style="margin-top:6px;">You\u2019ve reached the last era. The studio keeps growing from here.</div>';
  }
  panel.appendChild(eraCard);

  /* ---------------------------------------------------------------- */
  /* era roadmap                                                        */
  /* ---------------------------------------------------------------- */
  const roadmapCard = document.createElement('div');
  roadmapCard.className = 'card';
  roadmapCard.innerHTML = '<h3>Studio Roadmap</h3>';
  const roadmapList = document.createElement('div');
  for (const e of tycoon.ERAS) {
    const reached = tycoon.ERAS.findIndex((x) => x.id === era.id) >= tycoon.ERAS.findIndex((x) => x.id === e.id);
    const row = document.createElement('div');
    row.className = 'stage-tree-row';
    const dot = document.createElement('span');
    dot.className = 'stage-dot';
    dot.style.background = reached ? 'var(--good)' : 'var(--dim)';
    row.appendChild(dot);
    const label = document.createElement('span');
    label.textContent = e.name + (e.id === era.id ? ' \u2014 you are here' : '');
    row.appendChild(label);
    roadmapList.appendChild(row);
  }
  roadmapCard.appendChild(roadmapList);
  panel.appendChild(roadmapCard);

  /* ---------------------------------------------------------------- */
  /* staff roster                                                        */
  /* ---------------------------------------------------------------- */
  const staffCard = document.createElement('div');
  staffCard.className = 'card';
  staffCard.innerHTML = '<h3>Staff</h3>';
  const staffList = document.createElement('div');
  staffList.className = 'stage-bar';
  staffList.style.flexWrap = 'wrap';
  for (const member of tycoon.activeStaff(era)) {
    const chip = document.createElement('div');
    chip.className = 'tracker-chain-chip';
    chip.textContent = member.name + ' \u2014 ' + member.role;
    staffList.appendChild(chip);
  }
  staffCard.appendChild(staffList);
  panel.appendChild(staffCard);

  /* ---------------------------------------------------------------- */
  /* the ledger                                                          */
  /* ---------------------------------------------------------------- */
  const ledgerCard = document.createElement('div');
  ledgerCard.className = 'card';
  ledgerCard.innerHTML = '<h3>The Ledger</h3><div class="stage-hint">Real dollars only. No pretend gold.</div>';
  const totalDisplay = document.createElement('div');
  totalDisplay.style.cssText = 'font-size:28px;font-weight:700;margin:8px 0;';
  ledgerCard.appendChild(totalDisplay);
  const entriesList = document.createElement('div');
  ledgerCard.appendChild(entriesList);

  const addRow = document.createElement('div');
  addRow.className = 'stage-bar';
  addRow.style.flexWrap = 'wrap';
  const amountInput = document.createElement('input');
  amountInput.type = 'number'; amountInput.step = '0.01'; amountInput.min = '0'; amountInput.placeholder = 'Amount ($)';
  amountInput.style.width = '110px';
  addRow.appendChild(amountInput);
  const descInput = document.createElement('input');
  descInput.type = 'text'; descInput.placeholder = 'What happened?';
  descInput.style.flex = '1'; descInput.style.minWidth = '150px';
  addRow.appendChild(descInput);
  const logBtn = document.createElement('button');
  logBtn.className = 'bar primary';
  logBtn.textContent = 'Log a Real Sale';
  logBtn.addEventListener('click', () => {
    const amount = Number(amountInput.value);
    if (!amount || amount <= 0) { ctx.toast('Enter a real amount first.', true); return; }
    const wasFirst = !ledger.hasFirstDollar();
    ledger.logSale(amount, descInput.value);
    amountInput.value = ''; descInput.value = '';
    refreshLedger();
    ctx.toast(wasFirst ? 'Your first real dollar! Logged, for good.' : 'Logged.');
  });
  addRow.appendChild(logBtn);
  ledgerCard.appendChild(addRow);
  panel.appendChild(ledgerCard);

  function refreshLedger() {
    const total = ledger.totalEarned();
    totalDisplay.textContent = '$' + total.toFixed(2) + ' earned';
    entriesList.innerHTML = '';
    const entries = ledger.loadEntries().slice().reverse();
    if (!entries.length) {
      entriesList.innerHTML = '<div class="stage-hint">No sales logged yet \u2014 that first one is a real milestone.</div>';
      return;
    }
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'stage-prefab-row';
      const label = document.createElement('span');
      label.textContent = entry.date + ' \u2014 $' + entry.amount.toFixed(2) + (entry.description ? ' \u2014 ' + entry.description : '');
      row.appendChild(label);
      const delBtn = document.createElement('button');
      delBtn.className = 'bar bad-btn';
      delBtn.textContent = '\u2715';
      delBtn.addEventListener('click', () => {
        if (!confirm('Remove this entry from the ledger?')) return;
        ledger.deleteSale(entry.id);
        refreshLedger();
      });
      row.appendChild(delBtn);
      entriesList.appendChild(row);
    }
  }
  refreshLedger();

  /* ---------------------------------------------------------------- */
  /* itch.io shipping guide                                             */
  /* ---------------------------------------------------------------- */
  const guideCard = document.createElement('div');
  guideCard.className = 'card';
  guideCard.innerHTML = '<h3>Shipping to itch.io</h3>';
  const steps = [
    ['Export your game', 'Open Cartridge Press and click Export Game. You get one .html file \u2014 that\u2019s your whole game, no other files needed.'],
    ['Zip it', 'Put that single .html file into a .zip archive. itch.io needs a zip for HTML games, even if it\u2019s only one file inside.'],
    ['Create a project on itch.io', 'On itch.io, click "Upload new project." Give it a name and a short description \u2014 what\u2019s the game about?'],
    ['Set the kind to HTML', 'Under "Kind of project," choose HTML. Upload your zip file.'],
    ['Check "This file will be played in the browser"', 'itch.io needs this checked to run your game directly on the page instead of offering it as a download.'],
    ['Set your price', 'Free, pay-what-you-want, or a fixed price \u2014 your call. Even $0 minimum with an optional tip counts as a real listing.'],
    ['Publish', 'Save and view the page. Play it yourself first, all the way through, before telling anyone else it\u2019s up.'],
    ['Log it here', 'The moment someone actually pays for it \u2014 even a dollar \u2014 come back to the Ledger above and log it. That\u2019s the milestone.']
  ];
  const stepsList = document.createElement('ol');
  stepsList.style.paddingLeft = '20px';
  for (const [title, body] of steps) {
    const li = document.createElement('li');
    li.style.marginBottom = '8px';
    li.innerHTML = '<b>' + title + '</b><br /><span class="stage-hint">' + body + '</span>';
    stepsList.appendChild(li);
  }
  guideCard.appendChild(stepsList);
  panel.appendChild(guideCard);

  host.appendChild(panel);
}
