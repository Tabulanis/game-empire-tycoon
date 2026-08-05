/**
 * @file water.js
 * @description Shallow-water liquid over the Stage terrain — the same
 * height-field "virtual pipes" idea as TheBlob's Floodline fluid: every grid
 * cell has a ground height and a water depth, and flow between neighbors is
 * driven by surface-height difference with momentum. Water pours downhill,
 * pools in sculpted basins, banks up behind ridges, and ripples when the
 * player wades through. On top of the sim sits a purely visual wind-wave
 * bob so even still water feels alive.
 *
 * All the dials live in terrain.water (cartridge data, kid-editable):
 *   on       — water exists at all
 *   level    — resting surface height (world units); valleys below it flood
 *   color    — the water's tint
 *   opacity  — see-through-ness 0..1
 *   wave     — wind-wave height (0 = mirror still)
 *   speed    — wind-wave tempo
 *   detail   — sim cells per terrain cell (1 = chunky, 2 = fine)
 *   react    — how strongly it flows and splashes (0 = frozen sheet)
 */

import * as THREE from 'three';
import { terrainHeightSampler } from './meshes.js';

export const WATER_DEFAULTS = {
  on: false, level: 1, color: '#2e86d9', opacity: 0.72,
  wave: 0.06, speed: 1, detail: 1, react: 0.5
};

/**
 * @param {any} terrain  the scene's terrain (reads terrain.water for config)
 * @returns {{mesh: THREE.Mesh, tick: () => void, splash: (x: number, z: number, r: number, amt: number) => void, depthAt: (x: number, z: number) => number, surfaceAt: (x: number, z: number) => number, dispose: () => void}|null}
 */
export function createWater(terrain) {
  const cfg = { ...WATER_DEFAULTS, ...(terrain.water || {}) };
  if (!cfg.on) return null;
  const size = terrain.size || [20, 20];
  const cell = terrain.cell || 1;
  const sub = cfg.detail >= 2 ? 2 : 1;
  const gw = Math.max(2, Math.ceil(size[0] / cell) * sub);
  const gh = Math.max(2, Math.ceil(size[1] / cell) * sub);
  const N = gw * gh;
  const cw = size[0] / gw, ch = size[1] / gh;

  const heightAt = terrainHeightSampler(terrain);
  const ground = new Float32Array(N);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      ground[y * gw + x] = heightAt(-size[0] / 2 + (x + 0.5) * cw, -size[1] / 2 + (y + 0.5) * ch);
    }
  }

  // fill every basin up to the resting level
  const depth = new Float32Array(N);
  for (let i = 0; i < N; i++) depth[i] = Math.max(0, cfg.level - ground[i]);

  // virtual pipes: four non-negative outflows per cell
  const fL = new Float32Array(N), fR = new Float32Array(N);
  const fT = new Float32Array(N), fB = new Float32Array(N);

  const surf = (i) => ground[i] + depth[i];

  function step(dt) {
    if (cfg.react <= 0) return;
    const g = 26 * cfg.react;
    const damp = 0.986;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const s = surf(i);
        fL[i] = x > 0 ? Math.max(0, damp * fL[i] + dt * g * (s - surf(i - 1))) : 0;
        fR[i] = x < gw - 1 ? Math.max(0, damp * fR[i] + dt * g * (s - surf(i + 1))) : 0;
        fT[i] = y > 0 ? Math.max(0, damp * fT[i] + dt * g * (s - surf(i - gw))) : 0;
        fB[i] = y < gh - 1 ? Math.max(0, damp * fB[i] + dt * g * (s - surf(i + gw))) : 0;
        // a cell can't give away more water than it holds
        const total = (fL[i] + fR[i] + fT[i] + fB[i]) * dt;
        if (total > depth[i] && total > 0) {
          const k = depth[i] / total;
          fL[i] *= k; fR[i] *= k; fT[i] *= k; fB[i] *= k;
        }
      }
    }
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const inflow =
          (x > 0 ? fR[i - 1] : 0) + (x < gw - 1 ? fL[i + 1] : 0) +
          (y > 0 ? fB[i - gw] : 0) + (y < gh - 1 ? fT[i + gw] : 0);
        const outflow = fL[i] + fR[i] + fT[i] + fB[i];
        depth[i] = Math.max(0, depth[i] + dt * (inflow - outflow));
      }
    }
  }

  /* ---- the visible surface ---- */
  const geo = new THREE.PlaneGeometry(size[0], size[1], gw, gh);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // per-vertex ground height, sampled once
  const vGround = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) vGround[i] = heightAt(pos.getX(i), pos.getZ(i));

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cfg.color),
    transparent: true, opacity: cfg.opacity,
    roughness: 0.15, metalness: 0.08,
    vertexColors: true, depthWrite: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  mesh.receiveShadow = true;
  mesh.userData.water = true;

  const cellIndexAt = (x, z) => {
    const cx = Math.max(0, Math.min(gw - 1, Math.floor((x + size[0] / 2) / cw)));
    const cy = Math.max(0, Math.min(gh - 1, Math.floor((z + size[1] / 2) / ch)));
    return cy * gw + cx;
  };
  // average depth around a vertex (it sits on cell corners)
  const vertexDepth = (x, z) => {
    let sum = 0, n = 0;
    for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
      sum += depth[cellIndexAt(x + dx * cw, z + dz * ch)];
      n++;
    }
    return sum / n;
  };

  let last = performance.now();
  let t = 0;
  function tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt * cfg.speed;
    step(dt);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const d = vertexDepth(x, z);
      if (d < 0.02) {
        // dry land: tuck the surface just under the ground so no skirt shows
        pos.setY(i, vGround[i] - 0.06);
        continue;
      }
      const bob = Math.sin(t * 2.2 + x * 1.9 + z * 1.3) + 0.5 * Math.sin(t * 3.7 + x * 0.7 - z * 2.1);
      pos.setY(i, vGround[i] + d + cfg.wave * bob * Math.min(1, d * 2));
      // deeper water reads darker — cheap depth cue
      const shade = Math.max(0.5, 1 - d * 0.22);
      colors[i * 3] = shade; colors[i * 3 + 1] = shade; colors[i * 3 + 2] = Math.min(1, shade + 0.12);
    }
    pos.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
  }
  tick();

  return {
    mesh,
    tick,
    /** shove water outward from a point — wakes, splashes, cannonballs */
    splash(x, z, r, amt) {
      if (cfg.react <= 0) return;
      const i = cellIndexAt(x, z);
      const cx = i % gw, cy = (i / gw) | 0;
      const rr = Math.max(1, Math.round(r / cw));
      for (let dy = -rr; dy <= rr; dy++) {
        for (let dx = -rr; dx <= rr; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const j = ny * gw + nx;
          if (depth[j] < 0.02) continue;
          const fall = 1 - Math.hypot(dx, dy) / (rr + 1);
          if (fall <= 0) continue;
          const push = amt * fall * cfg.react;
          if (dx < 0) fL[j] += push; else if (dx > 0) fR[j] += push;
          if (dy < 0) fT[j] += push; else if (dy > 0) fB[j] += push;
          if (dx === 0 && dy === 0) { fL[j] += push; fR[j] += push; fT[j] += push; fB[j] += push; }
        }
      }
    },
    depthAt: (x, z) => depth[cellIndexAt(x, z)],
    surfaceAt: (x, z) => {
      const i = cellIndexAt(x, z);
      return ground[i] + depth[i];
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    }
  };
}
