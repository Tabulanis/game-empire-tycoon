/**
 * @file runtime.js
 * @description The real game: game-mode loop, the Input Desk, the save vault,
 * and the WHEN/IF/DO interpreter that ties every system together. This is
 * what a played (or exported) cartridge actually runs — as opposed to the
 * Stage's Test Dummy, which only exists to let an author test-play a level
 * without leaving the editor. Deliberately imports nothing from editor/: the
 * Cartridge Press ships this file (plus its data) with no editor code at all.
 * Ticket P3-5. Phase 3.
 */

import * as physics2D from './physics.js';
import * as physics3D from './physics3d.js';
import { buildSceneView, syncTransform } from './meshes.js';
import { createAnimState, tickEntityAnimation } from './systems/animation.js';
import { createParticleSystem } from './systems/particles.js';
import { deepClone, findEntity, removeEntity, instantiatePrefab } from './entities.js';
import { random as seededRandom } from './rng.js';
import {
  createEventBus,
  createTimerManager,
  updateZoneMembership,
  updateTouchMembership,
  matchWhen,
  evaluateIf,
  cardKey
} from './systems/triggers.js';
import {
  createMotionState,
  doPatrolBetween,
  doFollowPath,
  doTeleportTo,
  doFace,
  doStop
} from './systems/motion.js';
import {
  createAiState,
  doChase,
  doFlee,
  doWander,
  doStopSteering,
  buildNavGrid,
  findPath
} from './systems/ai.js';
import {
  createCombatState,
  tickCombat,
  applyDamage,
  doDealDamage,
  doHeal,
  doKnockback,
  doInvincible,
  doShoot,
  doExplode,
  doDefeatSelf
} from './systems/combat.js';
import {
  createSaveState,
  doAwardPoints,
  doSetCounter,
  doGiveItem,
  doTakeItem,
  doEndGame,
  doSetCheckpoint
} from './systems/score.js';
import {
  createStoryState,
  doSay,
  doShowChoiceCard,
  advanceCard,
  chooseCard,
  currentCardView,
  doSetStoryFlag
} from './systems/story.js';
import { playSfxAsset, playSong, computePan } from './systems/audio.js';

/** DO actions whose effect is a standing behavior, not a one-off nudge — set
 * once, then re-applied every frame until 'stop' cancels it. Matches how a
 * kid actually uses "patrol": one card, forever motion, no authored loop. */
const CONTINUOUS_MOTION = new Set(['patrol-between', 'follow-path', 'chase', 'flee', 'wander']);

/**
 * Build a uniform physics interface over either physics.js (2D) or
 * physics3d.js (3D) — every physics-touching call in this file goes through
 * this adapter instead of importing a specific module directly, so the same
 * interpreter runs both kinds of game. teleportBody/bodyPosition/
 * moveKinematicTo always take (x, y, z); the 2D backend simply ignores z.
 * @param {boolean} is3D
 */
function createPhysicsAdapter(is3D, controlScheme) {
  const P = is3D ? physics3D : physics2D;
  if (is3D) {
    return {
      initPhysics: P.initPhysics3D,
      buildWorld: (scene) => P.buildWorld3D(scene),
      spawnDummy: (session, pos, entityId) => P.spawnDummy3D(session, pos, entityId),
      advancePlayerControls: controlScheme === 'fps' ? P.advancePlayerControlsFPS3D : P.advancePlayerControls3D,
      stepPhysics: P.stepPhysics3D,
      drainTouchEvents: P.drainTouchEvents3D,
      readBodies: P.readBodies3D,
      bodyPosition: P.bodyPosition3D,
      teleportBody: (session, entityId, x, y, z) => P.teleportBody3D(session, entityId, x, y, z || 0),
      moveKinematicTo: (session, entityId, x, y, z) => P.moveKinematicTo3D(session, entityId, x, y, z || 0),
      setEntityColliderEnabled: null, // not yet supported in 3D — open/close is a documented v1 gap
      addEntityToWorld: P.addEntityToWorld3D,
      removeEntityFromWorld: P.removeEntityFromWorld3D,
      destroyWorld: P.destroyWorld3D,
      worldStats: P.worldStats3D
    };
  }
  return {
    initPhysics: P.initPhysics,
    buildWorld: (scene, opts) => P.buildWorld(scene, opts),
    spawnDummy: P.spawnDummy,
    advancePlayerControls: P.advancePlayerControls,
    stepPhysics: P.stepPhysics,
    drainTouchEvents: P.drainTouchEvents,
    readBodies: P.readBodies,
    bodyPosition: P.bodyPosition,
    teleportBody: (session, entityId, x, y) => P.teleportBody(session, entityId, x, y),
    moveKinematicTo: (session, entityId, x, y) => P.moveKinematicTo(session, entityId, x, y),
    setEntityColliderEnabled: P.setEntityColliderEnabled,
    addEntityToWorld: P.addEntityToWorld,
    removeEntityFromWorld: P.removeEntityFromWorld,
    destroyWorld: P.destroyWorld
  };
}

/** Baseline keyboard mapping. Every action beyond left/right honors
 * cartridge.settings.input[actionName] when present. */
const DEFAULT_KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'ArrowUp', 'KeyW']
};

/**
 * Effective collision size for zone-membership AABB checks — mirrors
 * physics.js's private sizeOf, kept small and duplicated rather than
 * exporting an implementation detail across module boundaries.
 * @param {any} entity
 * @returns {[number, number]}
 */
function entitySize(entity) {
  const t = entity.components.transform;
  const base = (entity.components.body && entity.components.body.size) ||
    (entity.components.model && entity.components.model.size) ||
    (entity.components.sprite && entity.components.sprite.size) || [1, 1];
  const w = Math.max(0.05, Math.abs(base[0] * t.s[0]));
  const h = Math.max(0.05, Math.abs(base[1] * t.s[1]));
  if (base.length < 3) return [w, h];
  const d = Math.max(0.05, Math.abs(base[2] * (t.s[2] !== undefined ? t.s[2] : t.s[0])));
  return [w, h, d];
}

/**
 * The Input Desk: maps keyboard codes to named actions. `jump` honors
 * cartridge.settings.input.jump (Constitution Article VI); any OTHER key in
 * cartridge.settings.input (e.g. `shoot: ['KeyX']`) becomes a named action
 * too, tracked in `input.actions` — that's what the key-pressed(action)
 * brick matches against. left/right are a fixed baseline for now —
 * configurable movement keys are future work.
 * The caller controls the listener's lifetime (bind on Play, unbind on Stop)
 * so this stays usable headlessly: skip bind() entirely and drive `input`
 * directly, exactly like the smoke tests do.
 * @param {any} cartridge
 * @returns {{input: {left: boolean, right: boolean, jump: boolean, actions: Record<string, boolean>}, bind: () => void, unbind: () => void}}
 */
export function createInputDesk(cartridge) {
  const inputConfig = cartridge.settings.input || {};
  const input = { left: false, right: false, up: false, down: false, jump: false, yawDelta: 0, pitchDelta: 0, actions: {} };
  /** actionName -> key codes, merging cartridge config with the jump default.
   * In 3D, W means walk forward — only Space jumps. */
  const jumpDefault = cartridge.settings.mode === '3d' ? ['Space'] : DEFAULT_KEYS.jump;
  const actionKeys = { jump: inputConfig.jump || jumpDefault };
  for (const [name, keys] of Object.entries(inputConfig)) {
    if (name !== 'jump') actionKeys[name] = keys;
    input.actions[name] = false;
  }
  if (input.actions.jump === undefined) input.actions.jump = false;

  function onKeyDown(e) {
    if (DEFAULT_KEYS.left.includes(e.code)) input.left = true;
    if (DEFAULT_KEYS.right.includes(e.code)) input.right = true;
    if (DEFAULT_KEYS.up.includes(e.code)) input.up = true;
    if (DEFAULT_KEYS.down.includes(e.code)) input.down = true;
    for (const [name, keys] of Object.entries(actionKeys)) {
      if (keys.includes(e.code)) {
        e.preventDefault();
        input.actions[name] = true;
        if (name === 'jump') input.jump = true;
      }
    }
  }
  function onKeyUp(e) {
    if (DEFAULT_KEYS.left.includes(e.code)) input.left = false;
    if (DEFAULT_KEYS.right.includes(e.code)) input.right = false;
    if (DEFAULT_KEYS.up.includes(e.code)) input.up = false;
    if (DEFAULT_KEYS.down.includes(e.code)) input.down = false;
    for (const [name, keys] of Object.entries(actionKeys)) {
      if (keys.includes(e.code)) {
        input.actions[name] = false;
        if (name === 'jump') input.jump = false;
      }
    }
  }

  // first-person: clicking the game locks the mouse to it, and moving the
  // mouse looks around (Esc releases it — the browser handles that part)
  const fps = cartridge.settings.controlScheme === 'fps';
  function onClick() {
    const canvas = document.querySelector('canvas');
    if (canvas && document.pointerLockElement !== canvas) canvas.requestPointerLock();
  }
  function onMouseMove(e) {
    if (!document.pointerLockElement) return;
    input.yawDelta -= e.movementX * 0.0025;
    input.pitchDelta -= e.movementY * 0.0025;
  }

  return {
    input,
    bind() {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      if (fps) {
        window.addEventListener('click', onClick);
        window.addEventListener('mousemove', onMouseMove);
        onClick();
      }
    },
    unbind() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (fps) {
        window.removeEventListener('click', onClick);
        window.removeEventListener('mousemove', onMouseMove);
        if (document.pointerLockElement) document.exitPointerLock();
      }
    }
  };
}

/**
 * Start a real Play session: clone the scene (never the cartridge — reading
 * cartridge.prefabs for spawn-prefab is fine, writing to it never happens),
 * build the physics world, find the player, wire input, and return a
 * tick/stop handle the caller's render loop drives.
 * @param {any} engine  renderer engine handle (contentRoot, mode, makeCanvasTexture)
 * @param {any} cartridge  the live cartridge — read-only (prefabs, saveSchema, settings)
 * @param {string} sceneId
 * @param {(msg: string) => void} log
 * @returns {Promise<object>} the runtime handle
 */
export async function startRuntime(engine, cartridge, sceneId, log) {
  const is3D = cartridge.settings.mode === '3d';
  const controlScheme = cartridge.settings.controlScheme;
  const phys = createPhysicsAdapter(is3D, controlScheme);
  await phys.initPhysics();

  const sourceScene = cartridge.scenes.find((s) => s.id === sceneId);
  if (!sourceScene) throw new Error('[runtime] scene not found: ' + sceneId);
  const scene = deepClone(sourceScene);

  const session = phys.buildWorld(scene, { perspective: cartridge.settings.perspective || 'side' });
  const view = buildSceneView(engine, scene, { play: true });

  const motionState = createMotionState();
  const aiState = createAiState();
  const animState = createAnimState();
  const combatState = createCombatState();
  const saveState = createSaveState(cartridge.saveSchema);
  const storyState = createStoryState();
  const navGrid = buildNavGrid(scene);
  /** Mutable, shared with executeDo via ctx — audio/time-scale/camera-shake
   * state that a DO action needs to change and tick() needs to read. Plain
   * `let`s wouldn't work here since executeDo is a module-level function,
   * not a closure over startRuntime's locals. */
  const liveState = { musicPlayer: null, timeScale: 1, shakeTimer: 0, shakeIntensity: 0, particleSystems: [], elapsed: 0 };
  /** last frame's input.actions, for rising-edge detection (key-pressed fires once per press, not every held frame) */
  let previousActions = {};
  const bus = createEventBus();
  const timers = createTimerManager();
  /** @type {Set<string>} zone ids the player is currently inside */
  const zoneMembership = new Set();
  /** @type {Set<string>} entity ids the player is currently touching (AABB-based, see triggers.js) */
  const touchMembership = new Set();
  /** @type {Map<string, {kind: string, params: any}>} */
  const activeMotion = new Map();

  const playerEntity = scene.entities.find(
    (e) => Array.isArray(e.components.tags) && e.components.tags.includes('player')
  );
  const spawnLogic = scene.entities.find((e) => e.components.logic && e.components.logic.kind === 'spawn');
  const spawnEntityTransform = spawnLogic ? spawnLogic.components.transform : (playerEntity ? playerEntity.components.transform : null);
  const spawnPoint = spawnEntityTransform
    ? (is3D ? [spawnEntityTransform.p[0], spawnEntityTransform.p[1], spawnEntityTransform.p[2] || 0] : [spawnEntityTransform.p[0], spawnEntityTransform.p[1]])
    : (is3D ? [0, 2, 0] : [0, 2]);

  if (playerEntity) {
    phys.spawnDummy(session, spawnPoint, playerEntity.id);
  }

  bus.emit('gameStart', { entity: '*' });
  bus.emit('sceneStart', { entity: '*' });
  for (const initialEntity of scene.entities) {
    bus.emit('spawned', { entity: initialEntity.id });
  }

  let stopped = false;

  /**
   * Run every bricksheet card whose WHEN matches one of this frame's events.
   * @param {any[]} events
   */
  function runBricksheets(events) {
    /** @type {string[]} */
    const pendingRemovals = [];
    /** @type {any[]} */
    const pendingSpawns = [];

    for (const entity of scene.entities) {
      const sheetId = entity.components.bricks && entity.components.bricks.sheet;
      if (!sheetId) continue;
      const cards = cartridge.bricksheets[sheetId];
      if (!Array.isArray(cards)) continue;

      for (const event of events) {
        cards.forEach((card, index) => {
          const key = cardKey(entity.id, sheetId, index);
          if (!matchWhen(card, event, entity.id, key)) return;
          const ctx = {
            entity, saveState, zoneMembership, rng: seededRandom
          };
          if (!evaluateIf(card.if, ctx)) return;
          // rules light up: pulse the entity in the world so a kid can SEE
          // which thing's cards just fired (editor Stage passes the hook)
          if (session.onBrickFire) session.onBrickFire(entity.id, card.when, index);
          for (const action of (card.do || [])) {
            executeDo(action, entity, {
              scene, session, saveState, bus, motionState, combatState,
              activeMotion, view, cartridge, spawnFallback: spawnPoint,
              pendingRemovals, pendingSpawns, playerEntity, storyState, liveState, engine, aiState, navGrid, phys, is3D, controlScheme
            });
          }
        });
      }
    }

    for (const projectile of pendingSpawns) {
      phys.addEntityToWorld(session, projectile);
      view.refreshEntity(projectile.id);
      bus.emit('spawned', { entity: projectile.id });
    }
    for (const id of pendingRemovals) {
      const obj = view.objects.get(id);
      if (obj) { engine.contentRoot.remove(obj); view.objects.delete(id); }
      phys.removeEntityFromWorld(session, id);
      removeEntity(scene, id);
    }
  }

  /**
   * Scan every bricksheet for "every-n-seconds" cards, so the timer manager
   * knows every currently-declared repeating timer even before it's fired
   * once. Cheap: just reading data, called once per frame.
   * @returns {Array<{key: string, seconds: number}>}
   */
  function collectTimerDeclarations() {
    const out = [];
    for (const entity of scene.entities) {
      const sheetId = entity.components.bricks && entity.components.bricks.sheet;
      if (!sheetId) continue;
      const cards = cartridge.bricksheets[sheetId];
      if (!Array.isArray(cards)) continue;
      cards.forEach((card, index) => {
        if (card.when === 'every-n-seconds') {
          out.push({ key: cardKey(entity.id, sheetId, index), seconds: card.seconds || 1 });
        }
      });
    }
    return out;
  }

  /** Built-in checkpoint/kill zone behavior — no bricksheet required, matches the Stage's test-play convenience. */
  function applyBuiltinZones(events) {
    for (const event of events) {
      if (event.type !== 'zoneEnter' || !playerEntity) continue;
      if (event.zoneKind === 'checkpoint') {
        const zoneEntity = findEntity(scene, event.entity);
        if (zoneEntity) doSetCheckpoint(saveState, zoneEntity.components.transform.p);
        log('checkpoint set');
      } else if (event.zoneKind === 'kill') {
        const target = saveState.checkpoint || spawnPoint;
        phys.teleportBody(session, playerEntity.id, target[0], target[1], target[2]);
        if (playerEntity.components.health) playerEntity.components.health.current = playerEntity.components.health.max;
        log('kill zone — respawned');
      }
    }
  }

  /**
   * @param {number} dt seconds (already clamped by the caller)
   * @param {{left: boolean, right: boolean, jump: boolean}} input
   */
  function tick(dt, input) {
    if (stopped) return { ended: saveState.ended };
    dt *= liveState.timeScale;

    const actions = input.actions || {};
    for (const [name, pressed] of Object.entries(actions)) {
      if (pressed && !previousActions[name]) bus.emit('keyPressed', { entity: '*', action: name });
    }
    previousActions = { ...actions };

    if (playerEntity && !storyState.activeCardId) phys.advancePlayerControls(session, input, dt);

    if (!is3D) {
      for (const [id, motion] of activeMotion) {
        const entity = findEntity(scene, id);
        if (!entity) { activeMotion.delete(id); continue; }
        if (motion.kind === 'patrol-between') doPatrolBetween(entity, motion.params, session, dt, motionState);
        else if (motion.kind === 'follow-path') doFollowPath(entity, motion.params, session, dt, motionState);
        else if (motion.kind === 'chase') doChase(entity, motion.params, session, scene, dt, aiState);
        else if (motion.kind === 'flee') doFlee(entity, motion.params, session, scene, dt, aiState);
        else if (motion.kind === 'wander') doWander(entity, motion.params, session, dt, aiState);
      }
    }

    tickCombat(combatState, session, dt);
    phys.stepPhysics(session);

    // Dynamic-body physics collisions (projectiles hitting a dynamic crate,
    // two dynamic bodies meeting) — Rapier's event queue is reliable here.
    for (const touch of phys.drainTouchEvents(session, scene)) {
      const entA = findEntity(scene, touch.a);
      const entB = findEntity(scene, touch.b);
      const tagA = entA && Array.isArray(entA.components.tags) ? entA.components.tags[0] : undefined;
      const tagB = entB && Array.isArray(entB.components.tags) ? entB.components.tags[0] : undefined;
      bus.emit('touched', { entity: touch.a, byTag: tagB });
      bus.emit('touched', { entity: touch.b, byTag: tagA });
      bus.emit('bumped', { entity: touch.a, from: touch.aFrom });
      bus.emit('bumped', { entity: touch.b, from: touch.aFrom === 'above' ? 'below' : touch.aFrom === 'below' ? 'above' : 'side' });
    }

    // Player-vs-scenery touches (coins, spikes, patrol enemies) — AABB-based.
    // Rapier's collision events only fire for pairs involving a dynamic
    // body; the player is kinematic and most touchables are static or
    // kinematic too, so this is the reliable path (see triggers.js).
    if (playerEntity) {
      const playerPos = phys.bodyPosition(session, playerEntity.id);
      if (playerPos) {
        const playerAabb = { x: playerPos.x, y: playerPos.y, z: is3D ? playerPos.z : undefined, ...sizeAsWH(playerEntity) };
        const touchables = [];
        for (const entity of scene.entities) {
          if (entity === playerEntity || !entity.components.bricks) continue;
          const pos = phys.bodyPosition(session, entity.id) ||
            { x: entity.components.transform.p[0], y: entity.components.transform.p[1], z: entity.components.transform.p[2] };
          touchables.push({ id: entity.id, x: pos.x, y: pos.y, z: is3D ? pos.z : undefined, ...sizeAsWH(entity) });
        }
        updateTouchMembership(playerAabb, touchables, touchMembership, bus);
      }
    }

    // zone membership: player-only (see triggers.js's updateZoneMembership doc)
    if (playerEntity) {
      const pos = phys.bodyPosition(session, playerEntity.id);
      if (pos) {
        const playerAabb = { x: pos.x, y: pos.y, z: is3D ? pos.z : undefined, ...sizeAsWH(playerEntity) };
        for (const wz of session.zones) {
          if (wz.kind !== 'water' || !session.dummy) continue;
          // buoyancy pushes screen-up; only side view has an up to push toward
          if (is3D || (cartridge.settings.perspective || 'side') === 'top') break;
          const pp = phys.bodyPosition(session, playerEntity.id);
          if (!pp) continue;
          if (Math.abs(pp.x - wz.x) <= wz.w / 2 && Math.abs(pp.y - wz.y) <= wz.h / 2) {
            session.dummy.vy = Math.min(session.dummy.vy + 34 * dt, 2.5);
          }
        }
        const activeZones = session.zones.filter((z) => {
          const zoneEntity = findEntity(scene, z.id);
          return !zoneEntity || !zoneEntity.components.logic.locked;
        });
        updateZoneMembership(playerAabb, activeZones, zoneMembership, bus);
      }
    }

    // repeating "every N seconds" timers — registers any newly-seen
    // declaration and advances every timer's countdown in the same pass
    timers.tick(collectTimerDeclarations(), dt, bus);

    const events = bus.drain();
    applyBuiltinZones(events);
    runBricksheets(events);

    // render sync
    for (const pose of phys.readBodies(session)) {
      const obj = view.objects.get(pose.id);
      const entity = findEntity(scene, pose.id);
      if (!obj || !entity) continue;
      obj.position.x = pose.x;
      obj.position.y = pose.y;
      entity.components.transform.p[0] = pose.x;
      entity.components.transform.p[1] = pose.y;
      if (is3D && pose.z !== undefined) {
        obj.position.z = pose.z;
        entity.components.transform.p[2] = pose.z;
      }
    }
    // patrol/follow-path entities aren't in readBodies' dynamic/player set when
    // purely kinematic without a body component fallback — but they ARE
    // kinematic bodies via physics, so readBodies already covers them.

    for (const entity of scene.entities) {
      if (!entity.components.anim) continue;
      const obj = view.objects.get(entity.id);
      if (!obj) continue;
      const offset = tickEntityAnimation(entity, animState, cartridge, dt);
      if (!offset) continue;
      const base = entity.components.transform;
      obj.position.set(base.p[0] + offset.p[0], base.p[1] + offset.p[1], (base.p[2] || 0) + offset.p[2]);
      obj.rotation.set(
        (base.r[0] + offset.r[0]) * Math.PI / 180,
        (base.r[1] + offset.r[1]) * Math.PI / 180,
        (base.r[2] + offset.r[2]) * Math.PI / 180
      );
      obj.scale.set(base.s[0] * offset.s[0], base.s[1] * offset.s[1], (base.s[2] !== undefined ? base.s[2] : base.s[0]) * offset.s[2]);
    }

    const MAX_PARTICLE_SYSTEM_LIFETIME = 6; // seconds — a safety ceiling, not a creative choice
    liveState.elapsed += dt;
    for (const entity of scene.entities) {
      if (!entity.components.model || !entity.components.model.shader) continue;
      const obj = view.objects.get(entity.id);
      if (!obj) continue;
      obj.traverse((child) => {
        if (child.material && child.material.uniforms && child.material.uniforms.uTime) {
          child.material.uniforms.uTime.value = liveState.elapsed;
        }
      });
    }
    for (let i = liveState.particleSystems.length - 1; i >= 0; i--) {
      const entry = liveState.particleSystems[i];
      entry.age += dt;
      entry.system.tick(dt);
      if (entry.age > MAX_PARTICLE_SYSTEM_LIFETIME) {
        entry.system.dispose();
        liveState.particleSystems.splice(i, 1);
      }
    }

    if (view.water) view.water.tick();

    // swimming: below the water surface the player floats up and leaves a wake
    if (view.water && playerEntity && session.dummy) {
      const wpos = phys.bodyPosition(session, playerEntity.id);
      if (wpos && is3D) {
        const wsurf = view.water.surfaceAt(wpos.x, wpos.z);
        const wdepth = view.water.depthAt(wpos.x, wpos.z);
        const feet = wpos.y - 0.45;
        if (wdepth > 0.15 && feet < wsurf - 0.05) {
          const sub = Math.min(1, (wsurf - feet) / 0.9);
          session.dummy.vy = Math.min(session.dummy.vy + 30 * sub * dt, 2.5);
          const moving = input.left || input.right || input.up || input.down;
          if (moving) view.water.splash(wpos.x, wpos.z, 1.4, 2.2 * dt);
        }
      }
    }

    // VR: walking follows your gaze — feed the headset's yaw into the dummy
    if (is3D && session.dummy && engine.xrPresenting) {
      const hy = engine.headsetYaw();
      if (hy !== null) { session.dummy.yaw = hy; input.yawDelta = 0; input.pitchDelta = 0; }
    }

    if (playerEntity) {
      const pos = phys.bodyPosition(session, playerEntity.id);
      if (pos && is3D && engine.xrPresenting) {
        // headset session: plant the rig at the player's feet and let the
        // headset supply all head movement and look on top
        engine.xrRig.position.set(pos.x, pos.y - 0.45, pos.z);
      } else if (pos && is3D && controlScheme === 'fps') {
        // True first-person: camera sits at eye height, immediate (no lerp
        // lag), oriented by the tracked yaw — turning should feel instant.
        const yaw = session.dummy ? session.dummy.yaw : 0;
        const pitch = session.dummy ? (session.dummy.pitch || 0) : 0;
        engine.camera.position.set(pos.x, pos.y + 0.35, pos.z);
        engine.camera.rotation.order = 'YXZ'; // yaw first, then pitch — FPS look
        engine.camera.rotation.set(pitch, yaw, 0);
      } else if (pos && is3D) {
        // Third-person follow: up and behind the player (player moves toward
        // -Z by default per advancePlayerControls3D's input mapping).
        const targetX = pos.x, targetY = pos.y + 4, targetZ = pos.z + 7;
        engine.camera.position.x += (targetX - engine.camera.position.x) * 0.12;
        engine.camera.position.y += (targetY - engine.camera.position.y) * 0.12;
        engine.camera.position.z += (targetZ - engine.camera.position.z) * 0.12;
        engine.camera.lookAt(pos.x, pos.y + 1, pos.z);
      } else if (pos && engine.mode === '2d') {
        engine.camera.position.x += (pos.x - engine.camera.position.x) * 0.12;
        engine.camera.position.y += (pos.y - engine.camera.position.y) * 0.12;
      }
    }

    if (liveState.shakeTimer > 0) {
      liveState.shakeTimer -= dt;
      const mag = liveState.shakeIntensity * Math.max(0, liveState.shakeTimer);
      engine.camera.position.x += (Math.random() * 2 - 1) * mag;
      engine.camera.position.y += (Math.random() * 2 - 1) * mag;
    }

    return { ended: saveState.ended, dialogue: currentCardView(storyState, cartridge) };
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (liveState.musicPlayer) { liveState.musicPlayer.stop(); liveState.musicPlayer = null; }
    for (const entry of liveState.particleSystems) entry.system.dispose();
    liveState.particleSystems.length = 0;
    phys.destroyWorld(session);
    view.clear();
  }

  return {
    tick,
    stop,
    get saveState() { return saveState; },
    sceneClone: scene,
    session,
    advanceDialogue() { advanceCard(storyState, cartridge, bus); },
    chooseDialogue(index) { chooseCard(storyState, index, cartridge, bus); },
    /** Live counters for the Stage's debug HUD — read-only, cheap to poll every frame. */
    get debugInfo() {
      return {
        entities: scene.entities.length,
        particleSystems: liveState.particleSystems.length,
        activeMotion: activeMotion.size,
        elapsed: liveState.elapsed
      };
    }
  };
}

/**
 * Resolve which entity a combat action actually targets. Most DO actions
 * apply to the card owner ("when touched, open — open MYSELF", Article VI's
 * door example). Combat actions default the other way: a spike's "deal
 * damage" means damage whoever touched it, not damage itself — so
 * deal-damage/knockback default to target:'other' (the player; touch/bump
 * events in this design are always player-vs-scenery) unless the card
 * explicitly says target:'self'.
 * @param {any} action
 * @param {any} owner  the card's owning entity
 * @param {any} playerEntity
 * @returns {any}
 */
function resolveTarget(action, owner, playerEntity) {
  const wantsSelf = action.target === 'self';
  const wantsOther = action.target === 'other';
  if (wantsSelf) return owner;
  if (wantsOther) return playerEntity || owner;
  return playerEntity || owner; // default: other (the common hazard-vs-player case)
}

/**
 * DO-action dispatcher — routes a card's action to the owning system.
 * spawn-prefab and destroy-self/show-hide (no dedicated system file exists
 * for generic "world" actions per Article V) live here since runtime.js is
 * the one module with access to the scene, view, and cartridge together.
 * @param {any} action  {do: string, ...params}
 * @param {any} entity  the bricksheet-owning entity
 * @param {any} ctx
 */
function executeDo(action, entity, ctx) {
  switch (action.do) {
    case 'patrol-between':
    case 'follow-path':
    case 'chase':
    case 'flee':
    case 'wander':
      ctx.activeMotion.set(entity.id, { kind: action.do, params: action });
      break;
    case 'path-to': {
      if (ctx.is3D) break; // A* pathfinding is 2D-grid-based only for now
      const from = [entity.components.transform.p[0], entity.components.transform.p[1]];
      const to = action.target
        ? (() => { const t = findEntity(ctx.scene, action.target); return t ? [t.components.transform.p[0], t.components.transform.p[1]] : null; })()
        : [action.x, action.y];
      if (to) {
        const path = findPath(ctx.navGrid, from, to);
        if (path.length) ctx.activeMotion.set(entity.id, { kind: 'follow-path', params: { points: path, speed: action.speed || 2 } });
      }
      break;
    }
    case 'teleport-to':
      if (!ctx.is3D) doTeleportTo(entity, action, ctx.session);
      break;
    case 'face':
      doFace(entity, action);
      break;
    case 'stop':
      ctx.activeMotion.delete(entity.id);
      doStop(entity, ctx.motionState);
      doStopSteering(entity, ctx.aiState);
      break;

    case 'deal-damage':
      doDealDamage(resolveTarget(action, entity, ctx.playerEntity), action, ctx.combatState, ctx.bus);
      break;
    case 'heal':
      doHeal(resolveTarget(action, entity, ctx.playerEntity), action);
      break;
    case 'knockback':
      if (!ctx.is3D) doKnockback(resolveTarget(action, entity, ctx.playerEntity), action, ctx.combatState, ctx.session);
      break;
    case 'invincible':
      doInvincible(resolveTarget(action, entity, ctx.playerEntity), action, ctx.combatState);
      break;
    case 'shoot': {
      if (!ctx.is3D) {
        ctx.pendingSpawns.push(doShoot(entity, action, ctx.scene));
      } else if (ctx.controlScheme === 'fps' && ctx.session.dummy && ctx.playerEntity && entity.id === ctx.playerEntity.id) {
        const yaw = ctx.session.dummy.yaw;
        const direction3D = [-Math.sin(yaw), 0, -Math.cos(yaw)];
        ctx.pendingSpawns.push(doShoot(entity, action, ctx.scene, direction3D));
      }
      break;
    }
    case 'explode':
      doExplode(entity, action, ctx.scene, ctx.combatState, ctx.bus);
      break;
    case 'defeat-self':
      if (doDefeatSelf(entity, ctx.scene, ctx.bus)) ctx.pendingRemovals.push(entity.id);
      break;
    case 'respawn-at-checkpoint': {
      const target = ctx.saveState.checkpoint || ctx.spawnFallback;
      ctx.phys.teleportBody(ctx.session, entity.id, target[0], target[1], target[2]);
      if (entity.components.health) entity.components.health.current = entity.components.health.max;
      break;
    }

    case 'award-points':
      doAwardPoints(ctx.saveState, action, ctx.bus);
      break;
    case 'set-counter':
      doSetCounter(ctx.saveState, action, ctx.bus);
      break;
    case 'give-item':
      doGiveItem(ctx.saveState, action, ctx.bus);
      break;
    case 'take-item':
      doTakeItem(ctx.saveState, action);
      break;
    case 'end-game':
      doEndGame(ctx.saveState, action);
      break;
    case 'set-checkpoint':
      doSetCheckpoint(ctx.saveState, entity.components.transform.p);
      break;

    case 'spawn-prefab': {
      const entity2 = instantiatePrefab(ctx.cartridge, action.prefab, ctx.scene, action.at || entity.components.transform.p);
      if (entity2) ctx.pendingSpawns.push(entity2);
      break;
    }
    case 'destroy-self':
      ctx.pendingRemovals.push(entity.id);
      break;
    case 'show-hide': {
      const obj = ctx.view.objects.get(entity.id);
      if (obj) obj.visible = action.visible !== false;
      break;
    }
    case 'send-message':
      ctx.bus.emit('message', { entity: '*', name: action.message });
      break;

    case 'open':
      if (ctx.phys.setEntityColliderEnabled) ctx.phys.setEntityColliderEnabled(ctx.session, entity.id, false);
      { const obj = ctx.view.objects.get(entity.id); if (obj) obj.visible = action.visible !== false; }
      break;
    case 'close':
      if (ctx.phys.setEntityColliderEnabled) ctx.phys.setEntityColliderEnabled(ctx.session, entity.id, true);
      { const obj = ctx.view.objects.get(entity.id); if (obj) obj.visible = true; }
      break;
    case 'swap-sprite': {
      if (entity.components.sprite) {
        if (action.swatch) entity.components.sprite.swatch = action.swatch;
        if (action.asset !== undefined) entity.components.sprite.asset = action.asset;
        ctx.view.refreshEntity(entity.id);
      }
      break;
    }
    case 'play-animation': {
      // Flipbook frame stepping only — full animation rigs are Phase 6
      // (Animation Loft). A "frame" param just picks which Atelier frame
      // shows; the entity's sprite.asset resolver (meshes.js) reads it.
      if (entity.components.sprite) {
        entity.components.sprite.frame = action.frame || 0;
        ctx.view.refreshEntity(entity.id);
      }
      break;
    }
    case 'emit-particles': {
      const effect = (ctx.cartridge.assets.effects || []).find((e) => e.id === action.effect);
      if (effect) {
        const t = entity.components.transform;
        const system = createParticleSystem(ctx.engine, effect);
        system.setPosition(t.p[0], t.p[1] || 0, t.p[2] || 0);
        if (effect.burst) system.burstNow();
        ctx.liveState.particleSystems.push({ system, age: 0 });
      }
      break;
    }
    case 'shake-camera':
      ctx.liveState.shakeTimer = action.seconds || 0.3;
      ctx.liveState.shakeIntensity = action.intensity || 0.15;
      break;
    case 'lock-zone':
    case 'unlock-zone': {
      const zoneEntity = action.zone ? findEntity(ctx.scene, action.zone) : entity;
      if (zoneEntity && zoneEntity.components.logic) {
        zoneEntity.components.logic.locked = action.do === 'lock-zone';
      }
      break;
    }

    case 'play-sfx': {
      const sfx = (ctx.cartridge.assets.sfx || []).find((s) => s.id === action.sfx);
      if (sfx) {
        const pan = action.positional
          ? computePan(entity.components.transform.p[0], ctx.playerEntity ? ctx.playerEntity.components.transform.p[0] : 0)
          : 0;
        playSfxAsset(sfx, pan);
      }
      break;
    }
    case 'play-song': {
      const song = (ctx.cartridge.assets.songs || []).find((s) => s.id === action.song);
      if (song) {
        if (ctx.liveState.musicPlayer) ctx.liveState.musicPlayer.stop();
        ctx.liveState.musicPlayer = playSong(song, ctx.cartridge.assets.sfx || []);
      }
      break;
    }
    case 'stop-music':
      if (ctx.liveState.musicPlayer) { ctx.liveState.musicPlayer.stop(); ctx.liveState.musicPlayer = null; }
      break;
    case 'flash-channel': {
      const channels = (ctx.cartridge.settings.channels || []).slice();
      if (!channels.includes(action.channel)) channels.push(action.channel);
      ctx.engine.rebuildChannels(channels);
      // brief flash: rebuild back to the base set shortly after — approximate
      // by scheduling by shakeTimer-style countdown to avoid a new timer type.
      setTimeout(() => ctx.engine.rebuildChannels(ctx.cartridge.settings.channels || []), (action.seconds || 0.2) * 1000);
      break;
    }
    case 'slow-time':
      ctx.liveState.timeScale = action.scale !== undefined ? action.scale : 0.3;
      setTimeout(() => { ctx.liveState.timeScale = 1; }, (action.seconds || 1) * 1000);
      break;

    case 'say':
      doSay(ctx.storyState, action, ctx.cartridge, ctx.bus);
      break;
    case 'show-choice-card':
      doShowChoiceCard(ctx.storyState, action, ctx.cartridge, ctx.bus);
      break;
    case 'set-story-flag':
      doSetStoryFlag(ctx.saveState, action);
      break;

    default:
      break; // unknown DO action never crashes a kid's game — silently ignored
  }
}

/**
 * @param {any} entity
 * @returns {{w: number, h: number}}
 */
function sizeAsWH(entity) {
  const size = entitySize(entity);
  return size.length === 3 ? { w: size[0], h: size[1], d: size[2] } : { w: size[0], h: size[1] };
}
