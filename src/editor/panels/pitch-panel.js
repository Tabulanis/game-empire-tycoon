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
import * as backup from '../backup.js';
import * as pitch from '../../meta/pitch.js';
import { loadTemplate, applyTemplate } from '../templates.js';

/** Every template this build ships — the assembler can only pick among these.
 * Was missing rpg/strategy/collect-a-thon/fps until now; they existed and
 * worked fine, they just weren't reachable from the Pitch Meeting. */
const AVAILABLE_TEMPLATES = ['platformer', 'word', 'side-scroller', 'story', 'rpg', 'strategy', 'collect-a-thon', 'fps'];
/** finished mini-games on the Demo Shelf — open, play, take apart */
const DEMO_TEMPLATES = ['demo-well', 'demo-canyon', 'demo-moat', 'demo-lake', 'demo-lagoon', 'demo-maze'];

const AXIS_LABELS = {
  perspective: 'Perspective', verb: 'What do you do?', hero: 'Who are you?',
  goal: 'What\u2019s the goal?', tone: 'What\u2019s the tone?', world: 'Where is it?',
  difficulty: 'How hard?'
};

/** Honest, plain-language answer to "what does picking this actually do?" \u2014
 * perspective/verb genuinely steer which template you get matched to (2D vs
 * 3D, the whole genre); the rest mostly shape the story/summary, not the
 * template match, and say so rather than overclaim. */
const AXIS_EXPLAIN = {
  perspective: 'Decides 2D or 3D, and which template fits \u2014 this one really matters.',
  verb: 'The main thing you\u2019ll DO in the game \u2014 also steers which template fits.',
  hero: 'Who the player controls. Shows up in your story and title, not the mechanics.',
  goal: 'What you\u2019re working toward \u2014 shapes the story and how the game can end.',
  tone: 'The mood/vibe. Mostly flavor, but can nudge which template feels right.',
  world: 'Where it\u2019s set. Flavor for the story, doesn\u2019t change how it plays.',
  difficulty: 'How tough things feel. Flavor for now \u2014 tuning it for real comes later.'
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
    '<h2>New Game</h2>' +
    '<div class="sub">Answer a few questions, or describe your idea in your own words — we’ll match it to a ' +
    'template, then show you exactly what was picked before anything gets built.</div>';

  const formCard = document.createElement('div');
  formCard.className = 'card';
  formCard.innerHTML = '<h3>Questions</h3>';
  const axesGrid = document.createElement('div');
  formCard.appendChild(axesGrid);

  const pitchLabel = document.createElement('div');
  pitchLabel.className = 'stage-hint';
  pitchLabel.textContent = 'Or describe it in your own words:';
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
  meetBtn.textContent = 'Find My Template';
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

  /* -- Demo Shelf: complete little games, ready to play and take apart -- */
  const demoCard = document.createElement('div');
  demoCard.className = 'card';
  demoCard.innerHTML = '<h3>🕹 Demo Shelf</h3><div class="stage-hint">Finished mini-games. Open one, hit Play in the Build room, then take it apart and make it yours.</div>';
  const demoBody = document.createElement('div');
  demoCard.appendChild(demoBody);
  Promise.all(DEMO_TEMPLATES.map((id) =>
    fetch(new URL(`../../data/templates/${id}/manifest.json`, import.meta.url)).then((r) => r.json()).catch(() => null)
  )).then((manifests) => {
    for (const m of manifests) {
      if (!m) continue;
      const row = document.createElement('div');
      row.className = 'brick-row';
      row.style.alignItems = 'center';
      const label = document.createElement('div');
      label.style.flex = '1';
      label.innerHTML = '<strong>' + m.icon + ' ' + m.title + '</strong><div class="stage-hint" style="margin:2px 0 0;">' + m.blurb + '</div>';
      row.appendChild(label);
      const openBtn = document.createElement('button');
      openBtn.className = 'bar primary';
      openBtn.textContent = '▶ Open';
      openBtn.addEventListener('click', async () => {
        try {
          const loaded = await loadTemplate(m.id);
          cart.newCartridge(m.title, (c) => applyTemplate(c, loaded));
          ctx.toast('"' + m.title + '" is loaded — head to the Build room and hit Play!');
          ctx.refresh();
        } catch (err) {
          ctx.toast('Could not open the demo: ' + (err && err.message || err), true);
        }
      });
      row.appendChild(openBtn);
      demoBody.appendChild(row);
    }
  });
  panel.appendChild(demoCard);

  const confirmCard = document.createElement('div');
  confirmCard.className = 'card';
  confirmCard.innerHTML = '<h3>Confirm Your Choices</h3>';
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
      if (AXIS_EXPLAIN[axis]) {
        const explain = document.createElement('div');
        explain.style.cssText = 'font-size:11px;color:var(--muted,#8a92a6);margin-top:1px;margin-bottom:2px;';
        explain.textContent = AXIS_EXPLAIN[axis];
        row.appendChild(explain);
      }
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
        // This safety backup used to happen inside the old "New" button's
        // confirm() flow in shell.js — moved here since this is now the
        // actual point where the current cartridge gets replaced.
        await backup.makeBackup('pre-new');
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
