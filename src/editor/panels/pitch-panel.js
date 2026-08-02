/**
 * @file pitch-panel.js
 * @description Pitch Meeting tab: pick answers across the interview axes,
 * optionally type a free-text pitch, meet with the staff (scores every
 * template, picks the best fit), review the design doc — every line
 * editable — then build it, which creates a new cartridge from the chosen
 * template exactly the way the New button's template picker already does.
 * Ticket P4-6. Phase 4.
 */

import * as cart from '../cartridge.js';
import * as pitch from '../../meta/pitch.js';
import { loadTemplate, applyTemplate } from '../templates.js';

/** Every template this build ships — the assembler can only pick among these. */
const AVAILABLE_TEMPLATES = ['platformer', 'word', 'side-scroller', 'story'];

const AXIS_LABELS = {
  perspective: 'Perspective', verb: 'What do you do?', hero: 'Who are you?',
  goal: 'What\u2019s the goal?', tone: 'What\u2019s the tone?', world: 'Where is it?',
  difficulty: 'How hard?'
};

let answers = {};
let pitchText = '';
let designDoc = null;
let rankedTemplates = [];

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderPitchPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Pitch Meeting</h2>' +
    '<div class="sub">Answer a few questions, or just pitch your idea in your own words — the staff figures out ' +
    'which template fits, then shows you exactly what they heard before building anything.</div>';

  const formCard = document.createElement('div');
  formCard.className = 'card';
  formCard.innerHTML = '<h3>The Interview</h3>';
  const axesGrid = document.createElement('div');
  formCard.appendChild(axesGrid);

  const pitchLabel = document.createElement('div');
  pitchLabel.className = 'stage-hint';
  pitchLabel.textContent = 'Or pitch it in your own words:';
  pitchLabel.style.marginTop = '10px';
  formCard.appendChild(pitchLabel);
  const pitchInput = document.createElement('textarea');
  pitchInput.rows = 3;
  pitchInput.style.cssText = 'width:100%;background:var(--bg-2);border:1px solid var(--line);color:var(--ink);font-family:var(--font);padding:8px;';
  pitchInput.placeholder = 'a dragon who has to deliver pizza to a haunted castle...';
  pitchInput.addEventListener('change', () => { pitchText = pitchInput.value; });
  formCard.appendChild(pitchInput);

  const meetBtn = document.createElement('button');
  meetBtn.className = 'bar primary';
  meetBtn.style.width = '100%'; meetBtn.style.marginTop = '10px';
  meetBtn.textContent = 'Meet with the Staff';
  meetBtn.addEventListener('click', async () => {
    const tagsData = await pitch.loadTagsData();
    const hits = pitch.parsePitchText(pitchText, tagsData);
    const vector = pitch.buildTagVector(answers, hits);
    const manifests = await Promise.all(AVAILABLE_TEMPLATES.map((id) =>
      fetch(new URL(`../../data/templates/${id}/manifest.json`, import.meta.url)).then((r) => r.json())
    ));
    rankedTemplates = pitch.rankTemplates(vector, manifests);
    designDoc = pitch.buildDesignDoc(vector, rankedTemplates[0].manifest);
    refreshConfirmation();
  });
  formCard.appendChild(meetBtn);
  panel.appendChild(formCard);

  const confirmCard = document.createElement('div');
  confirmCard.className = 'card';
  confirmCard.innerHTML = '<h3>Did We Hear You Right?</h3>';
  const confirmBody = document.createElement('div');
  confirmCard.appendChild(confirmBody);
  panel.appendChild(confirmCard);

  host.appendChild(panel);

  /* ---------------------------------------------------------------- */
  /* interview axes                                                     */
  /* ---------------------------------------------------------------- */
  async function renderAxes() {
    const tagsData = await pitch.loadTagsData();
    axesGrid.innerHTML = '';
    for (const [axis, options] of Object.entries(tagsData.axes)) {
      const row = document.createElement('div');
      row.style.marginBottom = '8px';
      const label = document.createElement('div');
      label.className = 'stage-hint';
      label.textContent = AXIS_LABELS[axis] || axis;
      row.appendChild(label);
      const optRow = document.createElement('div');
      optRow.className = 'stage-bar';
      optRow.style.flexWrap = 'wrap';
      for (const opt of options) {
        const btn = document.createElement('button');
        btn.className = 'bar' + (answers[axis] === opt ? ' active' : '');
        btn.textContent = opt;
        btn.addEventListener('click', () => {
          answers[axis] = answers[axis] === opt ? undefined : opt; // click again to unset
          renderAxes();
        });
        optRow.appendChild(btn);
      }
      row.appendChild(optRow);
      axesGrid.appendChild(row);
    }
  }

  /* ---------------------------------------------------------------- */
  /* confirmation screen                                                */
  /* ---------------------------------------------------------------- */
  function refreshConfirmation() {
    confirmBody.innerHTML = '';
    if (!designDoc) {
      confirmBody.innerHTML = '<div class="stage-hint">Meet with the staff first.</div>';
      return;
    }

    const templateLabel = document.createElement('div');
    templateLabel.innerHTML = '<b>Template:</b> ';
    const templateSelect = document.createElement('select');
    templateSelect.className = 'deck-select';
    for (const { manifest, score } of rankedTemplates) {
      const opt = document.createElement('option');
      opt.value = manifest.id;
      opt.textContent = manifest.id + ' (matched ' + score + ' of your answers)';
      if (manifest.id === designDoc.template) opt.selected = true;
      templateSelect.appendChild(opt);
    }
    templateSelect.addEventListener('change', () => { designDoc.template = templateSelect.value; });
    templateLabel.appendChild(templateSelect);
    confirmBody.appendChild(templateLabel);

    if (designDoc.note) {
      const note = document.createElement('div');
      note.className = 'stage-hint';
      note.style.marginTop = '4px';
      note.textContent = designDoc.note;
      confirmBody.appendChild(note);
    }

    const linesDiv = document.createElement('div');
    linesDiv.style.marginTop = '8px';
    for (const line of designDoc.lines) {
      const row = document.createElement('div');
      row.className = 'brick-row';
      const label = document.createElement('span');
      label.textContent = (AXIS_LABELS[line.axis] || line.axis) + ':';
      label.style.minWidth = '130px';
      row.appendChild(label);
      const input = document.createElement('input');
      input.type = 'text'; input.value = line.value;
      input.addEventListener('change', () => { line.value = input.value; });
      row.appendChild(input);
      linesDiv.appendChild(row);
    }
    confirmBody.appendChild(linesDiv);

    const titleRow = document.createElement('div');
    titleRow.style.marginTop = '8px';
    titleRow.innerHTML = '<span class="stage-hint">Game title:</span>';
    const titleInput = document.createElement('input');
    titleInput.type = 'text'; titleInput.className = 'title-input';
    titleInput.style.width = '100%';
    titleInput.value = 'My ' + designDoc.template + ' Game';
    titleRow.appendChild(titleInput);
    confirmBody.appendChild(titleRow);

    const buildBtn = document.createElement('button');
    buildBtn.className = 'bar primary';
    buildBtn.style.width = '100%'; buildBtn.style.marginTop = '10px';
    buildBtn.textContent = 'Build It';
    buildBtn.addEventListener('click', async () => {
      if (cart.isDirty() && !confirm('Discard unsaved changes and build this new cartridge?')) return;
      try {
        const loaded = await loadTemplate(designDoc.template);
        cart.newCartridge(titleInput.value || 'Untitled Game', (c) => applyTemplate(c, loaded));
        ctx.toast('Built "' + (titleInput.value || 'Untitled Game') + '" from the ' + designDoc.template + ' template.');
        ctx.refresh();
      } catch (err) {
        ctx.toast('Could not build the game: ' + (err && err.message || err), true);
      }
    });
    confirmBody.appendChild(buildBtn);
  }

  renderAxes();
  refreshConfirmation();
}
