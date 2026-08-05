/**
 * @file rig.js
 * @description Character rig logic for the Animate room: load armatured
 * models (GLB/GLTF and FBX — Mixamo's native download format), list and
 * play their animation clips, import more clips from other files and apply
 * them to the loaded character (direct when bone names match — the whole
 * Mixamo family does — with a SkeletonUtils retarget fallback for foreign
 * rigs), and export everything as one GLB (the format converter: FBX in,
 * GLB out). Constitution Article IX: Mixamo naming is the rig standard,
 * import-only, never bundled. The DOM lives in panels/rig-panel.js.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Load a model or animation file into {root, clips}.
 * @param {File} file
 * @returns {Promise<{root: THREE.Object3D|null, clips: THREE.AnimationClip[]}>}
 */
export function loadRigFile(file) {
  const name = file.name.toLowerCase();
  return file.arrayBuffer().then((buffer) => new Promise((resolve, reject) => {
    if (name.endsWith('.fbx')) {
      try {
        const root = new FBXLoader().parse(buffer, '');
        resolve({ root, clips: root.animations || [] });
      } catch (e) { reject(e); }
    } else if (name.endsWith('.glb') || name.endsWith('.gltf')) {
      new GLTFLoader().parse(buffer, '', (gltf) => {
        resolve({ root: gltf.scene, clips: gltf.animations || [] });
      }, reject);
    } else {
      reject(new Error('unsupported format'));
    }
  }));
}

/** @param {THREE.Object3D} root @returns {string[]} bone names in the rig */
export function boneNames(root) {
  const names = [];
  root.traverse((o) => { if (o.isBone) names.push(o.name); });
  return names;
}

/** Normalize for cross-rig matching: mixamorig:Hips / mixamorig_Hips / Hips → hips */
const normBone = (n) => n.toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[^a-z0-9]/g, '');

/**
 * How well a clip's tracks line up with a rig's bones, 0..1.
 * @param {THREE.AnimationClip} clip @param {Set<string>} boneSet normalized
 */
function clipMatch(clip, boneSet) {
  let hit = 0, total = 0;
  for (const track of clip.tracks) {
    const bone = track.name.split('.')[0];
    total++;
    if (boneSet.has(normBone(bone))) hit++;
  }
  return total ? hit / total : 0;
}

/**
 * Apply imported clips to a character. Same rig family (Mixamo↔Mixamo):
 * tracks bind by name directly — rename mixamorig-prefix variants to the
 * target's spelling. Foreign rigs: SkeletonUtils.retargetClip.
 * @param {THREE.Object3D} target  the loaded character
 * @param {THREE.Object3D} sourceRoot  the animation file's root
 * @param {THREE.AnimationClip[]} clips
 * @returns {{applied: THREE.AnimationClip[], failed: string[]}}
 */
export function applyClips(target, sourceRoot, clips) {
  const targetBones = boneNames(target);
  const targetSet = new Set(targetBones.map(normBone));
  // normalized → actual spelling in the target rig
  const spelling = {};
  for (const b of targetBones) spelling[normBone(b)] = b;

  const applied = [], failed = [];
  for (const clip of clips) {
    const match = clipMatch(clip, targetSet);
    if (match >= 0.5) {
      // same family: rebind tracks to the target's exact bone names
      const renamed = clip.clone();
      renamed.tracks = renamed.tracks.filter((track) => {
        const [bone, ...prop] = track.name.split('.');
        const actual = spelling[normBone(bone)];
        if (!actual) return false;
        track.name = actual + '.' + prop.join('.');
        return true;
      });
      renamed.name = clip.name || 'Imported';
      applied.push(renamed);
    } else if (sourceRoot) {
      try {
        const retargeted = SkeletonUtils.retargetClip(target, sourceRoot, clip, {});
        retargeted.name = clip.name || 'Imported';
        applied.push(retargeted);
      } catch (e) {
        failed.push(clip.name || '(unnamed)');
      }
    } else {
      failed.push(clip.name || '(unnamed)');
    }
  }
  return { applied, failed };
}

/**
 * Export a character + its clips as one binary GLB.
 * @param {THREE.Object3D} root @param {THREE.AnimationClip[]} clips
 * @returns {Promise<ArrayBuffer>}
 */
export function exportGLB(root, clips) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, (result) => resolve(result), reject, {
      binary: true,
      animations: clips
    });
  });
}

/**
 * Save a character into cartridge.assets.models as a self-contained GLB
 * dataURL with its clip names listed.
 * @param {any} cartridge @param {string} name
 * @param {ArrayBuffer} glb @param {string[]} clipNames
 * @returns {string} the model's id
 */
export function saveCharacter(cartridge, name, glb, clipNames) {
  if (!cartridge.assets.models) cartridge.assets.models = [];
  const slug = String(name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'character';
  let id = slug, n = 2;
  while (cartridge.assets.models.find((m) => m.id === id)) { id = slug + '-' + n; n++; }
  const bytes = new Uint8Array(glb);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  cartridge.assets.models.push({
    id, name, kind: 'character',
    glb: 'data:model/gltf-binary;base64,' + btoa(binary),
    clips: clipNames
  });
  return id;
}
