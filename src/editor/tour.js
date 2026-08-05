/**
 * @file tour.js
 * @description A tiny guided-tour runner: steps point at elements tagged
 * with data-tour attributes, the runner shows one step at a time in a
 * floating card and puts a pulsing gold outline on the target. Next/Back/
 * Skip driven — simple, skippable, per the studio's tutorial philosophy
 * (show, never lock). Step text lives in src/data/tours.json (kid-facing
 * strings in data files).
 */

import TOURS from '../data/tours.json';

/**
 * Start a named tour inside a panel. Safe to call again — any running
 * tour is replaced.
 * @param {string} name  key in tours.json
 * @param {HTMLElement} scope  where data-tour targets live
 */
export function startTour(name, scope) {
  endTour();
  const steps = (TOURS[name] || []);
  if (!steps.length) return;
  let index = 0;

  const card = document.createElement('div');
  card.className = 'tour-card';
  card.id = 'tourCard';
  document.body.appendChild(card);

  let highlighted = null;
  function show() {
    const step = steps[index];
    if (highlighted) highlighted.classList.remove('tour-highlight');
    highlighted = null;
    if (step.target) highlighted = scope.querySelector('[data-tour="' + step.target + '"]');
    if (!highlighted && step.targetText) {
      // find the card whose heading contains the text — no per-panel tagging needed
      for (const h of scope.querySelectorAll('.card h3, .panel h2')) {
        if (h.textContent.includes(step.targetText)) { highlighted = h.closest('.card') || h.parentElement; break; }
      }
    }
    if (highlighted) {
      highlighted.classList.add('tour-highlight');
      highlighted.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    card.innerHTML = '';
    const count = document.createElement('div');
    count.className = 'tour-count';
    count.textContent = (index + 1) + ' / ' + steps.length;
    card.appendChild(count);
    const title = document.createElement('h4');
    title.textContent = step.title;
    card.appendChild(title);
    const body = document.createElement('p');
    body.textContent = step.text;
    card.appendChild(body);
    const row = document.createElement('div');
    row.className = 'tour-row';
    const skip = document.createElement('button');
    skip.className = 'bar';
    skip.textContent = 'Skip tour';
    skip.addEventListener('click', stop);
    row.appendChild(skip);
    if (index > 0) {
      const back = document.createElement('button');
      back.className = 'bar';
      back.textContent = '← Back';
      back.addEventListener('click', () => { index--; show(); });
      row.appendChild(back);
    }
    const next = document.createElement('button');
    next.className = 'bar primary';
    next.textContent = index === steps.length - 1 ? '✔ Done!' : 'Next →';
    next.addEventListener('click', () => {
      if (index === steps.length - 1) stop();
      else { index++; show(); }
    });
    row.appendChild(next);
    card.appendChild(row);
  }

  function stop() {
    if (highlighted) highlighted.classList.remove('tour-highlight');
    highlighted = null;
    card.remove();
  }
  show();
}

/** Remove any running tour (panel teardown). */
export function endTour() {
  const existing = document.getElementById('tourCard');
  if (existing) existing.remove();
  for (const el of document.querySelectorAll('.tour-highlight')) el.classList.remove('tour-highlight');
}
