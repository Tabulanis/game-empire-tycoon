/**
 * @file entities.js
 * @description ECS-lite (Constitution Article VI): entities are plain objects,
 * components are plain data, systems are functions. This module owns the
 * entity/scene/prefab DATA operations only — no rendering, no DOM, no physics.
 * Ticket P2-1. Phase 2.
 */

/* ------------------------------------------------------------------ */
/* component registry                                                  */
/* ------------------------------------------------------------------ */

/**
 * The curated component vocabulary. Finite by design (Constitution Art. I):
 * new component types are catalog amendments, not ad-hoc keys.
 * `defaults()` returns a fresh component value; `label` is editor-facing.
 * @type {Record<string, {label: string, defaults: () => any}>}
 */
export const COMPONENT_TYPES = {
  transform: {
    label: 'Transform',
    defaults: () => ({ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] })
  },
  sprite: {
    label: 'Sprite',
    // asset paths arrive with real warehouse packs; until then swatch + glyph
    // draw the placeholder card the P0 warehouse established.
    defaults: () => ({ asset: null, swatch: '#6fb2dc', glyph: '', frame: 0, size: [1, 1] })
  },
  model: {
    label: 'Model',
    defaults: () => ({ asset: null, shape: 'box', swatch: '#6fb2dc', size: [1, 1, 1], shader: null })
  },
  anim: {
    label: 'Animation',
    defaults: () => ({ kind: 'bob', clip: null, speed: 1, amount: 0.25, playing: true })
  },
  body: {
    label: 'Body',
    // shape is 'box' only in P2 — the curated list grows by amendment.
    defaults: () => ({ type: 'static', shape: 'box', size: [1, 1] })
  },
  tilemap: {
    label: 'Tilemap',
    // sparse map: "x,y" cell keys -> {item, swatch}. cell = world units per tile.
    defaults: () => ({ cell: 1, tiles: {} })
  },
  logic: {
    label: 'Logic',
    // kind: trigger | spawn | checkpoint | kill. Zones (trigger/kill) use size;
    // points (spawn/checkpoint) are position-only. Visible in edit, not in play.
    defaults: () => ({ kind: 'trigger', size: [2, 2] })
  },
  tags: {
    label: 'Tags',
    defaults: () => []
  },
  health: {
    label: 'Health',
    // per-entity vitality (player, enemies). Global counters (coins, flags)
    // live in the save vault instead — see runtime.js / score.js.
    defaults: () => ({ max: 3, current: 3 })
  },
  bricks: {
    label: 'Bricks',
    // points at a bricksheet: cartridge.bricksheets[sheet] is an ordered
    // array of {when, by, if, do} cards (Constitution Article VI).
    defaults: () => ({ sheet: null })
  }
};

/** Editor colors for logic kinds — used by the Stage's zone visuals. */
export const LOGIC_COLORS = {
  trigger: '#6fd3ff',
  spawn: '#67e39b',
  checkpoint: '#f0c463',
  kill: '#ff6b8b'
};

/* ------------------------------------------------------------------ */
/* entities                                                            */
/* ------------------------------------------------------------------ */

/**
 * Deep-clone plain JSON data (entities, scenes, prefabs are all JSON-safe).
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepClone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Derive a unique entity id inside a scene from a base name. Deterministic
 * counter scan — no randomness, so ids never depend on RNG state.
 * @param {{entities: Array<any>}} scene
 * @param {string} base
 * @returns {string}
 */
export function uniqueId(scene, base) {
  const slug = String(base || 'entity').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'entity';
  const taken = new Set(scene.entities.map((e) => e.id));
  if (!taken.has(slug)) return slug;
  let n = 2;
  while (taken.has(slug + '-' + n)) n++;
  return slug + '-' + n;
}

/**
 * Build a full entity object. Components listed get their registry defaults
 * merged under any provided values; transform is always present.
 * @param {{name?: string, prefab?: string|null, components?: Record<string, any>}} [spec]
 * @returns {any} entity (id is assigned by addEntity, not here)
 */
export function createEntity(spec = {}) {
  const components = {};
  const wanted = { transform: {}, ...(spec.components || {}) };
  for (const [key, value] of Object.entries(wanted)) {
    const def = COMPONENT_TYPES[key];
    if (!def) continue; // unknown component types never enter the data
    const base = def.defaults();
    components[key] = Array.isArray(base)
      ? (Array.isArray(value) ? deepClone(value) : base)
      : { ...base, ...deepClone(value || {}) };
  }
  return {
    id: '',
    name: spec.name || 'Entity',
    prefab: spec.prefab || null,
    components
  };
}

/**
 * Add an entity to a scene, assigning its unique id from its name.
 * @param {{entities: Array<any>}} scene
 * @param {any} entity
 * @returns {any} the same entity, id assigned
 */
export function addEntity(scene, entity) {
  entity.id = uniqueId(scene, entity.name);
  scene.entities.push(entity);
  return entity;
}

/**
 * @param {{entities: Array<any>}} scene
 * @param {string} id
 * @returns {boolean} true when something was removed
 */
export function removeEntity(scene, id) {
  const i = scene.entities.findIndex((e) => e.id === id);
  if (i === -1) return false;
  scene.entities.splice(i, 1);
  return true;
}

/**
 * @param {{entities: Array<any>}} scene
 * @param {string} id
 * @returns {any|null}
 */
export function findEntity(scene, id) {
  return scene.entities.find((e) => e.id === id) || null;
}

/* ------------------------------------------------------------------ */
/* scenes — the cartridge scene list, live as of P2-1                  */
/* ------------------------------------------------------------------ */

/**
 * @param {string} id
 * @returns {{id: string, entities: Array<any>}}
 */
export function createScene(id) {
  return { id, entities: [] };
}

/**
 * @param {any} cartridge
 * @param {string} id
 * @returns {{id: string, entities: Array<any>}|null}
 */
export function getScene(cartridge, id) {
  return cartridge.scenes.find((s) => s.id === id) || null;
}

/**
 * Guarantee the cartridge has at least one scene and return the first.
 * @param {any} cartridge
 * @returns {{id: string, entities: Array<any>}}
 */
export function ensureFirstScene(cartridge) {
  if (!cartridge.scenes.length) cartridge.scenes.push(createScene('level1'));
  return cartridge.scenes[0];
}

/**
 * Add a new scene with a unique level id.
 * @param {any} cartridge
 * @returns {{id: string, entities: Array<any>}}
 */
export function addScene(cartridge) {
  const taken = new Set(cartridge.scenes.map((s) => s.id));
  let n = cartridge.scenes.length + 1;
  while (taken.has('level' + n)) n++;
  const scene = createScene('level' + n);
  cartridge.scenes.push(scene);
  return scene;
}

/* ------------------------------------------------------------------ */
/* warehouse -> entity mapping (P2-4 consumes the P0 drag contract)    */
/* ------------------------------------------------------------------ */

/**
 * Turn a warehouse drag payload into an entity spec. Tile-kind items do NOT
 * become entities — they become the paint brush (the Stage handles that).
 * @param {{itemId: string, kind: string, name: string}} payload
 * @param {{swatch?: string}} [item] full warehouse item, when available
 * @param {'2d'|'3d'} mode
 * @returns {any|null} entity (no id yet) or null when the kind isn't placeable
 */
export function entityFromWarehouseItem(payload, item, mode) {
  const swatch = (item && item.swatch) || '#6fb2dc';
  const asset = payload.assetId || null;
  switch (payload.kind) {
    case 'sprite':
      return createEntity({
        name: payload.name,
        prefab: payload.itemId,
        components: { sprite: { swatch, asset }, tags: [] }
      });
    case 'charmodel':
      // a rigged character saved from the Animate room — model component
      // carries the asset id; meshes.js loads/clones/animates it
      return createEntity({
        name: payload.name,
        prefab: payload.itemId,
        components: {
          model: { asset: payload.assetId, height: 1.2 },
          body: { type: 'dynamic', size: [0.6, 1.2] },
          tags: []
        }
      });
    case 'character':
      return createEntity({
        name: payload.name,
        prefab: payload.itemId,
        components: {
          sprite: { swatch, asset, size: [0.8, 1.2] },
          body: { type: 'dynamic', size: [0.8, 1.2] },
          tags: []
        }
      });
    case 'model':
      return createEntity({
        name: payload.name,
        prefab: payload.itemId,
        components: mode === '2d'
          ? { sprite: { swatch, asset }, body: { type: 'static', size: [1, 1] }, tags: [] }
          : { model: { swatch }, tags: [] }
      });
    default:
      return null; // tiles are brushes; sfx has no world placement — it's referenced by a "play sfx" brick instead
  }
}

/**
 * Build one of the P2-6 logic entities.
 * @param {'trigger'|'spawn'|'checkpoint'|'kill'} kind
 * @returns {any} entity (no id yet)
 */
export function createLogicEntity(kind) {
  const isZone = kind === 'trigger' || kind === 'kill';
  return createEntity({
    name: kind,
    components: { logic: { kind, size: isZone ? [2, 2] : [0.6, 0.6] } }
  });
}

/* ------------------------------------------------------------------ */
/* prefabs (P2-4) — cartridge.prefabs, Constitution amendment pending  */
/* ------------------------------------------------------------------ */

/**
 * Save an entity as a reusable prefab on the cartridge.
 * @param {any} cartridge
 * @param {any} entity
 * @param {string} name
 * @returns {string} the prefab id
 */
export function saveAsPrefab(cartridge, entity, name) {
  const slug = String(name || entity.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'prefab';
  let id = slug, n = 2;
  while (cartridge.prefabs[id]) { id = slug + '-' + n; n++; }
  const def = deepClone(entity);
  delete def.id; // prefab definitions carry no instance id
  def.name = name || entity.name;
  cartridge.prefabs[id] = def;
  return id;
}

/**
 * Instantiate a prefab into a scene at a position.
 * @param {any} cartridge
 * @param {string} prefabId
 * @param {{entities: Array<any>}} scene
 * @param {[number, number, number]} [position]
 * @returns {any|null} the placed entity
 */
export function instantiatePrefab(cartridge, prefabId, scene, position) {
  const def = cartridge.prefabs[prefabId];
  if (!def) return null;
  const entity = deepClone(def);
  entity.prefab = prefabId;
  if (!entity.components) entity.components = {};
  if (!entity.components.transform) entity.components.transform = COMPONENT_TYPES.transform.defaults();
  if (position) entity.components.transform.p = [...position];
  return addEntity(scene, entity);
}
