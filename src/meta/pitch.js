/**
 * @file pitch.js
 * @description The Pitch Meeting: a structured interview plus an optional
 * free-text pitch, deterministic keyword matching (Constitution Article
 * VIII), a tag-overlap scorer that picks the best-fitting template, and a
 * design-doc summary for the confirmation screen every pitch ends on.
 * Never fails, never guesses silently — an unmatched pitch just means
 * fewer tag hits, not an error.
 * Ticket P4-6. Phase 4.
 */

/** Perspective axis values don't literally match template tag strings (a
 * template says "side-view", the taxonomy axis says "side") — this is the
 * one translation the scorer needs. Only "side" has a real template today;
 * the others are honestly reported as "not available yet" on the design doc. */
const PERSPECTIVE_TAG_ALIAS = {
  side: 'side-view', top: 'top-down', first: 'first-person', iso: 'isometric'
};

let tagsDataCache = null;

/**
 * @returns {Promise<any>} src/data/tags.json — {axes, keywords}
 */
export async function loadTagsData() {
  if (tagsDataCache) return tagsDataCache;
  const res = await fetch(new URL('../data/tags.json', import.meta.url));
  tagsDataCache = await res.json();
  return tagsDataCache;
}

/**
 * Scan free text for keyword hits (Article VIII's keyword table), case-
 * insensitive whole-word matching. Never throws, never partially-matches
 * silently — a keyword with no hit just contributes nothing.
 * @param {string} text
 * @param {any} tagsData  loadTagsData()'s return value
 * @returns {string[]} axis:value hits, e.g. ["hero:dragon", "goal:deliver"]
 */
export function parsePitchText(text, tagsData) {
  const hits = [];
  const words = String(text || '').toLowerCase().match(/[a-z]+/g) || [];
  const wordSet = new Set(words);
  for (const [keyword, contributions] of Object.entries(tagsData.keywords)) {
    if (wordSet.has(keyword)) hits.push(...contributions);
  }
  return hits;
}

/**
 * Merge structured interview answers with free-text keyword hits into one
 * tag vector. Structured answers win when both name the same axis (a kid's
 * explicit pick beats an inferred keyword guess); keyword hits fill in axes
 * the interview left blank.
 * @param {Record<string, string>} answers  {axisName: chosenValue}
 * @param {string[]} pitchHits  parsePitchText's output
 * @returns {Record<string, string>} the merged vector, one value per axis (or absent)
 */
export function buildTagVector(answers, pitchHits) {
  const vector = { ...answers };
  for (const hit of pitchHits) {
    const [axis, value] = hit.split(':');
    if (!vector[axis]) vector[axis] = value;
  }
  return vector;
}

/**
 * Flatten a tag vector into the plain tag strings a template manifest's
 * `tags` array would contain (applying the perspective alias).
 * @param {Record<string, string>} vector
 * @returns {string[]}
 */
function vectorToTags(vector) {
  const tags = [];
  for (const [axis, value] of Object.entries(vector)) {
    if (!value) continue;
    tags.push(axis === 'perspective' ? (PERSPECTIVE_TAG_ALIAS[value] || value) : value);
  }
  return tags;
}

/**
 * Score one template manifest against a tag vector: how many of the
 * vector's tags appear in the manifest's own tags.
 * @param {Record<string, string>} vector
 * @param {any} manifest
 * @returns {number}
 */
export function scoreTemplate(vector, manifest) {
  const wanted = vectorToTags(vector);
  const have = new Set(manifest.tags);
  return wanted.reduce((score, tag) => score + (have.has(tag) ? 1 : 0), 0);
}

/**
 * Score every available template and return them best-first. Deterministic:
 * ties keep the manifests' original order (whatever order the caller listed
 * them in), never a random pick.
 * @param {Record<string, string>} vector
 * @param {any[]} manifests
 * @returns {Array<{manifest: any, score: number}>}
 */
export function rankTemplates(vector, manifests) {
  return manifests
    .map((manifest) => ({ manifest, score: scoreTemplate(vector, manifest) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Build the "did we hear you right?" design doc — a plain-language,
 * editable summary of what the interview inferred, always shown before a
 * template is applied. Every line is meant to be overridable by the caller
 * (the confirmation screen UI) before committing.
 * @param {Record<string, string>} vector
 * @param {any} chosenManifest
 * @returns {{template: string, lines: Array<{axis: string, value: string}>, note: string}}
 */
export function buildDesignDoc(vector, chosenManifest) {
  const lines = Object.entries(vector)
    .filter(([, value]) => !!value)
    .map(([axis, value]) => ({ axis, value }));
  // Checks the ACTUAL chosen template rather than assuming — this used to
  // hardcode "only side-view templates exist," which went stale (and
  // actively wrong) the moment rpg/strategy/collect-a-thon/fps were added.
  let note = '';
  if (vector.perspective) {
    const wantedTag = PERSPECTIVE_TAG_ALIAS[vector.perspective] || vector.perspective;
    if (!chosenManifest.tags.includes(wantedTag)) {
      note = 'No template matches that exact perspective yet — the closest overall fit was picked instead, but everything else was honored.';
    }
  }
  return { template: chosenManifest.id, lines, note };
}
