/**
 * @file animation.js
 * @description Animation Loft's runtime half: procedural cycles (bob, spin,
 * pulse — no authoring needed, just pick one and a speed) and a simple
 * authored keyframe timeline (linear interpolation between {t, p, r, s}
 * keyframes, looping). Applied as a VISUAL offset on top of whatever
 * position an entity's transform/physics already have — an animated coin's
 * collision box stays where it actually is; only its rendered position
 * bobs. This keeps animation from fighting physics-driven movement.
 *
 * Scope note: this is procedural/keyframe animation only. Retargeting a
 * GLB's own skeletal animations is NOT implemented — that needs a GLB
 * import pipeline wired into the entity/component system first (today,
 * loadGLB exists as a renderer.js utility but nothing places a GLB as a
 * scene entity yet). Documented gap, not a silent one.
 * Ticket P6-5. Phase 6.
 */

/**
 * @param {any} clip  a saved clip from cartridge.assets.anims, or a procedural spec {kind, speed}
 * @param {number} t  seconds since this entity's animation started
 * @returns {{p: [number,number,number], r: [number,number,number], s: [number,number,number]}}
 *   an OFFSET to add to the entity's base transform — p/r are additive, s is multiplicative
 */
export function sampleClip(clip, t) {
  if (clip.kind === 'bob') {
    const speed = clip.speed || 1;
    return { p: [0, Math.sin(t * speed * Math.PI * 2) * (clip.amount || 0.25), 0], r: [0, 0, 0], s: [1, 1, 1] };
  }
  if (clip.kind === 'spin') {
    const speed = clip.speed || 1;
    return { p: [0, 0, 0], r: [0, (t * speed * 360) % 360, 0], s: [1, 1, 1] };
  }
  if (clip.kind === 'pulse') {
    const speed = clip.speed || 1;
    const scale = 1 + Math.sin(t * speed * Math.PI * 2) * (clip.amount || 0.15);
    return { p: [0, 0, 0], r: [0, 0, 0], s: [scale, scale, scale] };
  }
  if (clip.keyframes && clip.keyframes.length) {
    return sampleKeyframes(clip, t);
  }
  return { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
}

/**
 * Linear-interpolate a keyframe clip at time t, looping over clip.duration.
 * @param {any} clip  {duration, keyframes: [{t, p, r, s}]}
 * @param {number} t
 */
function sampleKeyframes(clip, t) {
  const duration = clip.duration || clip.keyframes[clip.keyframes.length - 1].t || 1;
  const loopedT = duration > 0 ? t % duration : 0;
  const frames = clip.keyframes;
  if (frames.length === 1) return { p: frames[0].p, r: frames[0].r, s: frames[0].s };

  let a = frames[0], b = frames[frames.length - 1];
  for (let i = 0; i < frames.length - 1; i++) {
    if (loopedT >= frames[i].t && loopedT <= frames[i + 1].t) {
      a = frames[i]; b = frames[i + 1];
      break;
    }
  }
  const span = b.t - a.t;
  const frac = span > 0 ? (loopedT - a.t) / span : 0;
  const lerp3 = (u, v) => [u[0] + (v[0] - u[0]) * frac, u[1] + (v[1] - u[1]) * frac, u[2] + (v[2] - u[2]) * frac];
  return { p: lerp3(a.p, b.p), r: lerp3(a.r, b.r), s: lerp3(a.s, b.s) };
}

/**
 * @typedef {Object} AnimState
 * @property {Map<string, number>} elapsed  entityId -> seconds since this entity's clip started
 */

/** @returns {AnimState} */
export function createAnimState() {
  return { elapsed: new Map() };
}

/**
 * Advance every animated entity's clock and return its current offset.
 * @param {any} entity
 * @param {AnimState} state
 * @param {any} cartridge  for looking up saved clips by id
 * @param {number} dt
 * @returns {{p: number[], r: number[], s: number[]}|null}
 */
export function tickEntityAnimation(entity, state, cartridge, dt) {
  const anim = entity.components.anim;
  if (!anim || anim.playing === false) return null;
  const elapsed = (state.elapsed.get(entity.id) || 0) + dt * (anim.speed || 1);
  state.elapsed.set(entity.id, elapsed);

  let clip;
  if (anim.kind) {
    clip = { kind: anim.kind, speed: 1, amount: anim.amount }; // speed already applied to elapsed above
  } else if (anim.clip) {
    clip = (cartridge.assets.anims || []).find((c) => c.id === anim.clip);
  }
  if (!clip) return null;
  return sampleClip(clip, elapsed);
}
