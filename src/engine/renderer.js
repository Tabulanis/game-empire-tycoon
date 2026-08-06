/**
 * @file renderer.js
 * @description The render engine: one Three.js scene graph serving both 2D and
 * 3D modes, plus the effect channels chain (Constitution Article XI). This is
 * the "one renderer" law made real — the Deck and the Stage both run on this
 * exact module.
 * Phase 1, extended for Phase 2: `contentRoot` is a persistent group for scene
 * content (the Stage builds entity views into it; it survives mode switches),
 * and the P1 demo cube/sprite is now opt-in via `createEngine(canvas, {demo})`
 * so the Stage starts empty while the Deck keeps its demo.
 *
 * API surface (all verified against installed package versions):
 *   three@0.169.0, postprocessing@6.39.4
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  VignetteEffect,
  NoiseEffect,
  ChromaticAberrationEffect,
  PixelationEffect,
  DepthOfFieldEffect,
  BlendFunction
} from 'postprocessing';

/** The full channel list from Constitution Article XI. Order is render order. */
export const CHANNEL_IDS = ['bloom', 'blur', 'chromatic', 'pixelate', 'noise', 'vignette'];

/** Human labels for the channel toggles. */
export const CHANNEL_LABELS = {
  bloom: 'Bloom',
  blur: 'Blur / DoF',
  vignette: 'Vignette',
  noise: 'Noise / Grain',
  chromatic: 'Chromatic Aberration',
  pixelate: 'Pixelate'
};

/** Tone-map presets, mapped to real THREE.* constants. */
export const TONE_MAPS = {
  none: THREE.NoToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  reinhard: THREE.ReinhardToneMapping
};

/**
 * Build one channel Effect instance. Wrapped defensively: a broken effect
 * disables itself with a console warning instead of crashing the whole deck.
 * @param {string} id
 * @param {THREE.Camera} camera
 * @returns {any|null}
 */
function buildEffect(id, camera) {
  try {
    switch (id) {
      case 'bloom':
        return new BloomEffect({ intensity: 1.2, luminanceThreshold: 0.55, luminanceSmoothing: 0.2 });
      case 'blur':
        return new DepthOfFieldEffect(camera, { focusDistance: 0.02, focusRange: 0.05, bokehScale: 3 });
      case 'vignette':
        return new VignetteEffect({ offset: 0.4, darkness: 0.6 });
      case 'noise':
        return new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
      case 'chromatic':
        return new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0025, 0.0015) });
      case 'pixelate':
        return new PixelationEffect(10);
      default:
        return null;
    }
  } catch (err) {
    console.warn('[renderer] channel "' + id + '" failed to build and is disabled:', err);
    return null;
  }
}

/**
 * Create a render engine bound to a canvas. One instance per Deck/Stage view.
 * @param {HTMLCanvasElement} canvas
 * @param {{demo?: boolean}} [opts] demo: build the P1 demo cube/sprite content
 *   (the Deck wants this; the Stage renders scene entities instead).
 * @returns {object} engine handle — see returned methods for the API.
 */
export function createEngine(canvas, opts = {}) {
  const withDemo = !!opts.demo;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.xr.enabled = true; // WebXR: free until a headset session actually starts
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e16);

  /**
   * Persistent home for scene content (Stage entity views live here). It is
   * NEVER cleared by mode switches — only its owner (the Stage) rebuilds it.
   */
  const contentRoot = new THREE.Group();
  contentRoot.name = 'contentRoot';
  scene.add(contentRoot);

  /* -- VR rig: while a headset session runs, the camera rides inside this
     group. The game moves the RIG to the player's feet; the headset supplies
     head position + look on top. Outside VR the rig is empty and inert. -- */
  const xrRig = new THREE.Group();
  xrRig.name = 'xrRig';
  scene.add(xrRig);
  renderer.xr.addEventListener('sessionstart', () => { xrRig.add(camera); });
  renderer.xr.addEventListener('sessionend', () => { xrRig.remove(camera); xrRig.position.set(0, 0, 0); });

  /** @type {THREE.OrthographicCamera|THREE.PerspectiveCamera} */
  let camera = makeCamera('3d', 1);
  scene.add(camera); // lets anything parented to the camera (FPS viewmodel) render

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(3, 5, 4);
  // Bounce light: hemisphere = cool sky above, warm ground reflection below —
  // the honest cheap stand-in for global illumination. Intensity is the
  // Bounce slider; 0 = off (classic flat look).
  const hemi = new THREE.HemisphereLight(0xbfd6ff, 0xc9915c, 0);
  scene.add(ambient, sun, hemi);

  /** current lighting config — see setLighting */
  let lighting = { shadows: 'off', bounce: 0, sunAngle: 40, sunHeight: 55 };

  const SHADOW_TYPES = {
    basic: THREE.BasicShadowMap,
    pcf: THREE.PCFShadowMap,
    pcfsoft: THREE.PCFSoftShadowMap,
    vsm: THREE.VSMShadowMap
  };

  /* -- light pattern (gobo/stencil): a big invisible plane, textured with a
     black/white cutout and alpha-tested, hangs above the scene and casts its
     shape through the sun using the SAME shadow map already built — window
     bars, dappled leaf-light, a scatter of stars. colorWrite:false keeps the
     plane itself unseen; only its shadow shows. Deterministic hash (not
     Math.random) so the same pattern renders byte-identical every load. -- */
  function goboHash(x, y, seed) {
    const h = Math.sin(x * 127.1 + y * 311.7 + seed * 43.7) * 43758.5453;
    return h - Math.floor(h);
  }
  function buildGoboTexture(pattern) {
    const res = 256;
    const c = document.createElement('canvas');
    c.width = c.height = res;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, res, res);
    g.fillStyle = '#fff'; // white = solid stencil (blocks light, casts shadow)
    if (pattern === 'bars') {
      const barW = res / 10;
      for (let i = 0; i < 10; i += 2) g.fillRect(i * barW, 0, barW, res);
    } else if (pattern === 'dapple') {
      for (let gy = 0; gy < 8; gy++) {
        for (let gx = 0; gx < 8; gx++) {
          const jx = goboHash(gx, gy, 1) - 0.5, jy = goboHash(gx, gy, 2) - 0.5;
          const r = 10 + goboHash(gx, gy, 3) * 14;
          g.beginPath();
          g.arc((gx + 0.5 + jx * 0.6) * (res / 8), (gy + 0.5 + jy * 0.6) * (res / 8), r, 0, Math.PI * 2);
          g.fill();
        }
      }
    } else if (pattern === 'dots') {
      for (let gy = 0; gy < 6; gy++) {
        for (let gx = 0; gx < 6; gx++) {
          const r = 6 + goboHash(gx, gy, 4) * 6;
          g.beginPath();
          g.arc((gx + 0.5) * (res / 6), (gy + 0.5) * (res / 6), r, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }
  let goboPlane = null;
  function buildGobo(cfg) {
    if (goboPlane) {
      scene.remove(goboPlane);
      goboPlane.geometry.dispose();
      if (goboPlane.material.map) goboPlane.material.map.dispose();
      goboPlane.material.dispose();
      goboPlane = null;
    }
    if (!cfg || !cfg.on || !cfg.pattern || cfg.pattern === 'none') return;
    const tex = buildGoboTexture(cfg.pattern);
    tex.repeat.set(cfg.scale || 6, cfg.scale || 6);
    const geo = new THREE.PlaneGeometry(50, 50);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ alphaMap: tex, transparent: true, alphaTest: 0.5, colorWrite: false });
    goboPlane = new THREE.Mesh(geo, mat);
    goboPlane.position.set(0, 18, 0);
    goboPlane.castShadow = true;
    goboPlane.receiveShadow = false;
    scene.add(goboPlane);
  }

  /**
   * Apply a lighting/shadow configuration. Shadow ladder, cheap→pretty:
   * off · blob (projected fake circles, toggled on tagged meshes) ·
   * basic (sharp unfiltered map) · pcf (smoothed edges) · pcfsoft
   * (softer) · vsm (blurry-soft). Bounce 0..1 drives the hemisphere
   * light and eases the flat ambient down so it doesn't wash out.
   * @param {{shadows?: string, bounce?: number, sunAngle?: number, sunHeight?: number}} cfg
   */
  function setLighting(cfg = {}) {
    lighting = { ...lighting, ...cfg };
    // volumetric haze: exponential fog thickens with distance, so far hills
    // and water melt into the air — the cheap-and-cheerful volumetrics
    buildClouds(lighting.clouds);
    buildGobo(lighting.gobo);
    const fog = lighting.fog;
    scene.fog = (fog && fog.on)
      ? new THREE.FogExp2(new THREE.Color(fog.color || '#aebdd0'), fog.density !== undefined ? fog.density : 0.02)
      : null;
    const mapped = SHADOW_TYPES[lighting.shadows];
    renderer.shadowMap.enabled = !!mapped;
    if (mapped) {
      renderer.shadowMap.type = mapped;
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const d = 25;
      sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
      sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
      sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 60;
      sun.shadow.bias = lighting.shadows === 'vsm' ? 0 : -0.0005;
      if (lighting.shadows === 'vsm') sun.shadow.blurSamples = 12;
      sun.shadow.camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
    } else {
      sun.castShadow = false;
    }
    // sun direction from angle (azimuth °) + height (elevation °)
    const az = (lighting.sunAngle || 0) * Math.PI / 180;
    const el = Math.max(5, Math.min(89, lighting.sunHeight || 55)) * Math.PI / 180;
    const r = 12;
    sun.position.set(r * Math.cos(el) * Math.cos(az), r * Math.sin(el), r * Math.cos(el) * Math.sin(az));
    // bounce vs ambient balance
    const bounce = Math.max(0, Math.min(1, lighting.bounce || 0));
    hemi.intensity = bounce * 0.9;
    ambient.intensity = 0.55 - bounce * 0.25;
    // blob shadows + changed shadow types need material/visibility refresh
    scene.traverse((obj) => {
      if (obj.userData && obj.userData.blobShadow) obj.visible = lighting.shadows === 'blob';
      if (obj.isMesh) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) if (m) m.needsUpdate = true;
      }
    });
  }

  let composer = new EffectComposer(renderer);
  let renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  /** @type {any[]} zero or more active EffectPasses. Normally exactly one
   * merged pass (cheaper); falls back to one pass per effect if the
   * postprocessing library rejects merging a specific combination — e.g.
   * Pixelate transforms UVs, Blur/DoF is a convolution effect, and the
   * library refuses to merge the two into a single pass. */
  let effectPasses = [];

  let mode = '3d';
  let demoMesh = null;
  let demoSprite = null;
  const gltfLoader = new GLTFLoader();
  const clock = new THREE.Clock();

  /* -- clouds: volume built from vertices, the honest way — each cloud is a
     cluster of squashed transparent spheres, drifting slowly and wrapping
     around the map edge. Config lives in lighting.clouds (cartridge data). -- */
  let cloudGroup = null;
  const CLOUD_SPREAD = 90; // clouds live in a big square this wide, wrapping
  function seededRand(seed) {
    let s2 = seed;
    return () => { s2 = (s2 * 16807) % 2147483647; return s2 / 2147483647; };
  }
  function buildClouds(cfg) {
    if (cloudGroup) {
      scene.remove(cloudGroup);
      cloudGroup.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
      if (cloudGroup.userData.mat) cloudGroup.userData.mat.dispose();
      cloudGroup = null;
    }
    if (!cfg || !cfg.on) return;
    cloudGroup = new THREE.Group();
    const rand = seededRand(1337);
    const puffGeo = new THREE.SphereGeometry(1, 10, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(cfg.color || '#ffffff'),
      transparent: true,
      opacity: cfg.opacity !== undefined ? cfg.opacity : 0.82,
      roughness: 1, metalness: 0,
      depthWrite: false
    });
    cloudGroup.userData.mat = mat;
    const count = Math.round(cfg.count !== undefined ? cfg.count : 14);
    for (let i = 0; i < count; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rand() * 4);
      const base = (cfg.size !== undefined ? cfg.size : 3) * (0.7 + rand() * 0.7);
      for (let j = 0; j < puffs; j++) {
        const m = new THREE.Mesh(puffGeo, mat);
        const r = base * (0.45 + rand() * 0.5);
        m.scale.set(r, r * 0.55, r); // squashed: flat-bottomed puffy tops
        m.position.set((rand() - 0.5) * base * 2.2, (rand() - 0.5) * base * 0.4, (rand() - 0.5) * base * 1.4);
        cloud.add(m);
      }
      cloud.position.set(
        (rand() - 0.5) * CLOUD_SPREAD,
        (cfg.height !== undefined ? cfg.height : 14) + (rand() - 0.5) * 3,
        (rand() - 0.5) * CLOUD_SPREAD
      );
      cloudGroup.add(cloud);
    }
    cloudGroup.userData.drift = cfg.drift !== undefined ? cfg.drift : 0.5;
    scene.add(cloudGroup);
  }

  /**
   * @param {'2d'|'3d'} m
   * @param {number} aspect
   * @returns {THREE.OrthographicCamera|THREE.PerspectiveCamera}
   */
  function makeCamera(m, aspect) {
    if (m === '2d') {
      const halfH = 3;
      const halfW = halfH * aspect;
      const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 100);
      cam.position.set(0, 0, 10);
      cam.lookAt(0, 0, 0);
      return cam;
    }
    const cam = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
    cam.position.set(2.4, 1.8, 2.4);
    cam.lookAt(0, 0, 0);
    return cam;
  }

  /** Rebuild the EffectPass(es) from a list of channel ids. Cheap to call often. */
  function rebuildChannels(channelIds) {
    for (const p of effectPasses) { composer.removePass(p); p.dispose(); }
    effectPasses = [];
    const effects = CHANNEL_IDS
      .filter((id) => channelIds.includes(id))
      .map((id) => buildEffect(id, camera))
      .filter(Boolean);
    if (!effects.length) return;
    try {
      const merged = new EffectPass(camera, ...effects);
      composer.addPass(merged);
      effectPasses = [merged];
    } catch (err) {
      // Some effect combinations can't share one pass (e.g. Pixelate +
      // Blur — see the file-level note above). Fall back to one pass per
      // effect instead of losing the whole channel stack to a crash.
      console.warn('[renderer] channels could not merge into one pass, falling back to one pass per effect:', err);
      effectPasses = effects.map((effect) => {
        const pass = new EffectPass(camera, effect);
        composer.addPass(pass);
        return pass;
      });
    }
  }

  /**
   * Switch camera dimension. contentRoot is untouched; demo content (when this
   * engine was created with demo) is rebuilt to match the mode.
   * @param {'2d'|'3d'} m
   */
  function setMode(m) {
    mode = m === '2d' ? '2d' : '3d';
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    scene.remove(camera);
    camera = makeCamera(mode, aspect);
    scene.add(camera);
    composer.removeAllPasses();
    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    effectPasses = []; // caller re-applies channels via rebuildChannels after mode switch
    if (withDemo) {
      clearDemoContent();
      if (mode === '2d') buildDemoSprite(); else buildDemoCube();
    }
  }

  function clearDemoContent() {
    if (demoMesh) { scene.remove(demoMesh); demoMesh = null; }
    if (demoSprite) { scene.remove(demoSprite); demoSprite = null; }
  }

  /** Build the fallback demo cube (used until/unless a real GLB is loaded). */
  function buildDemoCube() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6fb2dc, roughness: 0.55, metalness: 0.15 });
    demoMesh = new THREE.Mesh(geo, mat);
    scene.add(demoMesh);
  }

  /** Build the 2D demo sprite: a canvas-drawn coin on a plane. */
  function buildDemoSprite() {
    const tex = makeCanvasTexture((ctx, size) => {
      ctx.clearRect(0, 0, size, size);
      const r = size * 0.36;
      const cx = size / 2, cy = size / 2;
      const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      grad.addColorStop(0, '#ffe9a8');
      grad.addColorStop(1, '#e0a83a');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8a6416';
      ctx.lineWidth = size * 0.03;
      ctx.stroke();
      ctx.fillStyle = '#8a6416';
      ctx.font = 'bold ' + Math.round(size * 0.4) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', cx, cy + size * 0.02);
    });
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    demoSprite = new THREE.Mesh(geo, mat);
    scene.add(demoSprite);
  }

  /**
   * Create a CanvasTexture from a draw callback. This IS the 2D sprite path —
   * no image asset pipeline required yet.
   * @param {(ctx: CanvasRenderingContext2D, size: number) => void} drawFn
   * @param {number} [size]
   * @returns {THREE.CanvasTexture}
   */
  function makeCanvasTexture(drawFn, size = 128) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    drawFn(ctx, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Load a GLB from a URL and place it in the scene, replacing the demo mesh.
   * Deck demo path — Stage entity models get their own loader when real GLB
   * warehouse packs land.
   * @param {string} url
   * @returns {Promise<{ok: boolean, meshes: number, vertices: number, triangles: number, error?: string}>}
   */
  function loadGLB(url) {
    return new Promise((resolve) => {
      gltfLoader.load(
        url,
        (gltf) => {
          clearDemoContent();
          demoMesh = gltf.scene;
          scene.add(demoMesh);
          let meshes = 0, vertices = 0, triangles = 0;
          demoMesh.traverse((obj) => {
            if (obj.isMesh) {
              meshes++;
              const geo = obj.geometry;
              vertices += geo.attributes.position ? geo.attributes.position.count : 0;
              triangles += geo.index ? geo.index.count / 3 : (geo.attributes.position ? geo.attributes.position.count / 3 : 0);
            }
          });
          resolve({ ok: true, meshes, vertices, triangles });
        },
        undefined,
        (err) => {
          console.warn('[renderer] GLB load failed', err);
          resolve({ ok: false, meshes: 0, vertices: 0, triangles: 0, error: String(err && err.message || err) });
        }
      );
    });
  }

  /** @param {keyof typeof TONE_MAPS} name */
  function setToneMap(name) {
    renderer.toneMapping = TONE_MAPS[name] !== undefined ? TONE_MAPS[name] : THREE.NoToneMapping;
  }

  /**
   * @param {number} width
   * @param {number} height
   */
  function resize(width, height) {
    if (width <= 0 || height <= 0) return;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    if (camera.isPerspectiveCamera) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    } else {
      const halfH = 3;
      const halfW = halfH * (width / height);
      camera.left = -halfW; camera.right = halfW;
      camera.top = halfH; camera.bottom = -halfH;
      camera.updateProjectionMatrix();
    }
  }

  /** Advance one frame. The caller owns the requestAnimationFrame loop. */
  /** AnimationMixers for placed characters — updated every frame */
  const mixers = new Set();

  function tick() {
    const dt = clock.getDelta();
    for (const m of mixers) m.update(dt);
    if (cloudGroup) {
      for (const cloud of cloudGroup.children) {
        cloud.position.x += cloudGroup.userData.drift * dt;
        if (cloud.position.x > CLOUD_SPREAD / 2) cloud.position.x = -CLOUD_SPREAD / 2;
      }
    }
    if (withDemo) {
      if (demoMesh && mode === '3d') {
        demoMesh.rotation.y += dt * 0.6;
        demoMesh.rotation.x += dt * 0.25;
      }
      if (demoSprite && mode === '2d') {
        demoSprite.rotation.z = Math.sin(clock.elapsedTime * 0.8) * 0.15;
      }
    }
    if (renderer.xr.isPresenting) {
      // the composer's post passes can't drive a stereo headset — render direct
      renderer.render(scene, camera);
    } else {
      composer.render(dt);
    }
    return dt;
  }

  function dispose() {
    buildGobo(null); // tears down the gobo plane + its texture, if one exists
    for (const p of effectPasses) p.dispose();
    composer.dispose();
    renderer.dispose();
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }

  // initial content
  if (withDemo) buildDemoCube();

  return {
    get renderer() { return renderer; },
    get xrPresenting() { return renderer.xr.isPresenting; },
    get xrRig() { return xrRig; },
    /** which way the headset is facing (yaw radians), or null outside VR */
    headsetYaw() {
      if (!renderer.xr.isPresenting) return null;
      const q = new THREE.Quaternion();
      camera.getWorldQuaternion(q);
      return new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    },
    get scene() { return scene; },
    get camera() { return camera; },
    get mode() { return mode; },
    get contentRoot() { return contentRoot; },
    get mixers() { return mixers; },
    setLighting,
    get lighting() { return lighting; },
    setMode,
    rebuildChannels,
    setToneMap,
    loadGLB,
    makeCanvasTexture,
    resize,
    tick,
    dispose
  };
}
