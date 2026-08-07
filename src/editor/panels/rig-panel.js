/**
 * @file rig-panel.js
 * @description Characters tab in the Animate room: load an armatured model
 * (GLB or Mixamo FBX), watch it play its clips in a live viewport, import
 * more animations onto it, convert everything to one GLB, and save the
 * character into the game. The rig math lives in rig.js.
 */

import * as THREE from 'three';
import * as cart from '../cartridge.js';
import * as rig from '../rig.js';

/** Ships with the studio — see src/data/warehouse/characters/. */
const DEMO_CHARACTER_URL = new URL('../../data/warehouse/characters/blockman.glb', import.meta.url).href;
import { createEngine } from '../../engine/renderer.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

let character = null;   // {root, clips, name}
let mixer = null;
let activeAction = null;

/**
 * @param {HTMLElement} host
 * @param {{toast: Function, refresh: Function}} ctx
 */
export function renderRigPanel(host, ctx) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<h2>Characters</h2>' +
    '<div class="sub">Load a rigged character (GLB, or FBX straight from Mixamo), play its animations, pile more animations onto it, and save it — or convert the whole thing to GLB.</div>';

  const layout = document.createElement('div');
  layout.className = 'stage-layout';

  // ---------- left: viewport ----------
  const left = document.createElement('div');
  left.className = 'card';
  left.innerHTML = '<h3>Stage</h3>';
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'stage-canvas-wrap';
  canvasWrap.style.height = '48vh';
  const canvas = document.createElement('canvas');
  canvas.className = 'deck-canvas';
  canvasWrap.appendChild(canvas);
  left.appendChild(canvasWrap);
  layout.appendChild(left);

  // ---------- right: load + clips + export ----------
  const right = document.createElement('div');
  right.className = 'deck-right';

  const loadCard = document.createElement('div');
  loadCard.className = 'card';
  loadCard.innerHTML = '<h3>Character</h3>';
  const charName = document.createElement('div');
  charName.className = 'stage-hint';
  charName.textContent = 'Nothing loaded yet.';
  loadCard.appendChild(charName);
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = '.glb,.gltf,.fbx'; fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    rig.loadRigFile(file).then(({ root, clips }) => {
      setCharacter(root, clips, file.name.replace(/\.[^.]+$/, ''));
      const bones = rig.boneNames(root).length;
      ctx.toast('Loaded "' + file.name + '" — ' + bones + ' bones, ' + clips.length + ' animation' + (clips.length === 1 ? '' : 's') + '.');
    }).catch(() => ctx.toast('Could not read that file — GLB, GLTF, or FBX.', true));
    fileInput.value = '';
  });
  loadCard.appendChild(fileInput);
  const loadBtn = makeBtn('📥 Load Character…', () => fileInput.click());
  loadBtn.className += ' primary';
  loadBtn.style.width = '100%';
  loadCard.appendChild(loadBtn);

  // Somewhere to start. A rigged character is the one thing you can't make
  // inside the studio, so without a bundled one this room opens empty and
  // there is nothing to press play on.
  const demoBtn = makeBtn('🧍 Load the demo character', () => {
    rig.loadRigUrl(DEMO_CHARACTER_URL).then(({ root, clips }) => {
      setCharacter(root, clips, 'Block Man');
      const bones = rig.boneNames(root).length;
      ctx.toast('Block Man loaded — ' + bones + ' bones, ' + clips.length + ' animations. Click one to play it.');
    }).catch(() => ctx.toast('Could not load the demo character.', true));
  });
  demoBtn.style.width = '100%';
  demoBtn.style.marginTop = '6px';
  loadCard.appendChild(demoBtn);
  const demoHint = document.createElement('div');
  demoHint.className = 'stage-hint';
  demoHint.textContent = 'Block Man is made of one block per bone, so you can see the skeleton doing the work. He walks, waves, jumps, and idles.';
  loadCard.appendChild(demoHint);
  right.appendChild(loadCard);

  const clipsCard = document.createElement('div');
  clipsCard.className = 'card';
  clipsCard.innerHTML = '<h3>Animations</h3><div class="stage-hint">Click one to play it.</div>';
  const clipList = document.createElement('div');
  clipsCard.appendChild(clipList);
  const animInput = document.createElement('input');
  animInput.type = 'file'; animInput.accept = '.glb,.gltf,.fbx'; animInput.style.display = 'none';
  animInput.multiple = true;
  animInput.addEventListener('change', async () => {
    if (!character) { ctx.toast('Load a character first.', true); return; }
    for (const file of animInput.files) {
      try {
        const { root, clips } = await rig.loadRigFile(file);
        const { applied, failed } = rig.applyClips(character.root, root, clips);
        character.clips.push(...applied);
        if (applied.length) ctx.toast('Added ' + applied.length + ' animation' + (applied.length === 1 ? '' : 's') + ' from ' + file.name + '.');
        if (failed.length) ctx.toast('Could not fit: ' + failed.join(', ') + ' (different skeleton).', true);
      } catch (e) {
        ctx.toast('Could not read ' + file.name + '.', true);
      }
    }
    animInput.value = '';
    refreshClips();
  });
  clipsCard.appendChild(animInput);
  const importBtn = makeBtn('＋ Import Animations…', () => animInput.click());
  importBtn.style.cssText = 'width:100%;margin-top:6px;';
  clipsCard.appendChild(importBtn);
  right.appendChild(clipsCard);

  const outCard = document.createElement('div');
  outCard.className = 'card';
  outCard.innerHTML = '<h3>Save & Convert</h3>';
  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.className = 'title-input';
  nameInput.style.cssText = 'width:100%;margin-bottom:8px;';
  nameInput.placeholder = 'Character name';
  outCard.appendChild(nameInput);
  const saveBtn = makeBtn('💾 Save to Game', async () => {
    if (!character) { ctx.toast('Load a character first.', true); return; }
    try {
      const glb = await rig.exportGLB(character.root, character.clips);
      const live = cart.getCartridge();
      const name = nameInput.value || character.name;
      rig.saveCharacter(live, name, glb, character.clips.map((c) => c.name));
      cart.touch();
      ctx.toast('Saved "' + name + '" with ' + character.clips.length + ' animations.');
    } catch (e) {
      ctx.toast('Save failed: ' + e.message, true);
    }
  });
  saveBtn.className += ' primary';
  saveBtn.style.width = '100%';
  outCard.appendChild(saveBtn);
  const exportBtn = makeBtn('⬇ Download as GLB', async () => {
    if (!character) { ctx.toast('Load a character first.', true); return; }
    try {
      // the converter: whatever came in (FBX included), one GLB comes out
      const glb = await rig.exportGLB(character.root, character.clips);
      const blob = new Blob([glb], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = (nameInput.value || character.name) + '.glb';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      ctx.toast('Downloaded — model plus ' + character.clips.length + ' animations in one GLB.');
    } catch (e) {
      ctx.toast('Export failed: ' + e.message, true);
    }
  });
  exportBtn.style.cssText = 'width:100%;margin-top:4px;';
  outCard.appendChild(exportBtn);
  right.appendChild(outCard);

  layout.appendChild(right);
  panel.appendChild(layout);
  host.appendChild(panel);

  /* ---------------------------------------------------------------- */
  /* character + clips                                                 */
  /* ---------------------------------------------------------------- */

  function setCharacter(root, clips, name) {
    if (character && engine) engine.contentRoot.remove(character.root);
    if (mixer) { mixer.stopAllAction(); mixer = null; activeAction = null; }
    // normalize size: fit to ~1.8 units tall, feet at the ground
    const box = new THREE.Box3().setFromObject(root);
    const height = Math.max(0.001, box.max.y - box.min.y);
    const s = 1.8 / height;
    root.scale.setScalar(s);
    box.setFromObject(root);
    root.position.y -= box.min.y;
    character = { root, clips: [...clips], name };
    nameInput.value = name;
    charName.textContent = name + ' — ' + rig.boneNames(root).length + ' bones';
    if (engine) engine.contentRoot.add(root);
    mixer = new THREE.AnimationMixer(root);
    refreshClips();
    if (character.clips.length) playClip(character.clips[0]);
  }

  function playClip(clip) {
    if (!mixer) return;
    if (activeAction) activeAction.fadeOut(0.2);
    activeAction = mixer.clipAction(clip);
    activeAction.reset().fadeIn(0.2).play();
    refreshClips();
  }

  function refreshClips() {
    clipList.innerHTML = '';
    if (!character || !character.clips.length) {
      clipList.innerHTML = '<div class="stage-hint">No animations yet — Mixamo FBX files bring their own.</div>';
      return;
    }
    character.clips.forEach((clip, i) => {
      const row = document.createElement('div');
      row.className = 'stage-prefab-row';
      const playing = activeAction && activeAction.getClip() === clip;
      const label = document.createElement('span');
      label.textContent = (playing ? '▶ ' : '') + (clip.name || 'Animation ' + (i + 1));
      label.style.cursor = 'pointer';
      if (playing) label.style.color = 'var(--gold)';
      label.addEventListener('click', () => playClip(clip));
      row.appendChild(label);
      const del = makeBtn('✕', () => {
        if (activeAction && activeAction.getClip() === clip) { activeAction.stop(); activeAction = null; }
        character.clips.splice(i, 1);
        refreshClips();
      });
      del.className += ' bad-btn';
      row.appendChild(del);
      clipList.appendChild(row);
    });
  }

  /* ---------------------------------------------------------------- */
  /* viewport                                                          */
  /* ---------------------------------------------------------------- */
  let engine = null;
  let orbit = null;
  let rafId = null;
  let resizeObs = null;
  const clock = new THREE.Clock();

  function startViewport() {
    engine = createEngine(canvas, { demo: false });
    engine.setMode('3d');
    engine.setLighting({ shadows: 'pcfsoft', bounce: 0.4, sunAngle: 40, sunHeight: 55 });
    engine.camera.position.set(0, 1.4, 3.2);
    engine.camera.lookAt(0, 0.9, 0);
    engine.scene.add(new THREE.GridHelper(6, 12, 0x3a3454, 0x262238));
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3, 32),
      new THREE.MeshStandardMaterial({ color: 0x262238, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.005;
    floor.receiveShadow = true;
    engine.scene.add(floor);

    orbit = new OrbitControls(engine.camera, canvas);
    orbit.target.set(0, 0.9, 0);
    orbit.update();

    if (character) { engine.contentRoot.add(character.root); }

    function resize() { engine.resize(canvasWrap.clientWidth, canvasWrap.clientHeight); }
    resizeObs = new ResizeObserver(resize);
    resizeObs.observe(canvasWrap);
    resize();

    function loop() {
      const dt = clock.getDelta();
      if (mixer) mixer.update(dt);
      if (engine) engine.tick();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  }

  function stopViewport() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    if (orbit) { orbit.dispose(); orbit = null; }
    if (engine) {
      if (character) engine.contentRoot.remove(character.root);
      engine.dispose();
      engine = null;
    }
  }

  refreshClips();
  startViewport();
  if (character) {
    charName.textContent = character.name + ' — ' + rig.boneNames(character.root).length + ' bones';
    nameInput.value = character.name;
  }

  const stopObs = new MutationObserver(() => {
    if (!document.body.contains(panel)) { stopObs.disconnect(); stopViewport(); }
  });
  stopObs.observe(document.body, { childList: true, subtree: true });
}

function makeBtn(label, fn) {
  const b = document.createElement('button');
  b.className = 'bar';
  b.textContent = label;
  if (fn) b.addEventListener('click', fn);
  return b;
}
