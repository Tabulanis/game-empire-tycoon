/**
 * @file soundbooth-panel.js
 * @description Sound Booth tab: a 4-channel, 32-step tracker. Pick a note,
 * click steps to place it, assign a voice per channel (or one of 4 sample
 * slots pulled from saved SFX Foundry sounds), chain patterns into a song,
 * preview with Play, and Save (into cartridge.assets.songs).
 * Ticket P4-4. Phase 4.
 */

import * as cart from '../cartridge.js';
import * as sb from '../soundbooth.js';
import * as audio from '../../engine/systems/audio.js';
import { playSong } from '../../engine/systems/audio.js';
import { encodeWav } from '../wav.js';

let currentSongId = null;
let working = sb.createSong('Song');
let currentPatternId = 'pattern-1';
let selectedNote = 'C4';
/** @type {any} the active preview player's stop handle, or null */
let previewPlayer = null;

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderSoundboothPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Sound Booth</h2>' +
    '<div class="sub">4 channels, 32 steps, chain patterns into a song. Pick a note, click a step to place it.</div>';

  const bar = document.createElement('div');
  bar.className = 'stage-bar';
  const songSelect = document.createElement('select');
  songSelect.className = 'deck-select';
  bar.appendChild(songSelect);
  bar.appendChild(makeBtn('+ New Song', () => {
    const name = prompt('Song name?', 'Song');
    if (name === null) return;
    working = sb.createSong(name);
    currentSongId = null;
    currentPatternId = Object.keys(working.patterns)[0];
    renderAll();
  }));
  bar.appendChild(makeSep());
  const bpmLabel = document.createElement('span');
  bpmLabel.textContent = 'BPM:';
  bpmLabel.style.fontSize = '12px';
  bar.appendChild(bpmLabel);
  const bpmInput = document.createElement('input');
  bpmInput.type = 'number';
  bpmInput.min = '40'; bpmInput.max = '240'; bpmInput.style.width = '56px';
  bpmInput.addEventListener('change', () => { working.bpm = Number(bpmInput.value) || 120; });
  bar.appendChild(bpmInput);
  bar.appendChild(makeSep());
  const playBtn = makeBtn('\u25B6 Play', () => doPreviewPlay());
  playBtn.className += ' primary';
  const stopBtn = makeBtn('\u25A0 Stop', () => doPreviewStop());
  bar.appendChild(playBtn);
  bar.appendChild(stopBtn);
  bar.appendChild(makeSep());
  // "Save as a sound file": render one full pass of the chain offline \u2014
  // the exact same synthesis as live playback \u2014 and download it as WAV.
  // (The song itself always saves as data inside the cartridge; this is
  // the take-it-anywhere copy.)
  const wavBtn = makeBtn('\uD83D\uDCBE WAV', async () => {
    if (!working) return;
    wavBtn.disabled = true;
    ctx.toast('Rendering song\u2026');
    try {
      const rendered = await audio.renderSong(working, cart.getCartridge().assets.sfx);
      const bytes = encodeWav(rendered);
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (working.name || 'song') + '.wav';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      ctx.toast('Downloaded ' + a.download + '!');
    } catch (e) {
      ctx.toast('Could not render the song.', true);
    }
    wavBtn.disabled = false;
  });
  bar.appendChild(wavBtn);
  panel.appendChild(bar);

  // note picker
  const noteBar = document.createElement('div');
  noteBar.className = 'stage-bar';
  noteBar.style.flexWrap = 'wrap';
  const noteLabel = document.createElement('span');
  noteLabel.textContent = 'Note to place:';
  noteLabel.style.fontSize = '12px';
  noteBar.appendChild(noteLabel);
  const noteSelect = document.createElement('select');
  noteSelect.className = 'deck-select';
  for (const n of sb.NOTE_ROWS) {
    const opt = document.createElement('option'); opt.value = n; opt.textContent = n;
    if (n === selectedNote) opt.selected = true;
    noteSelect.appendChild(opt);
  }
  noteSelect.addEventListener('change', () => { selectedNote = noteSelect.value; });
  noteBar.appendChild(noteSelect);
  panel.appendChild(noteBar);

  const layout = document.createElement('div');
  layout.className = 'booth-layout';

  // ---------- left rail: the sound palette (voices + samples) ----------
  // DAW convention: the sounds you play WITH live on one side, the music
  // you're MAKING is the big center, and saved work sits on the other side.
  const palette = document.createElement('div');
  palette.className = 'booth-palette';

  // Pick a track, then click any sound to put it on that track (and hear
  // it). No dropdowns — the palette IS the picker.
  const voicesCard = document.createElement('div');
  voicesCard.className = 'card';
  voicesCard.innerHTML = '<h3>Tracks</h3>';
  const chRows = document.createElement('div');
  voicesCard.appendChild(chRows);
  palette.appendChild(voicesCard);

  const soundsCard = document.createElement('div');
  soundsCard.className = 'card';
  soundsCard.innerHTML = '<h3>Sounds</h3><div class="stage-hint">Click a sound to hear it and put it on the picked track.</div>';
  const soundsList = document.createElement('div');
  soundsCard.appendChild(soundsList);
  palette.appendChild(soundsCard);

  let selectedChannel = 0;
  const CHIP_VOICES = ['pulse', 'tri', 'saw', 'noise'];

  function voiceLabel(voice) {
    if (CHIP_VOICES.includes(voice)) return voice;
    if (voice && voice.startsWith('sfx:')) {
      const rec = cart.getCartridge().assets.sfx.find((x) => x.id === voice.slice(4));
      return rec ? rec.name : '(missing sound)';
    }
    return voice || 'pulse';
  }

  function previewVoice(voice) {
    if (voice.startsWith('sfx:')) {
      const rec = cart.getCartridge().assets.sfx.find((x) => x.id === voice.slice(4));
      if (rec) audio.playSfxAsset(rec);
      return;
    }
    // when=0 is clamped to "now" by WebAudio — a quick A4 taste of the voice
    audio.scheduleNote(0, 'A4', voice, 0.35, []);
  }
  layout.appendChild(palette);

  // ---------- center: the tracker itself ----------
  const left = document.createElement('div');

  const gridCard = document.createElement('div');
  gridCard.className = 'card';
  const patternHeader = document.createElement('div');
  patternHeader.className = 'stage-bar';
  const patternSelect = document.createElement('select');
  patternSelect.className = 'deck-select';
  patternHeader.appendChild(patternSelect);
  patternHeader.appendChild(makeBtn('+ Pattern', () => {
    const id = sb.addPattern(working);
    currentPatternId = id;
    renderAll();
  }));
  patternHeader.appendChild(makeBtn('Delete Pattern', () => {
    if (sb.deletePattern(working, currentPatternId)) {
      currentPatternId = Object.keys(working.patterns)[0];
      renderAll();
    } else {
      ctx.toast('A song needs at least one pattern.', true);
    }
  }));
  gridCard.appendChild(patternHeader);
  const grid = document.createElement('div');
  grid.className = 'tracker-grid';
  gridCard.appendChild(grid);
  left.appendChild(gridCard);

  const chainCard = document.createElement('div');
  chainCard.className = 'card';
  chainCard.innerHTML = '<h3>Chain</h3>';
  const chainRow = document.createElement('div');
  chainRow.className = 'tracker-chain-row';
  chainCard.appendChild(chainRow);
  const addChainSelect = document.createElement('select');
  addChainSelect.className = 'deck-select';
  addChainSelect.style.marginTop = '6px';
  chainCard.appendChild(addChainSelect);
  left.appendChild(chainCard);

  layout.appendChild(left);

  // ---------- right: library + save ----------
  const right = document.createElement('div');
  right.className = 'deck-right';

  const libCard = document.createElement('div');
  libCard.className = 'card';
  libCard.innerHTML = '<h3>My Songs</h3>';
  const libList = document.createElement('div');
  libCard.appendChild(libList);
  right.appendChild(libCard);

  const saveCard = document.createElement('div');
  saveCard.className = 'card';
  saveCard.innerHTML = '<h3>Save</h3>';
  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.className = 'title-input';
  nameInput.style.width = '100%'; nameInput.style.marginBottom = '8px';
  nameInput.addEventListener('change', () => { working.name = nameInput.value; });
  saveCard.appendChild(nameInput);
  const saveBtn = makeBtn('Save to Warehouse', () => {
    const live = cart.getCartridge();
    working.name = nameInput.value || working.name;
    const id = sb.saveSong(live, working);
    cart.touch();
    currentSongId = id;
    ctx.toast('Saved "' + working.name + '".');
    renderAll();
  });
  saveBtn.className += ' primary'; saveBtn.style.width = '100%';
  saveCard.appendChild(saveBtn);
  right.appendChild(saveCard);

  layout.appendChild(right);
  panel.appendChild(layout);
  host.appendChild(panel);

  /* ---------------------------------------------------------------- */
  /* rendering                                                          */
  /* ---------------------------------------------------------------- */

  function refreshSongSelect() {
    const live = cart.getCartridge();
    songSelect.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = currentSongId ? '(switch song)' : '(new, unsaved)';
    songSelect.appendChild(blank);
    for (const s of live.assets.songs) {
      const opt = document.createElement('option');
      opt.value = s.id; opt.textContent = s.name;
      if (s.id === currentSongId) opt.selected = true;
      songSelect.appendChild(opt);
    }
  }
  songSelect.addEventListener('change', () => {
    if (!songSelect.value) return;
    const live = cart.getCartridge();
    const record = live.assets.songs.find((s) => s.id === songSelect.value);
    if (!record) return;
    working = JSON.parse(JSON.stringify(record));
    currentSongId = record.id;
    currentPatternId = Object.keys(working.patterns)[0];
    renderAll();
  });

  function refreshPalette() {
    const live = cart.getCartridge();
    chRows.innerHTML = '';
    for (let ch = 0; ch < sb.CHANNEL_COUNT; ch++) {
      const row = document.createElement('button');
      row.className = 'booth-ch-row' + (ch === selectedChannel ? ' picked' : '');
      row.innerHTML = '<span class="booth-ch-num">' + (ch + 1) + '</span><span class="booth-ch-name"></span>';
      row.querySelector('.booth-ch-name').textContent = voiceLabel(working.channelVoices[ch]);
      row.addEventListener('click', () => { selectedChannel = ch; refreshPalette(); });
      chRows.appendChild(row);
    }
    soundsList.innerHTML = '';
    const addChip = (value, text) => {
      const chip = document.createElement('button');
      chip.className = 'booth-chip' + (working.channelVoices[selectedChannel] === value ? ' active' : '');
      chip.textContent = text;
      chip.addEventListener('click', () => {
        working.channelVoices[selectedChannel] = value;
        previewVoice(value);
        refreshPalette();
      });
      soundsList.appendChild(chip);
    };
    for (const v of CHIP_VOICES) addChip(v, '🕹 ' + v);
    for (const sfx of live.assets.sfx) {
      addChip('sfx:' + sfx.id, (sfx.kind === 'sample' ? '🎚 ' : '🔧 ') + sfx.name);
    }
  }


  function refreshPatternSelect() {
    patternSelect.innerHTML = '';
    for (const id of Object.keys(working.patterns)) {
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = id;
      if (id === currentPatternId) opt.selected = true;
      patternSelect.appendChild(opt);
    }
  }
  patternSelect.addEventListener('change', () => { currentPatternId = patternSelect.value; renderAll(); });

  /** gridCells[ch][step] -> the live cell element, cached so the playback
   * poll loop can toggle a class on the right cell every frame without
   * rebuilding (and re-binding click handlers on) the whole grid. */
  let gridCells = [];

  function refreshGrid() {
    grid.innerHTML = '';
    gridCells = [];
    const pattern = working.patterns[currentPatternId];
    if (!pattern) return;
    for (let ch = 0; ch < sb.CHANNEL_COUNT; ch++) {
      gridCells[ch] = [];
      const label = document.createElement('div');
      label.className = 'tracker-channel-label';
      label.textContent = 'Ch ' + (ch + 1);
      grid.appendChild(label);
      for (let step = 0; step < pattern.steps; step++) {
        const cell = document.createElement('div');
        renderCell(cell, ch, step);
        // In-place updates (no grid rebuild) keep the cell node stable so
        // double-click can fire on it — and clicks feel instant.
        cell.addEventListener('click', (e) => {
          const value = working.patterns[currentPatternId].channels[ch][step];
          if (Array.isArray(value)) {
            const half = e.target.closest('.half');
            const i = half && half.dataset.half === '1' ? 1 : 0;
            const next = value.slice();
            next[i] = next[i] ? null : selectedNote;
            sb.setStep(working, currentPatternId, ch, step, next);
          } else {
            sb.setStep(working, currentPatternId, ch, step, value ? null : selectedNote);
          }
          renderCell(cell, ch, step);
        });
        cell.addEventListener('dblclick', () => {
          // Two clicks just toggled the value twice (back to where it was),
          // so this is a clean split/merge toggle.
          const value = working.patterns[currentPatternId].channels[ch][step];
          if (Array.isArray(value)) {
            sb.setStep(working, currentPatternId, ch, step, value[0] || value[1] || null);
          } else {
            sb.setStep(working, currentPatternId, ch, step, [value, null]);
          }
          renderCell(cell, ch, step);
        });
        gridCells[ch][step] = cell;
        grid.appendChild(cell);
      }
    }
  }

  function renderCell(cell, ch, step) {
    const value = working.patterns[currentPatternId].channels[ch][step];
    const beat = step % 4 === 0 ? ' beat' : '';
    if (Array.isArray(value)) {
      cell.className = 'tracker-cell split' + ((value[0] || value[1]) ? ' filled' : '') + beat;
      cell.innerHTML = '';
      for (let i = 0; i < 2; i++) {
        const half = document.createElement('div');
        half.className = 'half' + (value[i] ? ' filled' : '');
        half.dataset.half = String(i);
        half.textContent = value[i] ? value[i].replace(/[0-9]/, '') : '';
        cell.appendChild(half);
      }
      cell.title = (value[0] || '·') + ' / ' + (value[1] || '·') + ' — double-click to merge';
    } else {
      cell.className = 'tracker-cell' + (value ? ' filled' : '') + beat;
      cell.innerHTML = '';
      cell.textContent = value ? value.replace(/[0-9]/, '') : '';
      cell.title = (value || '(empty)') + ' — double-click to split';
    }
  }

  function refreshChain() {
    chainRow.innerHTML = '';
    working.chain.forEach((patternId, i) => {
      const chip = document.createElement('div');
      chip.className = 'tracker-chain-chip';
      chip.textContent = patternId;
      const rm = document.createElement('span');
      rm.textContent = ' \u2715';
      rm.style.cursor = 'pointer'; rm.style.color = 'var(--bad)';
      rm.addEventListener('click', () => { sb.removeChainStep(working, i); refreshChain(); });
      chip.appendChild(rm);
      chainRow.appendChild(chip);
    });
    addChainSelect.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = '+ add to chain';
    addChainSelect.appendChild(blank);
    for (const id of Object.keys(working.patterns)) {
      const opt = document.createElement('option'); opt.value = id; opt.textContent = id;
      addChainSelect.appendChild(opt);
    }
  }
  addChainSelect.addEventListener('change', () => {
    if (!addChainSelect.value) return;
    sb.addChainStep(working, addChainSelect.value);
    refreshChain();
  });

  function refreshLibrary() {
    const live = cart.getCartridge();
    libList.innerHTML = '';
    if (!live.assets.songs.length) {
      libList.innerHTML = '<div class="stage-hint">No saved songs yet.</div>';
      return;
    }
    for (const s of live.assets.songs) {
      const row = document.createElement('div');
      row.className = 'stage-prefab-row';
      const label = document.createElement('span'); label.textContent = s.name;
      row.appendChild(label);
      const delBtn = makeBtn('\u2715', () => {
        if (!confirm('Delete "' + s.name + '"?')) return;
        sb.deleteSong(live, s.id);
        cart.touch();
        if (currentSongId === s.id) { working = sb.createSong('Song'); currentSongId = null; currentPatternId = Object.keys(working.patterns)[0]; }
        refreshLibrary(); refreshSongSelect();
      });
      delBtn.className += ' bad-btn';
      row.appendChild(delBtn);
      libList.appendChild(row);
    }
  }

  function renderAll() {
    nameInput.value = working.name;
    bpmInput.value = String(working.bpm);
    refreshSongSelect();
    refreshPalette();
    refreshPatternSelect();
    refreshGrid();
    refreshChain();
    refreshLibrary();
  }

  /* ---------------------------------------------------------------- */
  /* playback: the .playing outline style already existed in styles.css   */
  /* but nothing ever toggled it — this is what actually drives it now.   */
  /* ---------------------------------------------------------------- */
  let playRafId = null;
  let lastHighlightedStep = -1;

  function clearStepHighlight() {
    if (lastHighlightedStep < 0) return;
    for (let ch = 0; ch < sb.CHANNEL_COUNT; ch++) {
      const cell = gridCells[ch] && gridCells[ch][lastHighlightedStep];
      if (cell) cell.classList.remove('playing');
    }
    lastHighlightedStep = -1;
  }

  function pollPlayback() {
    if (!previewPlayer) return;
    const pos = previewPlayer.getPosition();

    chainRow.querySelectorAll('.tracker-chain-chip').forEach((chip, i) => {
      chip.classList.toggle('playing', i === pos.chainIndex);
    });

    if (pos.patternId !== currentPatternId) {
      clearStepHighlight();
    } else if (pos.stepIndex !== lastHighlightedStep) {
      clearStepHighlight();
      for (let ch = 0; ch < sb.CHANNEL_COUNT; ch++) {
        const cell = gridCells[ch] && gridCells[ch][pos.stepIndex];
        if (cell) cell.classList.add('playing');
      }
      lastHighlightedStep = pos.stepIndex;
    }
    playRafId = requestAnimationFrame(pollPlayback);
  }

  function doPreviewPlay() {
    doPreviewStop();
    previewPlayer = playSong(working, cart.getCartridge().assets.sfx);
    playBtn.disabled = true;
    stopBtn.disabled = false;
    playRafId = requestAnimationFrame(pollPlayback);
  }
  function doPreviewStop() {
    if (previewPlayer) { previewPlayer.stop(); previewPlayer = null; }
    if (playRafId) { cancelAnimationFrame(playRafId); playRafId = null; }
    clearStepHighlight();
    chainRow.querySelectorAll('.tracker-chain-chip.playing').forEach((chip) => chip.classList.remove('playing'));
    playBtn.disabled = false;
    stopBtn.disabled = true;
  }

  stopBtn.disabled = true;
  renderAll();

  /** Before this, leaving the Sound Booth tab mid-playback left the song
   * running forever — nothing ever stopped it. Same cleanup pattern used
   * by the Lab and Loft panels. */
  const stopObs = new MutationObserver(() => {
    if (!document.body.contains(panel)) { stopObs.disconnect(); doPreviewStop(); }
  });
  stopObs.observe(document.body, { childList: true, subtree: true });
}

function makeBtn(label, fn) {
  const b = document.createElement('button');
  b.className = 'bar';
  b.textContent = label;
  if (fn) b.addEventListener('click', fn);
  return b;
}
function makeSep() {
  const s = document.createElement('span');
  s.className = 'stage-sep';
  return s;
}
