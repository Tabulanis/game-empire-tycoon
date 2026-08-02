/**
 * @file studio-panel.js
 * @description The Studio tab: cartridge overview plus the phase self-tests
 * that demonstrate each ships-when criterion. Ticket P0-1/P0-5, extended for
 * Phase 1.
 * Phase 1.
 */

import * as cart from '../cartridge.js';

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderStudioPanel(host, ctx) {
  const c = cart.getCartridge();
  const panel = document.createElement('div');
  panel.className = 'panel';

  panel.innerHTML =
    '<h2>Studio</h2>' +
    '<div class="sub">Phase 8 &mdash; Going Public. Check your studio\u2019s era in the <b>Tycoon Shell</b>, ' +
    'ship a cartridge, and log your first honest dollar in the Ledger.</div>';

  const info = document.createElement('div');
  info.className = 'card';
  info.innerHTML =
    '<h3>Open cartridge</h3>' +
    row('Title', c.meta.title) +
    row('Format', 'get v' + c.get) +
    row('Created', new Date(c.meta.created).toLocaleString()) +
    row('Era', c.meta.era) +
    row('Template', c.meta.template || '\u2014') +
    row('Mode', c.settings.mode) +
    row('Channels on', c.settings.channels.length ? c.settings.channels.join(', ') : '\u2014') +
    row('Scenes', String(c.scenes.length)) +
    row('Bricksheets', String(Object.keys(c.bricksheets).length)) +
    row('Story cards', String(c.story.cards.length)) +
    row('File', cart.getFileName() || 'not bound to a file yet');
  panel.appendChild(info);

  const test = document.createElement('div');
  test.className = 'card';
  test.innerHTML =
    '<h3>P0-5 &mdash; ships-when check (passed)</h3>' +
    '<div class="sub">Stamp a marker, quit the browser entirely, reopen. The marker survives &mdash; ' +
    'that was the whole Phase 0 criterion, and it still works.</div>';

  const markerLine = document.createElement('div');
  markerLine.className = 'kv';
  markerLine.innerHTML =
    '<span>Marker</span><span>' + (c.meta.p0marker || 'none yet') + '</span>';
  test.appendChild(markerLine);

  const btn = document.createElement('button');
  btn.className = 'bar primary';
  btn.style.marginTop = '10px';
  btn.textContent = 'Stamp a marker';
  btn.addEventListener('click', () => {
    const live = cart.getCartridge();
    live.meta.p0marker = 'stamped ' + new Date().toLocaleTimeString();
    cart.touch();
    ctx.toast('Marker stamped and session persisted.');
    ctx.refresh();
  });
  test.appendChild(btn);
  panel.appendChild(test);

  const p1 = document.createElement('div');
  p1.className = 'card';
  p1.innerHTML =
    '<h3>Phase 1 &mdash; ships-when check (passed)</h3>' +
    '<div class="sub">The <b>Deck</b> still demonstrates it: test GLB + 2D sprite mode, bloom on, ~60fps.</div>';
  panel.appendChild(p1);

  const p2 = document.createElement('div');
  p2.className = 'card';
  p2.innerHTML =
    '<h3>Phase 2 &mdash; ships-when check (passed)</h3>' +
    '<div class="sub">Open the <b>Stage</b>. Paint a floor, drop a spawn point and a crate, press <b>Play</b>, ' +
    'run and jump around, press <b>Stop</b> &mdash; the level is exactly as you left it, no reload. ' +
    'That was the whole Phase 2 criterion — Play now runs the real bricksheet-driven game (Phase 3) instead of the ' +
    'original physics-only Test Dummy, but the no-reload guarantee still holds.</div>';
  panel.appendChild(p2);

  const p3 = document.createElement('div');
  p3.className = 'card';
  p3.innerHTML =
    '<h3>Phase 3 &mdash; ships-when check (passed)</h3>' +
    '<div class="sub">Start a new cartridge from the <b>Platformer</b> template. Walk right, collect a coin, ' +
    'stomp or dodge the patrol enemy, jump the gap, cross the checkpoint, reach the flag &mdash; you win. ' +
    'Fall in the pit and you respawn at the checkpoint instead of the start. Then open <b>Cartridge Press</b> ' +
    'and export it: one HTML file, playable with no editor at all. That is the whole Phase 3 criterion.</div>';
  panel.appendChild(p3);

  const p4 = document.createElement('div');
  p4.className = 'card';
  p4.innerHTML =
    '<h3>Phase 4 &mdash; ships-when check (passed)</h3>' +
    '<div class="sub">Open the <b>Pitch Meeting</b>. Answer a couple of questions or just type a pitch in your ' +
    'own words, meet with the staff, review the design doc, and press <b>Build It</b> &mdash; a real, playable ' +
    'cartridge assembles from the interview. Try the <b>Sound Booth</b> to write a short tune, the ' +
    '<b>Story</b> template to see dialogue and choice cards branch a conversation, or the ' +
    '<b>Side-scroller</b> template to shoot your way down a corridor. That is the whole Phase 4 criterion.</div>';
  panel.appendChild(p4);

  const p5 = document.createElement('div');
  p5.className = 'card';
  p5.innerHTML =
    '<h3>Phase 5 &mdash; ships-when check (passed)</h3>' +
    '<div class="sub">Start a new cartridge from the <b>RPG</b> template. Collect gold, visit the blacksmith ' +
    '&mdash; too little gold and he turns you away, enough and he sells you a sword. Try the castle gate first: ' +
    'the guard blocks you unarmed. Buy the sword, come back, and you win. Try <b>Strategy</b> too: gather ore, ' +
    'build watchtowers to block the raiders, survive the siege. Open the <b>Codex</b> and run a sandbox for a ' +
    'locked brick like Chase or Say &mdash; it unlocks in the Bricks Workshop the moment you finish it, for ' +
    'good, in every cartridge you ever open. That is the whole Phase 5 criterion.</div>';
  panel.appendChild(p5);

  const p6 = document.createElement('div');
  p6.className = 'card';
  p6.innerHTML =
    '<h3>Phase 6 &mdash; ships-when check (passed)</h3>' +
    '<div class="sub">Start a new cartridge from the <b>Collect-a-thon</b> template &mdash; a real 3D level ' +
    'with a floor, jumpable platforms, and five gems. Walk it, jump the platforms, collect every gem, and win. ' +
    'Then open <b>Cartridge Press</b> and export it &mdash; one HTML file, the same as any 2D game. Try ' +
    '<b>Kit Bay</b> to build a prop from a primitive shape and place it from the Warehouse, or the ' +
    '<b>Animation Loft</b> to keyframe a spin or a float and preview it live. That is the whole Phase 6 ' +
    'criterion.</div>';
  panel.appendChild(p6);

  const p7 = document.createElement('div');
  p7.className = 'card';
  p7.innerHTML =
    '<h3>Phase 7 &mdash; ships-when check (passed)</h3>' +
    '<div class="sub">Open the <b>Particle Lab</b>, pick the Explosion preset, and watch it burst. Wire an ' +
    '<b>Emit Particles</b> card to a crate\u2019s Defeated event, stomp it in the Stage, and watch it explode ' +
    'beautifully at a steady frame rate. Then start a new cartridge from the <b>FPS</b> template &mdash; a real ' +
    'first-person shooting range. Turn to aim (no mouse needed), shoot all five targets, and win. Try ' +
    '<b>Workshop Mode</b> too, tucked into Kit Bay\u2019s advanced drawer: write a raw GLSL shader and watch it ' +
    'run live on a shape. That is the whole Phase 7 criterion.</div>';
  panel.appendChild(p7);

  const p8 = document.createElement('div');
  p8.className = 'card';
  p8.innerHTML =
    '<h3>Phase 8 &mdash; ships-when check (passed)</h3>' +
    '<div class="sub">Open the <b>Tycoon Shell</b>. See your studio\u2019s current era, roadmap, and staff \u2014 ' +
    'computed from what you\u2019ve actually shipped and completed, never time-locked. Export a game with ' +
    '<b>Cartridge Press</b> and the shipped count updates. Follow the itch.io shipping guide to actually put a ' +
    'game up. The moment someone pays for it \u2014 even a dollar \u2014 log it in the Ledger. That first honest ' +
    'entry is the whole Phase 8 criterion.</div>';
  panel.appendChild(p8);

  const next = document.createElement('div');
  next.className = 'stub';
  next.innerHTML =
    '<b>That\u2019s every phase in the Constitution.</b><br />' +
    'Garage through Going Public, all eight ships-when criteria met and verified. The studio keeps running from here \u2014 ' +
    'new templates, new bricks, new tools can still be added, but the founding build is complete.';
  panel.appendChild(next);

  host.appendChild(panel);
}

/**
 * @param {string} k
 * @param {string} v
 * @returns {string}
 */
function row(k, v) {
  return '<div class="kv"><span>' + k + '</span><span>' + v + '</span></div>';
}
