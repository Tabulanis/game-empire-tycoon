/**
 * @file codex.js
 * @description The Codex: browsing every brick's explainer, the Gate Rule
 * (advanced features unlock when their sandbox is completed once — the
 * tutorial IS the lock, per Constitution Article X), and generating the
 * actual playable sandbox scenes gated bricks unlock through. Progress
 * persists in localStorage — understanding belongs to the AUTHOR, not any
 * one cartridge, so it survives across every game they ever open.
 * Ticket P5-7. Phase 5.
 */

import { loadBrickCatalog, loadCodexCatalog, findBrick } from './bricks.js';

const PROGRESS_KEY = 'get.codex.v1';

/**
 * The curated "advanced" subset that's actually gated — Article X says
 * "advanced knobs", not literally every brick; gating touched/award-points
 * would make First Blood impossible for a brand new author. Everything NOT
 * in this list is available immediately. Roughly: steering AI, anything
 * that spawns/removes entities outside the obvious coin/enemy pattern,
 * combat status effects, camera/time effects, zone locking, music, and the
 * story-branching bricks.
 */
export const GATED_BRICKS = new Set([
  'chase', 'flee', 'wander', 'path-to',
  'spawn-prefab', 'explode', 'invincible', 'knockback',
  'shake-camera', 'slow-time', 'flash-channel',
  'lock-zone', 'unlock-zone', 'play-song',
  'say', 'show-choice-card', 'set-story-flag', 'story-flag-set', 'story-card-reached'
]);

/** @returns {Set<string>} brick ids whose sandbox has been completed */
function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (err) {
    return new Set();
  }
}

/** @param {Set<string>} progress */
function saveProgress(progress) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...progress]));
  } catch (err) {
    /* best-effort — a full or unavailable localStorage never blocks the app */
  }
}

/**
 * @param {string} brickId
 * @returns {boolean} true when this brick is available to use right now —
 *   either it was never gated, or its sandbox has been completed
 */
export function isUnlocked(brickId) {
  if (!GATED_BRICKS.has(brickId)) return true;
  return loadProgress().has(brickId);
}

/**
 * Mark a brick's sandbox as completed — the one and only way a gated brick
 * becomes usable. Idempotent.
 * @param {string} brickId
 */
export function markCompleted(brickId) {
  const progress = loadProgress();
  progress.add(brickId);
  saveProgress(progress);
}

/** @returns {Array<string>} every gated brick id completed so far */
export function completedList() {
  return [...loadProgress()].filter((id) => GATED_BRICKS.has(id));
}

/* ------------------------------------------------------------------ */
/* sandbox generation — a real, playable scene per gated brick          */
/* ------------------------------------------------------------------ */

/**
 * Build a minimal cartridge that demonstrates ONE brick in isolation — "a
 * preset scene where the concept is the only variable" (Article X). Runs
 * through the exact same engine/runtime.js every real game uses; there is
 * no separate "tutorial engine".
 * @param {string} brickId
 * @param {any} brickDef  the catalog definition (for default params)
 * @returns {any} a cartridge, ready for startRuntime
 */
export function buildSandboxCartridge(brickId, brickDef) {
  const base = {
    get: 1, meta: { title: 'Sandbox: ' + brickDef.label },
    settings: { mode: '2d', perspective: 'top', channels: [], input: { jump: ['Space'] } },
    assets: { sprites: [], sfx: [], songs: [] }, prefabs: {},
    bricksheets: {}, saveSchema: {}, story: { cards: [] },
    scenes: [{ id: 'sandbox', entities: [] }]
  };
  const entities = base.scenes[0].entities;
  const player = (p) => ({
    id: 'player', name: 'Player', prefab: null,
    components: { transform: { p, r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#6fd3ff', size: [0.6, 0.6] }, health: { max: 3, current: 3 }, tags: ['player'] }
  });
  const mover = (id, p, sheet, tags) => ({
    id, name: id, prefab: null,
    components: { transform: { p, r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#f0c463', size: [0.5, 0.5] }, body: { type: 'kinematic', size: [0.5, 0.5] }, bricks: { sheet }, ...(tags ? { tags } : {}) }
  });

  switch (brickId) {
    case 'chase':
    case 'flee':
      entities.push(player([4, 0, 0]));
      entities.push(mover('demo', [0, 0, 0], 'demo-sheet'));
      base.bricksheets['demo-sheet'] = [{ when: 'spawned', if: [], do: [{ do: brickId, target: 'player', speed: 2 }] }];
      break;
    case 'wander':
      entities.push(mover('demo', [0, 0, 0], 'demo-sheet'));
      base.bricksheets['demo-sheet'] = [{ when: 'spawned', if: [], do: [{ do: 'wander', speed: 2 }] }];
      break;
    case 'path-to':
      entities.push(player([0, 0, 0]));
      entities.push(mover('demo', [-4, -3, 0], 'demo-sheet'));
      for (let y = -2; y <= 1; y++) {
        entities.push({ id: 'wall-' + y, name: 'Wall', prefab: null, components: { transform: { p: [0, y, 0], r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#3b4a63' }, body: { type: 'static', size: [1, 1] } } });
      }
      base.bricksheets['demo-sheet'] = [{ when: 'spawned', if: [], do: [{ do: 'path-to', x: 4, y: -3, speed: 2 }] }];
      break;
    case 'spawn-prefab':
      base.prefabs.dot = { name: 'Dot', components: { transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#67e39b', size: [0.3, 0.3] } } };
      entities.push({ id: 'spawner', name: 'Spawner', prefab: null, components: { transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, bricks: { sheet: 'demo-sheet' } } });
      base.bricksheets['demo-sheet'] = [{ when: 'every-n-seconds', seconds: 1, if: [], do: [{ do: 'spawn-prefab', prefab: 'dot', at: [0, 0] }] }];
      break;
    case 'explode':
      entities.push(mover('victim1', [-1.5, 0, 0], null));
      entities[entities.length - 1].components.health = { max: 3, current: 3 };
      entities.push(mover('victim2', [1.5, 0, 0], null));
      entities[entities.length - 1].components.health = { max: 3, current: 3 };
      entities.push({ id: 'bomb', name: 'Bomb', prefab: null, components: { transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#ff6b8b' }, bricks: { sheet: 'demo-sheet' } } });
      base.bricksheets['demo-sheet'] = [{ when: 'every-n-seconds', seconds: 2, if: [], do: [{ do: 'explode', radius: 3, damage: 1 }] }];
      break;
    case 'invincible':
    case 'knockback':
      entities.push(player([0, 0, 0]));
      entities.push({ id: 'source', name: 'Source', prefab: null, components: { transform: { p: [-2, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#ff6b8b' }, bricks: { sheet: 'demo-sheet' } } });
      base.bricksheets['demo-sheet'] = [{ when: 'every-n-seconds', seconds: 2, if: [], do: [{ do: brickId, target: 'other', ...(brickId === 'invincible' ? { seconds: 1 } : { vx: 3, vy: 3 }) }] }];
      break;
    case 'shake-camera':
    case 'slow-time':
    case 'flash-channel':
      entities.push(player([0, 0, 0]));
      entities.push({ id: 'trigger', name: 'Trigger', prefab: null, components: { transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, bricks: { sheet: 'demo-sheet' } } });
      base.bricksheets['demo-sheet'] = [{ when: 'every-n-seconds', seconds: 2, if: [], do: [{ do: brickId, ...(brickDef.params.reduce((a, p) => ({ ...a, [p.name]: p.default }), {})) }] }];
      break;
    case 'lock-zone':
    case 'unlock-zone':
      entities.push(player([0, 0, 0]));
      entities.push({ id: 'zone1', name: 'Zone', prefab: null, components: { transform: { p: [3, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#6fd3ff' }, logic: { kind: 'trigger', size: [2, 2] }, bricks: { sheet: 'zone-sheet' } } });
      entities.push({ id: 'toggler', name: 'Toggler', prefab: null, components: { transform: { p: [0, 3, 0], r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#f0c463' }, bricks: { sheet: 'demo-sheet' } } });
      base.bricksheets['zone-sheet'] = [{ when: 'player-enters-zone', if: [], do: [{ do: 'say', card: 'entered' }] }];
      base.bricksheets['demo-sheet'] = [{ when: 'touched', if: [], do: [{ do: brickId, zone: 'zone1' }] }];
      base.story.cards.push({ id: 'entered', speaker: 'Zone', text: 'You entered the zone!', next: null });
      break;
    case 'play-song':
      entities.push({ id: 'jukebox', name: 'Jukebox', prefab: null, components: { transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#8a6bd6' }, bricks: { sheet: 'demo-sheet' } } });
      base.assets.songs.push({ id: 'demo-song', name: 'Demo', bpm: 120, channelVoices: ['pulse', 'tri', 'saw', 'noise'], patterns: { p1: { steps: 8, channels: [['C4', null, 'E4', null, 'G4', null, 'E4', null], [], [], []] } }, chain: ['p1'], sampleSlots: [null, null, null, null] });
      base.bricksheets['demo-sheet'] = [{ when: 'game-start', if: [], do: [{ do: 'play-song', song: 'demo-song' }] }];
      break;
    case 'say':
    case 'show-choice-card':
      entities.push(player([-3, 0, 0]));
      entities.push({ id: 'npc', name: 'NPC', prefab: null, components: { transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#c7d0de' }, bricks: { sheet: 'demo-sheet' } } });
      base.bricksheets['demo-sheet'] = [{ when: 'touched', if: [], do: [{ do: brickId, card: 'greeting' }] }];
      base.story.cards.push(brickId === 'say'
        ? { id: 'greeting', speaker: 'NPC', text: 'Hello there!', next: null }
        : { id: 'greeting', speaker: 'NPC', text: 'Pick one:', choices: [{ label: 'Wave back', next: null }, { label: 'Walk away', next: null }] });
      break;
    case 'set-story-flag':
    case 'story-flag-set':
      entities.push(player([-3, 0, 0]));
      entities.push({ id: 'switch1', name: 'Switch', prefab: null, components: { transform: { p: [0, -2, 0], r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#f0c463' }, bricks: { sheet: 'switch-sheet' } } });
      entities.push({ id: 'gate1', name: 'Gate', prefab: null, components: { transform: { p: [0, 2, 0], r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#8a6bd6' }, bricks: { sheet: 'gate-sheet' } } });
      base.bricksheets['switch-sheet'] = [{ when: 'touched', if: [], do: [{ do: 'set-story-flag', flag: 'demo-flag', value: true }, { do: 'say', card: 'flag-set' }] }];
      base.bricksheets['gate-sheet'] = [{ when: 'touched', if: [{ check: 'story-flag-set', flag: 'demo-flag', value: true }], do: [{ do: 'say', card: 'gate-open' }] }];
      base.story.cards.push({ id: 'flag-set', speaker: 'Switch', text: 'Flag set!', next: null });
      base.story.cards.push({ id: 'gate-open', speaker: 'Gate', text: 'The flag is set — I open.', next: null });
      break;
    case 'story-card-reached':
      entities.push(player([-3, 0, 0]));
      entities.push({ id: 'narrator', name: 'Narrator', prefab: null, components: { transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#c7d0de' }, bricks: { sheet: 'demo-sheet' } } });
      base.bricksheets['demo-sheet'] = [
        { when: 'touched', if: [], do: [{ do: 'say', card: 'beat-one' }] },
        { when: 'story-card-reached', card: 'beat-one', if: [], do: [{ do: 'award-points', key: 'reached', amount: 1 }] }
      ];
      base.story.cards.push({ id: 'beat-one', speaker: 'Narrator', text: 'This is the card the WHEN is watching for.', next: null });
      base.saveSchema.reached = 0;
      break;
    default:
      // fallback: a plain do-card on game-start with default params — always
      // something to observe, even for a brick this generator doesn't have
      // a bespoke setup for yet.
      entities.push({ id: 'demo', name: 'Demo', prefab: null, components: { transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, sprite: { swatch: '#f0c463' }, bricks: { sheet: 'demo-sheet' } } });
      base.bricksheets['demo-sheet'] = [{ when: 'game-start', if: [], do: [{ do: brickId, ...(brickDef.params.reduce((a, p) => ({ ...a, [p.name]: p.default }), {})) }] }];
  }
  return base;
}
