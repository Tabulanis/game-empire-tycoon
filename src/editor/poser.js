/**
 * @file poser.js
 * @description Posing a rig by hand and writing what you posed back into an
 * animation. The Animation Loft could play clips but never change them; this
 * is the part that lets you grab a bone, turn it, and keep the result.
 *
 * The DOM lives in panels/rig-panel.js — this module is only the math, the
 * same split rig.js already uses.
 *
 * Two ideas do most of the work:
 *
 *   POSING is just writing to bone.rotation. Bones carry a quaternion
 *   internally, but nobody thinks in quaternions, so the dials speak Euler
 *   degrees and this module converts at the boundary.
 *
 *   KEYFRAMING reads every posed bone's current quaternion and writes it into
 *   the clip's tracks at a given time. AnimationClips aren't really meant to
 *   be edited in place, so a keyframe returns a NEW clip with the key merged
 *   in — which also makes undo trivial, since the old clip is still intact.
 */

import * as THREE from 'three';

/** Degrees are what the dials show; radians are what three.js wants. */
export const DEG = 180 / Math.PI;

/**
 * Every bone, in a sensible order for a list: down the spine, then limbs,
 * rather than whatever order the exporter happened to use.
 * @param {THREE.Object3D} root
 * @returns {Array<{bone: THREE.Bone, name: string, label: string, depth: number}>}
 */
export function boneTree(root) {
  const out = [];
  const walk = (obj, depth) => {
    if (obj.isBone) {
      out.push({ bone: obj, name: obj.name, label: prettyBone(obj.name), depth });
      depth += 1;
    }
    for (const c of obj.children) walk(c, depth);
  };
  walk(root, 0);
  return out;
}

/** mixamorig_LeftForeArm -> "Left Fore Arm" */
export function prettyBone(name) {
  return String(name)
    .replace(/^mixamorig[:_]?/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_:]/g, ' ')
    .trim() || name;
}

/**
 * Current rotation of a bone, in degrees, for filling the dials.
 * @param {THREE.Bone} bone
 * @returns {{x: number, y: number, z: number}}
 */
export function readEuler(bone) {
  const e = new THREE.Euler().setFromQuaternion(bone.quaternion, 'XYZ');
  return { x: e.x * DEG, y: e.y * DEG, z: e.z * DEG };
}

/**
 * Point a bone at a rotation given in degrees.
 * @param {THREE.Bone} bone
 * @param {{x: number, y: number, z: number}} deg
 */
export function writeEuler(bone, deg) {
  bone.rotation.set(deg.x / DEG, deg.y / DEG, deg.z / DEG, 'XYZ');
  bone.updateMatrixWorld(true);
}

/**
 * Pose the whole rig the way a clip has it at time t, without running the
 * mixer continuously — used for scrubbing the timeline.
 * @param {THREE.AnimationMixer} mixer @param {THREE.AnimationClip} clip @param {number} t
 */
export function sampleAt(mixer, clip, t) {
  const action = mixer.clipAction(clip);
  action.reset();
  action.play();
  action.paused = true;
  action.time = Math.max(0, Math.min(clip.duration, t));
  mixer.update(0);
  return action;
}

/* ------------------------------------------------------------------ */
/* keyframes                                                           */
/* ------------------------------------------------------------------ */

const EPS = 1e-4;   // times closer than this count as the same keyframe

/**
 * Merge the rig's current pose into a clip as a keyframe at `time`.
 *
 * Returns a NEW clip — the original is untouched, which is what makes undo
 * a matter of keeping the old reference rather than reversing an edit.
 *
 * Only the bones named in `boneNames` are written. Keying every bone on every
 * press would bloat the clip and freeze limbs the user never touched, which
 * is the classic way hand-posed animation goes stiff.
 *
 * @param {THREE.AnimationClip} clip
 * @param {THREE.Object3D} root
 * @param {number} time
 * @param {string[]} boneNames
 * @returns {THREE.AnimationClip}
 */
export function keyframe(clip, root, time, boneNames) {
  const tracks = (clip ? clip.tracks : []).map((t) => t.clone());
  const t = Math.max(0, time);

  for (const name of boneNames) {
    const bone = root.getObjectByName(name);
    if (!bone) continue;
    const q = bone.quaternion;
    const trackName = name + '.quaternion';
    let track = tracks.find((tr) => tr.name === trackName);

    if (!track) {
      // A brand-new track. Anchor it at t=0 with the bone's CURRENT value as
      // well, otherwise the bone snaps from bind pose to this key and the
      // whole first stretch of the animation looks broken.
      const times = t > EPS ? [0, t] : [0];
      const vals = [];
      for (let i = 0; i < times.length; i++) vals.push(q.x, q.y, q.z, q.w);
      tracks.push(new THREE.QuaternionKeyframeTrack(trackName, times, vals));
      continue;
    }

    const times = Array.from(track.times);
    const values = Array.from(track.values);
    const at = times.findIndex((x) => Math.abs(x - t) < EPS);
    if (at >= 0) {
      values[at * 4] = q.x; values[at * 4 + 1] = q.y;
      values[at * 4 + 2] = q.z; values[at * 4 + 3] = q.w;
    } else {
      let ins = times.findIndex((x) => x > t);
      if (ins < 0) ins = times.length;
      times.splice(ins, 0, t);
      values.splice(ins * 4, 0, q.x, q.y, q.z, q.w);
    }
    const idx = tracks.indexOf(track);
    tracks[idx] = new THREE.QuaternionKeyframeTrack(trackName, times, values);
  }

  const duration = Math.max(clip ? clip.duration : 0, t);
  const out = new THREE.AnimationClip(clip ? clip.name : 'Pose', duration, tracks);
  out.uuid = THREE.MathUtils.generateUUID();
  return out;
}

/**
 * Remove every key at `time` (within a hair) from a clip.
 * @param {THREE.AnimationClip} clip @param {number} time
 * @returns {THREE.AnimationClip}
 */
export function removeKeyframe(clip, time) {
  const tracks = [];
  for (const tr of clip.tracks) {
    const times = Array.from(tr.times);
    const at = times.findIndex((x) => Math.abs(x - time) < EPS);
    if (at < 0 || times.length <= 1) { tracks.push(tr.clone()); continue; }
    const stride = tr.values.length / times.length;
    const values = Array.from(tr.values);
    times.splice(at, 1);
    values.splice(at * stride, stride);
    tracks.push(new THREE.QuaternionKeyframeTrack(tr.name, times, values));
  }
  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  out.uuid = THREE.MathUtils.generateUUID();
  return out;
}

/**
 * Every distinct keyframe time in a clip, sorted — what the timeline draws
 * its ticks from.
 * @param {THREE.AnimationClip} clip
 * @returns {number[]}
 */
export function keyTimes(clip) {
  if (!clip) return [];
  const set = new Set();
  for (const tr of clip.tracks) for (const t of tr.times) set.add(Math.round(t * 1000) / 1000);
  return [...set].sort((a, b) => a - b);
}

/**
 * A clip with nothing in it, ready to be posed into.
 * @param {string} name @param {number} duration
 */
export function emptyClip(name, duration = 2) {
  return new THREE.AnimationClip(name || 'New Animation', duration, []);
}

/**
 * Put every bone back to the rest pose the rig was loaded in.
 * @param {THREE.Object3D} root
 * @param {Map<string, THREE.Quaternion>} rest
 */
export function restorePose(root, rest) {
  for (const [name, q] of rest) {
    const b = root.getObjectByName(name);
    if (b) b.quaternion.copy(q);
  }
  root.updateMatrixWorld(true);
}

/**
 * Snapshot the rig's current pose so it can be restored later.
 * @param {THREE.Object3D} root
 * @returns {Map<string, THREE.Quaternion>}
 */
export function capturePose(root) {
  const m = new Map();
  root.traverse((o) => { if (o.isBone) m.set(o.name, o.quaternion.clone()); });
  return m;
}
