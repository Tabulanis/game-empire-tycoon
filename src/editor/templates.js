/**
 * @file templates.js
 * @description Loads a genre template (manifest + starter scene + brick
 * presets — Constitution Article VI) and populates a fresh cartridge from
 * it. Generic over any template id; see src/data/templates/ for the full
 * roster (8 as of this writing) and AVAILABLE_TEMPLATES in pitch-panel.js
 * for which ones the Pitch Meeting can currently recommend.
 * Ticket P3-10. Phase 3.
 */

/**
 * @param {string} templateId  e.g. 'platformer'
 * @returns {Promise<any>} the manifest, with `starter` and `brickPresets` resolved into actual data
 */
export async function loadTemplate(templateId) {
  const base = new URL('../data/templates/' + templateId + '/', import.meta.url);
  const manifest = await (await fetch(new URL('manifest.json', base))).json();
  const starterScene = await (await fetch(new URL(manifest.starter, base))).json();
  const brickPresets = {};
  for (const presetId of manifest.brickPresets) {
    const res = await fetch(new URL('brickPresets/' + presetId + '.json', base));
    brickPresets[presetId] = await res.json();
  }
  let storyCards = null;
  if (manifest.story) {
    const res = await fetch(new URL(manifest.story, base));
    storyCards = await res.json();
  }
  let prefabs = null;
  if (manifest.prefabs) {
    const res = await fetch(new URL(manifest.prefabs, base));
    prefabs = await res.json();
  }
  return { manifest, starterScene, brickPresets, storyCards, prefabs };
}

/**
 * Apply a loaded template onto a fresh cartridge: sets era/mode/perspective
 * metadata, replaces the (empty) scene list with the starter scene, copies
 * every brick preset into cartridge.bricksheets keyed by its preset name,
 * merges any input mappings the template needs, and seeds story cards and
 * prefabs if present.
 * @param {any} cartridge  freshly created (createCartridge) — mutated in place
 * @param {any} loaded  the return value of loadTemplate
 */
export function applyTemplate(cartridge, loaded) {
  const { manifest, starterScene, brickPresets, storyCards, prefabs } = loaded;
  cartridge.meta.template = manifest.id;
  cartridge.meta.era = manifest.era;
  cartridge.settings.mode = manifest.tags.includes('2d') ? '2d' : '3d';
  cartridge.settings.perspective = manifest.perspective || 'side';
  cartridge.settings.controlScheme = manifest.controlScheme || 'strafe';
  if (manifest.input) {
    cartridge.settings.input = { ...cartridge.settings.input, ...manifest.input };
  }
  cartridge.scenes = [JSON.parse(JSON.stringify(starterScene))];
  for (const [presetId, cards] of Object.entries(brickPresets)) {
    cartridge.bricksheets[presetId] = JSON.parse(JSON.stringify(cards));
  }
  if (storyCards) {
    cartridge.story.cards = JSON.parse(JSON.stringify(storyCards));
  }
  if (prefabs) {
    for (const [slug, def] of Object.entries(prefabs)) {
      cartridge.prefabs[slug] = JSON.parse(JSON.stringify(def));
    }
  }
}
