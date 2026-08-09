/**
 * @file game-hud.js
 * @description What the game tells the player while they play: the goal, how
 * far along they are, how much health is left, and anything a Say brick has to
 * say. Mounted by whoever is running the game — the Stage's play session and
 * the exported cartridge both — the same way touch-controls is, so a game
 * behaves identically in the editor and on the shelf.
 *
 * Everything here is DERIVED, never authored twice. The objective comes from
 * the win condition already sitting in the bricksheets: a WHEN counter-reached
 * card whose DO ends the game with a win tells us both which counter matters
 * and what it has to reach. So a game the player builds themselves gets a goal
 * readout for free, without anyone filling in a second field that could
 * disagree with the rules.
 */

/* The HUD carries its own styles. The Cartridge Press ships one game as one
   HTML file and never includes the editor's stylesheet, so anything that
   relies on styles.css is invisible in an exported game -- which is exactly
   what has happened to the touch controls. Injected once per document. */
const HUD_CSS = `
/* ---- in-game HUD: goal, health, and what the game says to you ---- */
/* Sits above the scene but below the touch pads, and never eats a click
   except on the dialogue band itself — the game underneath stays playable. */
.game-hud {
  position: absolute; inset: 0; z-index: 3;
  pointer-events: none; user-select: none; -webkit-user-select: none;
  font-family: inherit;
}
.hud-goal {
  position: absolute; top: 12px; left: 12px;
  padding: 6px 12px; border-radius: 999px;
  background: rgba(12,15,22,0.72); border: 1px solid rgba(255,255,255,0.16);
  color: #eef2ff; font-size: 15px; font-weight: 600; letter-spacing: 0.02em;
}
.hud-goal-done { background: rgba(46,140,86,0.85); border-color: rgba(140,255,190,0.5); }
.hud-hearts {
  position: absolute; top: 12px; right: 12px;
  padding: 6px 12px; border-radius: 999px;
  background: rgba(12,15,22,0.72); border: 1px solid rgba(255,255,255,0.16);
  color: #ff8a8a; font-size: 17px; letter-spacing: 2px;
}
.hud-hurt { color: #ff5252; animation: hud-pulse 0.9s ease-in-out infinite; }
@keyframes hud-pulse { 50% { opacity: 0.45; } }

.hud-say {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 14px 18px calc(14px + env(safe-area-inset-bottom));
  background: linear-gradient(to top, rgba(8,10,16,0.94), rgba(8,10,16,0.72));
  border-top: 1px solid rgba(255,255,255,0.14);
  pointer-events: auto; cursor: pointer;
}
.hud-say-who { color: #ffd47a; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.hud-say-line { color: #f2f5ff; font-size: 17px; line-height: 1.45; margin-top: 3px; max-width: 70ch; }
.hud-say-more { color: rgba(235,240,255,0.45); font-size: 12px; margin-top: 6px; }
.hud-say-choices { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.hud-choice {
  pointer-events: auto; cursor: pointer;
  padding: 9px 16px; min-height: 40px; border-radius: 8px;
  background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.28);
  color: #fff; font-size: 15px;
}
.hud-choice:hover { background: rgba(255,255,255,0.18); }

/* phones: smaller chips so they do not crowd a short screen */
@media (max-width: 640px) {
  .hud-goal, .hud-hearts { font-size: 13px; padding: 5px 10px; }
  .hud-say-line { font-size: 16px; }
}
`;

function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('get-hud-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'get-hud-styles';
  tag.textContent = HUD_CSS;
  document.head.appendChild(tag);
}

/**
 * Find the counter the game is won by, if there is one.
 * @param {any} cartridge
 * @returns {{key: string, target: number, label: string}|null}
 */
function findObjective(cartridge) {
  const sheets = (cartridge && cartridge.bricksheets) || {};
  for (const cards of Object.values(sheets)) {
    if (!Array.isArray(cards)) continue;
    for (const card of cards) {
      if (card.when !== 'counter-reached' || !card.key) continue;
      const winsHere = (card.do || []).some(
        (a) => a.do === 'end-game' && a.result === 'win'
      );
      if (!winsHere || typeof card.value !== 'number') continue;
      return { key: card.key, target: card.value, label: prettyKey(card.key) };
    }
  }
  return null;
}

/** counter keys are machine names; show them as words. */
function prettyKey(key) {
  const s = String(key).replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * @param {HTMLElement} container  positioned element covering the game view
 * @param {any} cartridge
 * @param {any} scene  the live scene (health is read off it each frame)
 * @returns {{update: (runtime: any, result: any) => void, dispose: () => void}}
 */
export function createGameHud(container, cartridge, scene) {
  ensureStyles();
  const objective = findObjective(cartridge);
  const player = (scene.entities || []).find(
    (e) => Array.isArray(e.components.tags) && e.components.tags.includes('player')
  );

  const layer = document.createElement('div');
  layer.className = 'game-hud';

  const goalChip = document.createElement('div');
  goalChip.className = 'hud-goal';
  goalChip.hidden = !objective;
  layer.appendChild(goalChip);

  const hearts = document.createElement('div');
  hearts.className = 'hud-hearts';
  hearts.hidden = !(player && player.components.health);
  layer.appendChild(hearts);

  // The dialogue band sits at the bottom, out of the way of the action, and
  // takes the whole width so a long line never wraps into a wall.
  const band = document.createElement('div');
  band.className = 'hud-say';
  band.hidden = true;
  const who = document.createElement('div');
  who.className = 'hud-say-who';
  const line = document.createElement('div');
  line.className = 'hud-say-line';
  const more = document.createElement('div');
  more.className = 'hud-say-more';
  more.textContent = 'tap or press Space';
  band.append(who, line, more);
  layer.appendChild(band);

  /** choice buttons are rebuilt whenever the card changes */
  const choices = document.createElement('div');
  choices.className = 'hud-say-choices';
  band.appendChild(choices);

  container.appendChild(layer);

  let liveRuntime = null;
  let shownCardId = null;

  const advance = () => {
    if (band.hidden || !liveRuntime) return;
    // a card with buttons waits for a button, not a tap-through
    if (choices.childElementCount) return;
    liveRuntime.advanceDialogue();
  };
  const onKey = (e) => {
    if (e.code === 'Space' || e.code === 'Enter') { advance(); e.preventDefault(); }
  };
  band.addEventListener('pointerdown', advance);
  window.addEventListener('keydown', onKey);

  let lastHp = null, lastCount = null;

  return {
    /**
     * @param {any} runtime  the play session (for saveState + advanceDialogue)
     * @param {any} result   whatever tick() returned this frame
     */
    update(runtime, result) {
      liveRuntime = runtime;

      if (objective) {
        const counters = (runtime.saveState && runtime.saveState.counters) || {};
        const have = counters[objective.key] || 0;
        if (have !== lastCount) {
          lastCount = have;
          goalChip.textContent = objective.label + ' ' + have + ' / ' + objective.target;
          goalChip.classList.toggle('hud-goal-done', have >= objective.target);
        }
      }

      if (player && player.components.health) {
        const hp = player.components.health.current;
        if (hp !== lastHp) {
          lastHp = hp;
          const max = player.components.health.max || hp;
          hearts.textContent = '♥'.repeat(Math.max(0, hp)) +
            '♡'.repeat(Math.max(0, max - hp));
          hearts.classList.toggle('hud-hurt', hp <= 1);
        }
      }

      const say = result && result.dialogue;
      if (say) {
        band.hidden = false;
        who.textContent = say.speaker || '';
        who.hidden = !say.speaker;
        line.textContent = say.text || '';
        // currentCardView hands back no id, so the text is the identity —
        // enough to know when to rebuild the buttons. choices are plain
        // label strings, not objects.
        if (say.text !== shownCardId) {
          shownCardId = say.text;
          choices.innerHTML = '';
          (say.choices || []).forEach((label, i) => {
            const b = document.createElement('button');
            b.className = 'hud-choice';
            b.textContent = label;
            b.addEventListener('click', (e) => {
              e.stopPropagation();
              liveRuntime.chooseDialogue(i);
            });
            choices.appendChild(b);
          });
          more.hidden = choices.childElementCount > 0;
        }
      } else if (!band.hidden) {
        band.hidden = true;
        shownCardId = null;
        choices.innerHTML = '';
      }
    },

    dispose() {
      window.removeEventListener('keydown', onKey);
      layer.remove();
    }
  };
}
