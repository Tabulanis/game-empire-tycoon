/**
 * @file meshes.js
 * @description Entity -> Object3D construction and transform sync — the part
 * of scene rendering that is NOT editor-only. Both the Stage (editor/stage.js,
 * with its selection gizmos and tile-painting UI layered on top) and the real
 * game runtime (runtime.js, which the exported single-file cartridge also
 * runs) build their views through this module. Extracted out of stage.js in
 * Phase 3 because runtime.js must never import from editor/ — the Cartridge
 * Press ships a game that has no editor code in it at all.
 * Ticket P3-5 (architecture fix alongside the runtime build). Originally
 * written as part of P2-2.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LOGIC_COLORS, findEntity } from './entities.js';

/**
 * @typedef {Object} SceneView
 * @property {Map<string, THREE.Object3D>} objects entityId -> root object
 * @property {(id: string) => void} refreshEntity rebuild one entity's object
 * @property {() => void} clear remove everything from the content root
 */

/**
 * Build (or rebuild) the renderable view of a scene inside the engine's
 * content root. Edit view includes logic entities; play view hides them
 * (visible in edit, invisible in play — P2-6).
 * @param {any} engine renderer engine handle
 * @param {{entities: Array<any>}} scene
 * @param {{play?: boolean}} [opts]
 * @returns {SceneView}
 */
/**
 * The scene's ground: a textured plane. terrain = {texture (dataURL)|null,
 * mode: 'stretch'|'repeat'|'grid', repeat, cell, size: [w, d], color}.
 * Stretch lays the picture once across the whole ground; repeat tiles it N
 * times; grid tiles it one-per-grid-cell so it lines up with snapping.
 * @param {any} terrain
 * @returns {THREE.Mesh}
 */
export const SPLAT_SIZE = 256;

/**
 * Smooth terrain: a displaced plane with real gradient slopes (vertex
 * heights bilinearly sampled from the cell heights) and splat-mapped
 * painting — a soft RGB mask where each channel is one texture layer's
 * opacity, blended in the standard material's own fragment stage via
 * onBeforeCompile so lighting and shadows stay fully PBR. Layer diffuse
 * comes from plain textures OR Material Maker shaders alike.
 * @param {any} terrain
 * @returns {THREE.Mesh}
 */
/** Bilinear height sampler over cell-center heights — the single source of
 * truth for the smooth terrain's surface, shared by the visual mesh and the
 * physics collider so they can never disagree.
 * @param {any} terrain @returns {(x: number, z: number) => number} */
export function terrainHeightSampler(terrain) {
  const size = terrain.size || [20, 20];
  const cell = terrain.cell || 1;
  const cellH = (row, col) => {
    const c = (terrain.cells || {})[row + ',' + col];
    return c ? (c.h || 0) * 0.5 : 0;
  };
  return (x, z) => {
    const fx = (x + size[0] / 2) / cell - 0.5;
    const fz = (z + size[1] / 2) / cell - 0.5;
    const c0 = Math.floor(fx), r0 = Math.floor(fz);
    const tx = fx - c0, tz = fz - r0;
    const h00 = cellH(r0, c0), h10 = cellH(r0, c0 + 1);
    const h01 = cellH(r0 + 1, c0), h11 = cellH(r0 + 1, c0 + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };
}

/**
 * Collision data for a scene's terrain, in plain arrays the physics layer can
 * feed straight to Rapier without touching three.js: a flat base slab plus
 * per-cell boxes for blocky ground, or an exact triangle mesh of the sculpted
 * surface for smooth ground.
 * @param {any} terrain
 * @returns {{boxes: Array<{c: number[], h: number[]}>, trimesh: {vertices: Float32Array, indices: Uint32Array}|null}}
 */
export function buildTerrainCollision(terrain) {
  const size = terrain.size || [20, 20];
  const cell = terrain.cell || 1;
  const boxes = [];
  // base slab: top face exactly at y=0 so flat ground is always walkable
  boxes.push({ c: [0, -0.5, 0], h: [size[0] / 2, 0.5, size[1] / 2] });
  if (terrain.smooth) {
    const cols = Math.max(1, Math.ceil(size[0] / cell));
    const rows = Math.max(1, Math.ceil(size[1] / cell));
    const geo = new THREE.PlaneGeometry(size[0], size[1], cols * 2, rows * 2);
    geo.rotateX(-Math.PI / 2);
    const heightAt = terrainHeightSampler(terrain);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    const trimesh = {
      vertices: new Float32Array(pos.array),
      indices: new Uint32Array(geo.index.array)
    };
    geo.dispose();
    return { boxes, trimesh };
  }
  for (const [key, c] of Object.entries(terrain.cells || {})) {
    const hasLayer = (c.l != null ? c.l : c.t) != null;
    if (!hasLayer && !(c.h > 0)) continue;
    const [row, col] = key.split(',').map(Number);
    const height = Math.max(0.1, (c.h || 0) * 0.5);
    boxes.push({
      c: [-size[0] / 2 + (col + 0.5) * cell, height / 2, -size[1] / 2 + (row + 0.5) * cell],
      h: [cell / 2, height / 2, cell / 2]
    });
  }
  return { boxes, trimesh: null };
}

function buildSmoothTerrainMesh(terrain) {
  const size = terrain.size || [20, 20];
  const cell = terrain.cell || 1;
  const cols = Math.max(1, Math.ceil(size[0] / cell));
  const rows = Math.max(1, Math.ceil(size[1] / cell));
  const heightAt = terrainHeightSampler(terrain);

  // one displaced geometry per repeat factor: uv channel 1 carries the
  // repeat baked in, so each layer's picture tiles at its own rate while
  // the alpha mask (channel 0) always spans the whole ground exactly once
  const makeGeo = (repeat) => {
    const geo = new THREE.PlaneGeometry(size[0], size[1], cols * 2, rows * 2);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const uv = geo.getAttribute('uv');
    const uv1 = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) {
      uv1[i * 2] = uv.getX(i) * repeat;
      uv1[i * 2 + 1] = uv.getY(i) * repeat;
    }
    geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    return geo;
  };

  const loadTex = (data, srgb) => {
    const t = new THREE.TextureLoader().load(data);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.channel = 1; // sample via the repeat-baked uv set
    return t;
  };

  const group = new THREE.Group();
  const repeatFor = (mode, rep) => mode === 'grid' ? Math.max(cols, rows) : (mode === 'tiled' ? (rep || 6) : 1);

  // base coat
  const baseRepeat = repeatFor(terrain.mode || 'stretch', terrain.repeat);
  const baseMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  if (terrain.texture) {
    baseMat.map = loadTex(terrain.texture, true);
    baseMat.color = new THREE.Color('#ffffff');
  } else {
    baseMat.color = new THREE.Color(terrain.color || '#3a3f4c');
  }
  const baseMesh = new THREE.Mesh(makeGeo(baseRepeat), baseMat);
  baseMesh.receiveShadow = true;
  baseMesh.userData.terrain = true;
  group.add(baseMesh);

  // up to three painted layers, each: its own picture at its own tiling,
  // shown only where its white-on-black alpha mask says so
  const maskTextures = [];
  const layers = terrain.layers || [];
  for (let i = 0; i < 3; i++) {
    const layer = layers[i];
    if (!layer) { maskTextures.push(null); continue; }
    const src = layer.maps ? layer.maps.diffuse : layer.dataURL;
    if (!src) { maskTextures.push(null); continue; }
    let maskTex;
    if (terrain.masks && terrain.masks[i]) {
      maskTex = new THREE.TextureLoader().load(terrain.masks[i]);
    } else {
      const c = document.createElement('canvas');
      c.width = c.height = SPLAT_SIZE;
      maskTex = new THREE.CanvasTexture(c); // starts fully black = invisible
    }
    maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
    const m = new THREE.MeshStandardMaterial({
      map: loadTex(src, true),
      alphaMap: maskTex,           // green channel; white blobs = visible
      transparent: true,
      depthWrite: false,
      roughness: 0.95, metalness: 0
    });
    const mesh = new THREE.Mesh(makeGeo(repeatFor(layer.map || 'grid', layer.repeat)), m);
    mesh.position.y = 0.001 * (i + 1);
    mesh.renderOrder = i + 1;
    mesh.receiveShadow = true;
    mesh.userData.terrain = true;
    group.add(mesh);
    maskTextures.push(maskTex);
  }

  group.position.y = -0.01;
  group.userData.terrain = true;
  group.userData.maskTextures = maskTextures;
  return group;
}

export function buildTerrainMesh(terrain) {
  if (terrain.smooth) return buildSmoothTerrainMesh(terrain);
  const size = terrain.size || [20, 20];
  const geo = new THREE.PlaneGeometry(size[0], size[1]);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(terrain.texture ? '#ffffff' : (terrain.color || '#3a3f4c')),
    roughness: 0.95, metalness: 0
  });
  if (terrain.texture) {
    const tex = new THREE.TextureLoader().load(terrain.texture);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const mode = terrain.mode || 'stretch';
    if (mode === 'repeat') {
      const n = terrain.repeat || 4;
      tex.repeat.set(n, n);
    } else if (mode === 'grid') {
      const cell = terrain.cell || 1;
      tex.repeat.set(size[0] / cell, size[1] / cell);
    }
    mat.map = tex;
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.01; // a hair under the entities so nothing z-fights
  mesh.userData.terrain = true;
  mesh.receiveShadow = true;

  // Grid mode's painted/sculpted cells: each is a box slab — textured from
  // the terrain's numbered palette slots, raised in 0.5-unit steps.
  if (terrain.cells && Object.keys(terrain.cells).length) {
    const group = new THREE.Group();
    group.add(mesh);
    mesh.rotation.x = -Math.PI / 2; // (re-set: mesh keeps its own transform inside the group)
    const cell = terrain.cell || 1;
    const layerTextures = {};
    const layerTexture = (slotIndex) => {
      if (layerTextures[slotIndex]) return layerTextures[slotIndex];
      const slot = (terrain.layers || terrain.palette || [])[slotIndex];
      if (!slot || !slot.dataURL) return (layerTextures[slotIndex] = null);
      const tex = new THREE.TextureLoader().load(slot.dataURL);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      layerTextures[slotIndex] = tex;
      return tex;
    };
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(terrain.color || '#3a3f4c'), roughness: 0.95
    });
    const slotMaterial = (slotIndex, row, col) => {
      const slot = (terrain.layers || terrain.palette || [])[slotIndex];
      if (slot && slot.maps) {
        // a Material Maker shader painting the ground
        const m2 = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
        const loadMap = (data, srgb) => {
          const t = new THREE.TextureLoader().load(data);
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          t.magFilter = THREE.NearestFilter;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          return t;
        };
        if (slot.maps.diffuse) m2.map = loadMap(slot.maps.diffuse, true);
        if (slot.maps.roughness) { m2.roughnessMap = loadMap(slot.maps.roughness); }
        if (slot.maps.specular) { m2.metalnessMap = loadMap(slot.maps.specular); m2.metalness = 1; }
        if (slot.maps.normal) m2.normalMap = loadMap(slot.maps.normal);
        return m2;
      }
      const tex = layerTexture(slotIndex);
      if (!tex) return baseMaterial;
      const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 });
      const mapMode = (slot && slot.map) || 'grid';
      if (mapMode === 'grid') {
        m.map = tex; // box UVs are already one image per cell
      } else {
        // window this cell into the layer's ground-wide image
        const cols = Math.ceil(size[0] / cell), rows = Math.ceil(size[1] / cell);
        const n = mapMode === 'tiled' ? ((slot && slot.repeat) || 6) : 1;
        const t2 = tex.clone();
        t2.needsUpdate = true;
        t2.repeat.set((n / cols), (n / rows));
        t2.offset.set((col * n / cols) % 1, ((rows - 1 - row) * n / rows) % 1);
        m.map = t2;
      }
      return m;
    };
    for (const [key, c] of Object.entries(terrain.cells)) {
      const layerIdx = c.l != null ? c.l : c.t;
      if (layerIdx == null && !(c.h > 0)) continue;
      const [row, col] = key.split(',').map(Number);
      const height = Math.max(0.1, (c.h || 0) * 0.5);
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(cell, height, cell),
        layerIdx == null ? baseMaterial : slotMaterial(layerIdx, row, col)
      );
      box.position.set(
        -size[0] / 2 + (col + 0.5) * cell,
        height / 2,
        -size[1] / 2 + (row + 0.5) * cell
      );
      box.userData.terrain = true;
      box.castShadow = true;
      box.receiveShadow = true;
      group.add(box);
    }
    group.userData.terrain = true;
    return group;
  }
  return mesh;
}

export function buildSceneView(engine, scene, opts = {}) {
  const root = engine.contentRoot;
  clearGroup(root);
  /** @type {Map<string, THREE.Object3D>} */
  const objects = new Map();

  let terrainMesh = null;
  const applyTerrain = (sc) => {
    if (terrainMesh) { root.remove(terrainMesh); disposeObject(terrainMesh); terrainMesh = null; }
    if (sc.terrain) {
      terrainMesh = buildTerrainMesh(sc.terrain);
      root.add(terrainMesh);
    }
  };
  applyTerrain(scene);

  for (const entity of scene.entities) {
    if (opts.play && entity.components.logic) continue;
    const obj = buildEntityObject(engine, entity);
    if (!obj) continue;
    root.add(obj);
    objects.set(entity.id, obj);
  }

  return {
    objects,
    refreshEntity(id) {
      const old = objects.get(id);
      if (old) { root.remove(old); disposeObject(old); objects.delete(id); }
      const entity = findEntity(scene, id);
      if (!entity || (opts.play && entity.components.logic)) return;
      const obj = buildEntityObject(engine, entity);
      if (!obj) return;
      root.add(obj);
      objects.set(id, obj);
    },
    refreshTerrain(sc) {
      applyTerrain(sc || scene);
    },
    clear() {
      clearGroup(root);
      objects.clear();
    }
  };
}

/** @param {THREE.Object3D} group */
function clearGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject(child);
  }
}

/** @param {THREE.Object3D} obj */
function disposeObject(obj) {
  if (obj.userData && obj.userData.mixer && obj.userData.mixer._root) {
    obj.userData.mixer.stopAllAction();
  }
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
    }
  });
}

/**
 * Build the Object3D for one entity from its components.
 * @param {any} engine
 * @param {any} entity
 * @returns {THREE.Object3D|null}
 */
const _glbCache = new Map();
/** @param {{id: string, glb: string}} record @returns {Promise<{scene: any, clips: any[]}>} */
function loadCharacterGLB(record) {
  if (_glbCache.has(record.id)) return _glbCache.get(record.id);
  const promise = fetch(record.glb)
    .then((r) => r.arrayBuffer())
    .then((buffer) => new Promise((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', (gltf) => resolve({ scene: gltf.scene, clips: gltf.animations || [] }), reject);
    }));
  _glbCache.set(record.id, promise);
  return promise;
}

let _blobTexture = null;
function blobShadowTexture() {
  if (_blobTexture) return _blobTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _blobTexture = new THREE.CanvasTexture(c);
  return _blobTexture;
}

export function buildEntityObject(engine, entity) {
  const group = new THREE.Group();
  group.name = entity.id;
  group.userData.entityId = entity.id;
  const c = entity.components;

  if (c.tilemap) group.add(buildTilemapMesh(c.tilemap));
  if (c.sprite) group.add(buildSpriteMesh(engine, c.sprite));
  if (c.model && c.model.asset && typeof engine.resolveModelAsset === 'function') {
    // a saved character: GLB decoded once per asset, cloned per placement
    // (SkeletonUtils.clone keeps skinned meshes bound to their own bones),
    // its clip playing through the engine's mixer registry
    const record = engine.resolveModelAsset(c.model.asset);
    if (record && record.glb) {
      loadCharacterGLB(record).then(({ scene, clips }) => {
        const inst = SkeletonUtils.clone(scene);
        const box = new THREE.Box3().setFromObject(inst);
        const height = Math.max(0.001, box.max.y - box.min.y);
        const scale = (c.model.height || 1.2) / height;
        inst.scale.setScalar(scale);
        box.setFromObject(inst);
        inst.position.y -= box.min.y;
        inst.traverse((obj) => { if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; } });
        group.add(inst);
        if (clips.length && engine.mixers) {
          const mixer = new THREE.AnimationMixer(inst);
          const wanted = c.model.clip && clips.find((cl) => cl.name === c.model.clip);
          mixer.clipAction(wanted || clips[0]).play();
          engine.mixers.add(mixer);
          group.userData.mixer = mixer; // disposed with the object
        }
      }).catch(() => {});
    }
  } else if (c.model) group.add(buildModelMesh(c.model));

  // shadow participation + a hidden blob plane (visible only in blob mode —
  // engine.setLighting toggles them, so no scene rebuild on switching)
  group.traverse((obj) => {
    if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
  });
  {
    const box = new THREE.Box3().setFromObject(group);
    const w = Math.max(0.3, (box.max.x - box.min.x) || 0.6);
    const d = Math.max(0.3, (box.max.z - box.min.z) || 0.6);
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 1.15, d * 1.15),
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = (isFinite(box.min.y) ? box.min.y : 0) + 0.012;
    blob.userData.blobShadow = true;
    blob.visible = engine && engine.lighting ? engine.lighting.shadows === 'blob' : false;
    group.add(blob);
  }
  if (c.logic) group.add(buildLogicMesh(engine, c.logic));

  if (group.children.length === 0) {
    // component-less entity: a small wire marker so it is still selectable
    const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const mat = new THREE.MeshBasicMaterial({ color: 0x8a95ad, wireframe: true });
    group.add(new THREE.Mesh(geo, mat));
  }

  syncTransform(group, entity, engine.mode);
  return group;
}

/**
 * Placeholder sprite card: swatch fill, soft border, optional glyph.
 * Real image assets ride this same mesh once warehouse packs carry paths.
 * @param {any} engine
 * @param {any} sprite
 * @returns {THREE.Mesh}
 */
function buildSpriteMesh(engine, sprite) {
  const tex = engine.makeCanvasTexture((ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = sprite.swatch || '#6fb2dc';
    roundRect(ctx, size * 0.06, size * 0.06, size * 0.88, size * 0.88, size * 0.12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = size * 0.03;
    ctx.stroke();
    if (sprite.glyph) {
      ctx.fillStyle = 'rgba(16,19,26,0.8)';
      ctx.font = 'bold ' + Math.round(size * 0.5) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sprite.glyph, size / 2, size / 2);
    }
  });
  const size = sprite.size || [1, 1];
  const geo = new THREE.PlaneGeometry(size[0], size[1]);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const mesh = new THREE.Mesh(geo, mat);

  // Real Atelier-authored art, when the caller has wired a resolver (the
  // Stage during editing, or the exported game reading its baked-in
  // cartridge). Swapped in once loaded — the swatch card above renders
  // immediately so nothing pops in empty while the real texture decodes.
  if (sprite.asset && typeof engine.resolveSpriteAsset === 'function') {
    const dataUrl = engine.resolveSpriteAsset(sprite.asset);
    if (dataUrl) {
      new THREE.TextureLoader().load(dataUrl, (loaded) => {
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.magFilter = THREE.NearestFilter; // crisp pixel art, no blur
        loaded.minFilter = THREE.NearestFilter;
        mat.map.dispose();
        mat.map = loaded;
        mat.needsUpdate = true;
      });
    }
  }

  return mesh;
}

/**
 * @param {any} model
 * @returns {THREE.Mesh}
 */
/**
 * One primitive's geometry. The full Kit Bay set: box, sphere, cylinder,
 * cone, wedge (half-box ramp), plane, torus, capsule.
 * @param {string} shape @param {number[]} size
 * @returns {THREE.BufferGeometry}
 */
/**
 * A box whose 8 corners have been dragged around (Kit Bay edit mode).
 * corners[i] are local offsets from the default corner positions, indexed by
 * bit pattern i = (x+?1:0) | (y+?2:0) | (z+?4:0). Keeps BoxGeometry's
 * 6-group material order (+x -x +y -y +z -z) and per-face 0..1 UVs, and
 * auto-corrects winding so no face ever shades inside-out.
 * @param {number[]} size @param {Array<number[]>} corners
 * @returns {THREE.BufferGeometry}
 */
function buildHexahedronGeo(size, corners) {
  const c = [];
  for (let i = 0; i < 8; i++) {
    const sx = (i & 1) ? 1 : -1, sy = (i & 2) ? 1 : -1, sz = (i & 4) ? 1 : -1;
    const off = (corners && corners[i]) || [0, 0, 0];
    c.push([sx * size[0] / 2 + off[0], sy * size[1] / 2 + off[1], sz * size[2] / 2 + off[2]]);
  }
  // face quads in BoxGeometry material order, with outward axis for winding checks
  const faces = [
    { q: [1, 5, 7, 3], axis: [1, 0, 0] },   // +x
    { q: [0, 2, 6, 4], axis: [-1, 0, 0] },  // -x
    { q: [2, 3, 7, 6], axis: [0, 1, 0] },   // +y
    { q: [0, 4, 5, 1], axis: [0, -1, 0] },  // -y
    { q: [4, 6, 7, 5], axis: [0, 0, 1] },   // +z
    { q: [0, 1, 3, 2], axis: [0, 0, -1] }   // -z
  ];
  const pos = [], uv = [];
  const geo = new THREE.BufferGeometry();
  faces.forEach((face, f) => {
    let [a, b, d, e] = face.q;
    // winding check: does this quad's normal point along the outward axis?
    const ab = [c[b][0] - c[a][0], c[b][1] - c[a][1], c[b][2] - c[a][2]];
    const ad = [c[d][0] - c[a][0], c[d][1] - c[a][1], c[d][2] - c[a][2]];
    const n = [ab[1] * ad[2] - ab[2] * ad[1], ab[2] * ad[0] - ab[0] * ad[2], ab[0] * ad[1] - ab[1] * ad[0]];
    if (n[0] * face.axis[0] + n[1] * face.axis[1] + n[2] * face.axis[2] < 0) {
      [b, e] = [e, b];
    }
    const quad = [a, b, d, e];
    const quadUv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const tri of [[0, 1, 2], [0, 2, 3]]) {
      for (const k of tri) {
        pos.push(...c[quad[k]]);
        uv.push(...quadUv[k]);
      }
    }
    geo.addGroup(f * 6, 6, f);
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Modifiers: bend the finished geometry the way a light 3D program does.
 * mods = {taper: -1..1 (squeeze top/bottom), twist: radians of Y-twist over
 * the height, bumpy: 0..1 random surface jitter}. Works on every shape.
 * @param {THREE.BufferGeometry} geo @param {any} mods @param {number[]} size
 */
function applyModifiers(geo, mods, size) {
  if (!mods) return geo;
  const taper = mods.taper || 0, twist = mods.twist || 0, bumpy = mods.bumpy || 0;
  if (!taper && !twist && !bumpy) return geo;
  const posAttr = geo.getAttribute('position');
  const halfH = Math.max(0.001, size[1] / 2);
  let seed = 1234;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
  for (let i = 0; i < posAttr.count; i++) {
    let x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    const t = Math.max(-1, Math.min(1, y / halfH)); // -1 bottom .. 1 top
    if (taper) {
      const k = 1 - taper * (t + 1) / 2; // 1 at bottom .. 1-taper at top
      x *= k; z *= k;
    }
    if (twist) {
      const ang = twist * (t + 1) / 2;
      const nx = x * Math.cos(ang) - z * Math.sin(ang);
      const nz = x * Math.sin(ang) + z * Math.cos(ang);
      x = nx; z = nz;
    }
    if (bumpy) {
      const amp = bumpy * 0.06 * Math.max(size[0], size[1], size[2]);
      x += rand() * amp; y += rand() * amp; z += rand() * amp;
    }
    posAttr.setXYZ(i, x, y, z);
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function buildPartGeo(shape, size, bevel, part) {
  if (shape === 'box' && part && part.corners && !(bevel > 0)) {
    return applyModifiers(buildHexahedronGeo(size, part.corners), part && part.mods, size);
  }
  if (shape === 'box' && bevel > 0) {
    const radius = Math.min(bevel, Math.min(size[0], size[1], size[2]) / 2 - 0.01);
    if (radius > 0.005) return new RoundedBoxGeometry(size[0], size[1], size[2], 3, radius);
  }
  switch (shape) {
    case 'sphere':
      return new THREE.SphereGeometry(Math.max(size[0], size[1], size[2]) / 2, 20, 16);
    case 'cylinder':
      return new THREE.CylinderGeometry(size[0] / 2, size[0] / 2, size[1], 20);
    case 'cone':
      return new THREE.ConeGeometry(size[0] / 2, size[1], 20);
    case 'plane': {
      const g = new THREE.BoxGeometry(size[0], Math.min(0.02, size[1]), size[2]);
      return g;
    }
    case 'torus':
      return new THREE.TorusGeometry(size[0] / 2, Math.max(0.02, size[1] / 4), 12, 24);
    case 'capsule':
      return new THREE.CapsuleGeometry(size[0] / 2, size[1], 6, 12);
    case 'wedge': {
      // Triangular prism ramp: box with the top-front edge collapsed.
      const [w, h, d] = size;
      const x = w / 2, y = h / 2, z = d / 2;
      const verts = new Float32Array([
        // bottom (two tris)
        -x, -y, -z,  x, -y,  z,  x, -y, -z,   -x, -y, -z, -x, -y,  z,  x, -y,  z,
        // back face
        -x, -y, -z,  x, -y, -z,  x,  y, -z,   -x, -y, -z,  x,  y, -z, -x,  y, -z,
        // slope
        -x,  y, -z,  x,  y, -z,  x, -y,  z,   -x,  y, -z,  x, -y,  z, -x, -y,  z,
        // sides
        -x, -y, -z, -x,  y, -z, -x, -y,  z,    x, -y, -z,  x, -y,  z,  x,  y, -z
      ]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      g.computeVertexNormals();
      return g;
    }
    default:
      return new THREE.BoxGeometry(size[0], size[1], size[2]);
  }
}

/** buildPartGeo plus the part's modifiers — the compound path's entry. */
function buildPartGeoFull(part) {
  const shape = part.shape || 'box';
  const size = part.size || [1, 1, 1];
  const geo = buildPartGeo(shape, size, part.bevel || 0, part);
  if (!(shape === 'box' && part.corners && !(part.bevel > 0))) {
    applyModifiers(geo, part.mods, size);
  }
  return geo;
}

export function buildModelMesh(model) {
  // Compound Kit Bay models: a parts array with parent links builds a real
  // nested THREE.Group — move a parent part, its children ride along.
  if (Array.isArray(model.parts) && model.parts.length) {
    const nodes = model.parts.map((part, index) => {
      const mat = part.mat || {};
      // Texture with a movable placement: the geometry's own UVs are the
      // "basic unwrap" (BoxGeometry per-face 0..1, SphereGeometry equirect);
      // uv = {ox, oy, scale, rot} slides/scales/spins it on the surface.
      const applyTexture = (material, texData, uv) => {
        const tex = new THREE.TextureLoader().load(texData);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;  // pixel art stays crisp
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.center.set(0.5, 0.5);
        if (uv) {
          tex.offset.set(uv.ox || 0, uv.oy || 0);
          const sc = uv.scale || 1;
          tex.repeat.set(sc, sc);
          tex.rotation = uv.rot || 0;
        }
        material.map = tex;
        material.color = new THREE.Color('#ffffff');
      };
      const makeBase = () => {
        const m = buildModelMaterial({ swatch: part.swatch, shader: null });
        if (mat.rough != null) m.roughness = mat.rough;
        if (mat.metal != null) m.metalness = mat.metal;
        if (mat.glow) {
          m.emissive = new THREE.Color(part.swatch || '#6fb2dc');
          m.emissiveIntensity = mat.glow;
        }
        // Material Maker output: full PBR map set baked into the part data
        if (mat.matMaps) {
          const loadMap = (data, srgb) => {
            const tex = new THREE.TextureLoader().load(data);
            if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            return tex;
          };
          if (mat.matMaps.diffuse) { m.map = loadMap(mat.matMaps.diffuse, true); m.color = new THREE.Color('#ffffff'); }
          if (mat.matMaps.specular) { m.metalnessMap = loadMap(mat.matMaps.specular); m.metalness = 1; }
          if (mat.matMaps.roughness) { m.roughnessMap = loadMap(mat.matMaps.roughness); m.roughness = 1; }
          if (mat.matMaps.normal) m.normalMap = loadMap(mat.matMaps.normal);
        }
        return m;
      };
      const shape = part.shape || 'box';
      let material;
      if (shape === 'box' && !(part.bevel > 0)) {
        // Boxes always carry a 6-material array so a raycast hit's
        // materialIndex IS the face — and each face can wear its own
        // texture with its own placement. Group order: +x -x +y -y +z -z.
        material = [];
        for (let f = 0; f < 6; f++) {
          const m = makeBase();
          const face = part.faces && part.faces[f];
          if (face && face.textureData) applyTexture(m, face.textureData, face);
          else if (mat.textureData) applyTexture(m, mat.textureData, mat.uv);
          material.push(m);
        }
      } else {
        material = makeBase();
        if (mat.textureData) applyTexture(material, mat.textureData, mat.uv);
      }
      const mesh = new THREE.Mesh(buildPartGeoFull(part), material);
      mesh.userData.partIndex = index; // raycast picking in the Kit Bay
      const holder = new THREE.Group();
      holder.add(mesh);
      const p = part.p || [0, 0, 0], r = part.r || [0, 0, 0];
      holder.position.set(p[0], p[1], p[2]);
      holder.rotation.set(r[0], r[1], r[2]);
      if (part.joint === 'spin') {
        // Hinge constraint: runtime/preview loops spin this holder on its axis.
        holder.userData.spin = { axis: part.axis || 'y', speed: part.speed == null ? 1 : part.speed };
      }
      return holder;
    });
    const root = new THREE.Group();
    model.parts.forEach((part, i) => {
      const parent = part.parent != null && part.parent >= 0 && part.parent !== i ? nodes[part.parent] : null;
      (parent || root).add(nodes[i]);
    });
    return root;
  }

  const geo = buildPartGeo(model.shape || 'box', model.size || [1, 1, 1]);
  const mat = buildModelMaterial(model);
  const mesh = new THREE.Mesh(geo, mat);
  if (model.shader) mesh.userData.animatedMaterial = true; // tick() needs to feed it a live time uniform
  return mesh;
}

/**
 * Workshop Mode: an optional custom fragment shader on a model, in place of
 * the standard lit material. `model.shader` is a GLSL expression body that
 * must assign `color` (vec3) — the workshop panel supplies a starter body
 * ("color = vec3(uv.x, uv.y, 0.5);") a kid can edit freely.
 *
 * Honest limitation: the try/catch below only guards JS-level construction
 * errors (rare) — GLSL syntax errors themselves compile on the GPU, not
 * during material construction, so a malformed shader body will NOT be
 * caught here. It will render black with a console warning instead of
 * throwing. That's an acceptable failure mode for an experimental,
 * advanced-drawer feature (doesn't break the rest of the scene), but it's
 * not the same guarantee as "falls back to the standard material" — worth
 * being precise about rather than overclaiming.
 * @param {any} model
 * @returns {THREE.Material}
 */
export function buildModelMaterial(model) {
  if (!model.shader) {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(model.swatch || '#6fb2dc'),
      roughness: 0.6,
      metalness: 0.1
    });
  }
  try {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(model.swatch || '#6fb2dc') } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          float time = uTime;
          vec3 color = uColor;
          ${model.shader}
          gl_FragColor = vec4(color, 1.0);
        }
      `
    });
  } catch (err) {
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(model.swatch || '#6fb2dc') });
  }
}

/**
 * Zones render as translucent color-coded boxes with edges; spawn/checkpoint
 * points as small glyph markers. Colors from entities.LOGIC_COLORS. Never
 * actually built during play (buildSceneView skips logic entities when
 * opts.play is set) — kept here anyway since it's part of the same
 * component -> mesh mapping and the Stage still needs it while editing.
 * @param {any} engine
 * @param {any} logic
 * @returns {THREE.Object3D}
 */
function buildLogicMesh(engine, logic) {
  const color = LOGIC_COLORS[logic.kind] || '#6fd3ff';
  const isZone = logic.kind === 'trigger' || logic.kind === 'kill';
  const size = logic.size || (isZone ? [2, 2] : [0.6, 0.6]);
  const group = new THREE.Group();

  if (isZone) {
    const geo = new THREE.PlaneGeometry(size[0], size[1]);
    const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(color), transparent: true, opacity: 0.18, side: THREE.DoubleSide
    }));
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: new THREE.Color(color) })
    );
    group.add(fill, edges);
  } else {
    const glyph = logic.kind === 'spawn' ? '\u25B2' : '\u2691';
    const tex = engine.makeCanvasTexture((ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = color;
      ctx.font = 'bold ' + Math.round(s * 0.8) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, s / 2, s / 2);
    });
    const geo = new THREE.PlaneGeometry(size[0], size[1]);
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true })));
  }
  return group;
}

/**
 * Tilemap as one InstancedMesh — hundreds of tiles, one draw call (P2-5).
 * @param {any} map tilemap component
 * @returns {THREE.Object3D}
 */
function buildTilemapMesh(map) {
  const keys = Object.keys(map.tiles);
  const cell = map.cell || 1;
  if (!keys.length) {
    // empty map: a faint origin marker so the entity stays selectable
    const geo = new THREE.PlaneGeometry(cell, cell);
    const mat = new THREE.MeshBasicMaterial({ color: 0x2c3446, transparent: true, opacity: 0.4 });
    return new THREE.Mesh(geo, mat);
  }
  const geo = new THREE.PlaneGeometry(cell, cell);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const inst = new THREE.InstancedMesh(geo, mat, keys.length);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  keys.forEach((key, i) => {
    const [cx, cy] = key.split(',').map(Number);
    m.makeTranslation((cx + 0.5) * cell, (cy + 0.5) * cell, 0);
    inst.setMatrixAt(i, m);
    col.set(map.tiles[key].swatch || '#3b4a63');
    inst.setColorAt(i, col);
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  return inst;
}

/**
 * Push an entity's transform data onto its Object3D.
 * @param {THREE.Object3D} obj
 * @param {any} entity
 * @param {'2d'|'3d'} mode
 */
export function syncTransform(obj, entity, mode) {
  const t = entity.components.transform;
  obj.position.set(t.p[0], t.p[1], t.p[2]);
  if (mode === '2d') {
    obj.rotation.set(0, 0, THREE.MathUtils.degToRad(t.r[2]));
  } else {
    obj.rotation.set(
      THREE.MathUtils.degToRad(t.r[0]),
      THREE.MathUtils.degToRad(t.r[1]),
      THREE.MathUtils.degToRad(t.r[2])
    );
  }
  obj.scale.set(t.s[0], t.s[1], t.s[2]);
}

/**
 * Pull an Object3D's pose back into entity transform data (gizmo write-back).
 * @param {any} entity
 * @param {THREE.Object3D} obj
 * @param {'2d'|'3d'} mode
 */
export function readTransform(entity, obj, mode) {
  const t = entity.components.transform;
  t.p = [round3(obj.position.x), round3(obj.position.y), round3(obj.position.z)];
  if (mode === '2d') {
    t.p[2] = round3(entity.components.transform.p[2]); // Z is layer order in 2D — the gizmo never moves it
    t.r = [0, 0, round3(THREE.MathUtils.radToDeg(obj.rotation.z))];
  } else {
    t.r = [
      round3(THREE.MathUtils.radToDeg(obj.rotation.x)),
      round3(THREE.MathUtils.radToDeg(obj.rotation.y)),
      round3(THREE.MathUtils.radToDeg(obj.rotation.z))
    ];
  }
  t.s = [round3(obj.scale.x), round3(obj.scale.y), round3(obj.scale.z)];
}

/** @param {number} n @returns {number} */
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Canvas rounded-rect path helper (shared by sprite cards and the dummy).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} r
 */
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
