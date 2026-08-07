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
import * as poser from '../poser.js';

/** Ships with the studio — see src/data/warehouse/characters/. */
const DEMO_CHARACTER_URL = new URL('../../data/warehouse/characters/blockman.glb', import.meta.url).href;
import { createEngine } from '../../engine/renderer.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

let character = null;   // {root, clips, name}
let mixer = null;
/** Posing pauses playback so hand edits stick; the loop checks this. */
let posing = false;
let posedBones = new Set();     // only these get written on Keyframe
let restPose = null;            // to put the rig back
let playhead = 0;
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

  /* ---------------------------------------------------------------- */
  /* Poser — grab a bone, turn the dials, keep the pose                 */
  /* ---------------------------------------------------------------- */
  const poseCard = document.createElement('div');
  poseCard.className = 'card';
  poseCard.innerHTML = '<h3>Poser</h3>';
  const poseBody = document.createElement('div');
  poseCard.appendChild(poseBody);
  right.appendChild(poseCard);

  let selectedBone = null;
  /** window listeners from dials, cleared on every re-render */
  const dialCleanups = [];

  function refreshPoser() {
    for (const off of dialCleanups.splice(0)) off();
    poseBody.innerHTML = '';
    if (!character) {
      poseBody.innerHTML = '<div class="stage-hint">Load a character first.</div>';
      return;
    }

    // --- pose mode switch -------------------------------------------
    const modeRow = document.createElement('div');
    modeRow.className = 'stage-bar';
    const modeBtn = makeBtn(posing ? '✋ Posing — click to play' : '▶ Playing — click to pose', () => {
      posing = !posing;
      if (posing) {
        // freeze wherever the animation currently is, and remember the
        // rest pose so "reset" means something
        if (mixer) mixer.timeScale = 0;
        if (!restPose) restPose = poser.capturePose(character.root);
      } else {
        if (mixer) mixer.timeScale = 1;
        posedBones.clear();
      }
      refreshPoser();
    });
    modeBtn.className += posing ? ' active' : ' primary';
    modeRow.appendChild(modeBtn);
    poseBody.appendChild(modeRow);

    if (!posing) {
      const hint = document.createElement('div');
      hint.className = 'stage-hint';
      hint.textContent = 'Switch to posing to grab bones and turn them by hand.';
      poseBody.appendChild(hint);
      return;
    }

    // --- which bone ---------------------------------------------------
    const bones = poser.boneTree(character.root);
    const pickRow = document.createElement('div');
    pickRow.className = 'brick-row';
    const pickLabel = document.createElement('span');
    pickLabel.textContent = 'Bone:';
    pickLabel.style.cssText = 'min-width:44px;font-size:11px;';
    pickRow.appendChild(pickLabel);
    const pick = document.createElement('select');
    pick.className = 'deck-select';
    pick.style.flex = '1';
    for (const b of bones) {
      const o = document.createElement('option');
      o.value = b.name;
      o.textContent = '\u00a0'.repeat(b.depth * 2) + b.label + (posedBones.has(b.name) ? ' •' : '');
      if (selectedBone === b.name) o.selected = true;
      pick.appendChild(o);
    }
    if (!selectedBone && bones.length) selectedBone = bones[0].name;
    pick.value = selectedBone;
    pick.addEventListener('change', () => { selectedBone = pick.value; refreshPoser(); });
    pickRow.appendChild(pick);
    poseBody.appendChild(pickRow);

    const bone = character.root.getObjectByName(selectedBone);
    if (!bone) return;

    // --- the dials ----------------------------------------------------
    const deg = poser.readEuler(bone);
    const dialRow = document.createElement('div');
    dialRow.className = 'poser-dials';
    for (const axis of ['x', 'y', 'z']) {
      dialRow.appendChild(makeDial(axis, deg[axis], (v) => {
        const now = poser.readEuler(bone);
        now[axis] = v;
        poser.writeEuler(bone, now);
        posedBones.add(selectedBone);
      }));
    }
    poseBody.appendChild(dialRow);

    const resetRow = document.createElement('div');
    resetRow.className = 'stage-bar';
    resetRow.appendChild(makeBtn('↺ This bone', () => {
      if (restPose && restPose.has(selectedBone)) {
        bone.quaternion.copy(restPose.get(selectedBone));
        bone.updateMatrixWorld(true);
      }
      posedBones.delete(selectedBone);
      refreshPoser();
    }));
    resetRow.appendChild(makeBtn('↺ Whole pose', () => {
      if (restPose) poser.restorePose(character.root, restPose);
      posedBones.clear();
      refreshPoser();
    }));
    poseBody.appendChild(resetRow);

    // --- timeline -----------------------------------------------------
    const clip = activeAction ? activeAction.getClip() : null;
    const tlWrap = document.createElement('div');
    tlWrap.style.marginTop = '10px';
    const tlLabel = document.createElement('div');
    tlLabel.className = 'stage-hint';
    tlLabel.style.padding = '0 0 4px';
    tlLabel.textContent = clip
      ? `Time ${playhead.toFixed(2)}s of ${clip.duration.toFixed(2)}s · ${poser.keyTimes(clip).length} keyframes`
      : 'No animation selected — make one below.';
    tlWrap.appendChild(tlLabel);

    if (clip) {
      const scrub = document.createElement('input');
      scrub.type = 'range';
      scrub.min = '0'; scrub.max = String(clip.duration); scrub.step = '0.01';
      scrub.value = String(playhead);
      scrub.style.width = '100%';
      scrub.addEventListener('input', () => {
        playhead = parseFloat(scrub.value);
        // show the animation's own pose at this instant; hand edits after
        // this point start from what's on screen
        if (mixer) { poser.sampleAt(mixer, clip, playhead); mixer.timeScale = 0; }
        posedBones.clear();
        refreshPoser();
      });
      tlWrap.appendChild(scrub);

      const ticks = document.createElement('div');
      ticks.className = 'poser-ticks';
      for (const t of poser.keyTimes(clip)) {
        const dot = document.createElement('div');
        dot.className = 'poser-tick' + (Math.abs(t - playhead) < 0.02 ? ' on' : '');
        dot.style.left = (clip.duration ? (t / clip.duration) * 100 : 0) + '%';
        dot.title = t.toFixed(2) + 's';
        dot.addEventListener('click', () => {
          playhead = t;
          if (mixer) { poser.sampleAt(mixer, clip, playhead); mixer.timeScale = 0; }
          posedBones.clear();
          refreshPoser();
        });
        ticks.appendChild(dot);
      }
      tlWrap.appendChild(ticks);
    }
    poseBody.appendChild(tlWrap);

    // --- keyframe -----------------------------------------------------
    const keyRow = document.createElement('div');
    keyRow.className = 'stage-bar';
    const keyBtn = makeBtn('◆ Keyframe here', () => {
      if (!character) return;
      let target = activeAction ? activeAction.getClip() : null;
      if (!target) {
        target = poser.emptyClip('New Animation', Math.max(2, playhead));
        character.clips.push(target);
      }
      if (!posedBones.size) {
        ctx.toast('Turn a dial first — nothing has been posed to record.', true);
        return;
      }
      const updated = poser.keyframe(target, character.root, playhead, [...posedBones]);
      const i = character.clips.indexOf(target);
      if (i >= 0) character.clips[i] = updated; else character.clips.push(updated);
      // re-point playback at the new clip object
      if (mixer) {
        mixer.stopAllAction();
        activeAction = mixer.clipAction(updated);
        activeAction.play();
        activeAction.paused = true;
        activeAction.time = playhead;
        mixer.update(0);
        mixer.timeScale = 0;
      }
      posedBones.clear();
      ctx.toast('Keyframe at ' + playhead.toFixed(2) + 's — ' + poser.keyTimes(updated).length + ' total.');
      refreshClips();
      refreshPoser();
    });
    keyBtn.className += ' primary';
    keyRow.appendChild(keyBtn);

    keyRow.appendChild(makeBtn('✕ Remove key', () => {
      const c = activeAction ? activeAction.getClip() : null;
      if (!c) return;
      const updated = poser.removeKeyframe(c, playhead);
      const i = character.clips.indexOf(c);
      if (i >= 0) character.clips[i] = updated;
      if (mixer) {
        mixer.stopAllAction();
        activeAction = mixer.clipAction(updated);
        activeAction.play(); activeAction.paused = true;
        activeAction.time = playhead; mixer.update(0); mixer.timeScale = 0;
      }
      ctx.toast('Removed keys at ' + playhead.toFixed(2) + 's.');
      refreshClips(); refreshPoser();
    }));
    poseBody.appendChild(keyRow);

    const newRow = document.createElement('div');
    newRow.className = 'stage-bar';
    newRow.appendChild(makeBtn('+ Blank animation', () => {
      const c = poser.emptyClip('Animation ' + (character.clips.length + 1), 2);
      character.clips.push(c);
      playhead = 0;
      if (mixer) {
        mixer.stopAllAction();
        activeAction = mixer.clipAction(c);
        activeAction.play(); activeAction.paused = true; mixer.timeScale = 0;
      }
      refreshClips(); refreshPoser();
    }));
    poseBody.appendChild(newRow);

    const poseHint = document.createElement('div');
    poseHint.className = 'stage-hint';
    poseHint.textContent = 'Turn the dials to move the bone. When it looks right, hit Keyframe to record it at this moment. Move the time slider along and pose again to build up the animation.';
    poseBody.appendChild(poseHint);
  }

  /**
   * A Poser-style dial: drag it round, or up and down, to spin the bone.
   * Vertical dragging is what actually works on a trackpad and a phone;
   * the circular readout is what makes it legible at a glance.
   */
  function makeDial(axis, value, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'dial-wrap';
    const cvs = document.createElement('canvas');
    cvs.width = 88; cvs.height = 88;
    cvs.className = 'dial';
    wrap.appendChild(cvs);
    const read = document.createElement('div');
    read.className = 'dial-read';
    wrap.appendChild(read);
    const cap = document.createElement('div');
    cap.className = 'dial-cap';
    cap.textContent = axis.toUpperCase();
    wrap.appendChild(cap);

    const COLOR = { x: '#ff6b6b', y: '#67e39b', z: '#6fd3ff' }[axis];
    let deg = value;

    function draw() {
      const g = cvs.getContext('2d');
      const cx = 44, cy = 44, r = 33;
      g.clearRect(0, 0, 88, 88);
      g.lineWidth = 7;
      g.strokeStyle = '#232838';
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      // sweep from 12 o'clock, the way a real dial reads
      const a = (deg / 180) * Math.PI - Math.PI / 2;
      g.strokeStyle = COLOR;
      g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, a, deg < 0); g.stroke();
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      g.lineWidth = 3; g.stroke();
      g.fillStyle = COLOR;
      g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
      read.textContent = Math.round(deg) + '°';
    }
    draw();

    let dragging = false, lastY = 0, lastX = 0;
    const start = (e) => {
      dragging = true;
      const p = e.touches ? e.touches[0] : e;
      lastY = p.clientY; lastX = p.clientX;
      cvs.setPointerCapture && e.pointerId !== undefined && cvs.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e) => {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      // up/down is the coarse control, left/right the fine one
      const d = (lastY - p.clientY) * 1.2 + (p.clientX - lastX) * 0.35;
      lastY = p.clientY; lastX = p.clientX;
      deg = Math.max(-180, Math.min(180, deg + d));
      draw();
      onChange(deg);
      e.preventDefault();
    };
    const end = () => { dragging = false; };

    cvs.addEventListener('pointerdown', start);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    cvs.addEventListener('dblclick', () => { deg = 0; draw(); onChange(0); });
    dialCleanups.push(() => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    });
    return wrap;
  }

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
    posing = false;
    posedBones.clear();
    restPose = poser.capturePose(root);
    playhead = 0;
    refreshClips();
    if (character.clips.length) playClip(character.clips[0]);
    refreshPoser();
  }

  function playClip(clip) {
    if (!mixer) return;
    if (activeAction) activeAction.fadeOut(0.2);
    activeAction = mixer.clipAction(clip);
    activeAction.reset().fadeIn(0.2).play();
    if (posing) { activeAction.paused = true; mixer.timeScale = 0; }
    refreshClips();
    refreshPoser();
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
      // While posing, the mixer would overwrite every dial turn on the next
      // frame — so it only advances when playing.
      if (mixer && !posing) mixer.update(dt);
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
  refreshPoser();
  startViewport();
  if (character) {
    charName.textContent = character.name + ' — ' + rig.boneNames(character.root).length + ' bones';
    nameInput.value = character.name;
  }

  const stopObs = new MutationObserver(() => {
    if (!document.body.contains(panel)) {
      stopObs.disconnect();
      for (const off of dialCleanups.splice(0)) off();
      stopViewport();
    }
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
