/**
 * @file about-panel.js
 * @description About tab: the Five Laws, current phase, and the do-not-build
 * list, kept visible so drift is uncomfortable.
 * Phase 0.
 */

/**
 * @param {HTMLElement} host
 */
export function renderAboutPanel(host) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>About</h2>' +
    '<div class="sub">Game Empire Tycoon &mdash; a game that builds a game company. ' +
    'Standalone, offline, finite. No AI, no cloud, no accounts.</div>' +
    '<div class="card"><h3>The Five Laws</h3>' +
    '<div class="kv"><span>1</span><span>Everything is data.</span></div>' +
    '<div class="kv"><span>2</span><span>One renderer.</span></div>' +
    '<div class="kv"><span>3</span><span>We can only do what we understand to do.</span></div>' +
    '<div class="kv"><span>4</span><span>Complete in the box.</span></div>' +
    '<div class="kv"><span>5</span><span>Ship small, ship real.</span></div></div>' +
    '<div class="card"><h3>Current phase</h3>' +
    '<div class="kv"><span>Phase 0 (shipped)</span><span>Shell &mdash; cartridge survives a browser restart</span></div>' +
    '<div class="kv"><span>Phase 1</span><span>Light &amp; Deck</span></div>' +
    '<div class="kv"><span>Ships when</span><span>a GLB and a sprite render with bloom at 60fps, deck open</span></div></div>' +
    '<div class="stub">Full law lives in <b>docs/CONSTITUTION.md</b>. ' +
    'Amend it deliberately or not at all.</div>';
  host.appendChild(panel);
}
