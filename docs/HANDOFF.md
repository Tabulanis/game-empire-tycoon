# GAME EMPIRE TYCOON — Session Handoff
*Compact state document. Attach this + CONSTITUTION.md + CLAUDE.md at the start of any new chat. Those two are law; this file is only "where we are."*

---

## 1. What this project is (one breath)

**Game Empire Tycoon (GET):** a game that builds a game company. Standalone, offline, finite — no AI, no cloud, no accounts. A kid can play it for 3 years and end up with a library of real games and maybe a few sales. Every shipped game exports as a single HTML "cartridge."

Five Laws (short form): everything is data · one renderer (Three.js for 2D and 3D) · we can only do what we understand to do (features unlock via their own sandbox) · complete in the box · ship small, ship real.

Owner's standing rules: never simplify/rebuild/clean up unless told · refactors DELETE old implementations completely · complete files only, no fragments · uncertainty = ask, never guess architecture.

Delivery pattern: **one complete Python installer script per phase** that writes/overwrites whole files in the repo. Owner runs it locally, then `npm install` / `npm run dev`.

## 2. Stack (locked whitelist)

`three` (0.169.0) · `postprocessing` (6.39.4 verified) · `@dimforge/rapier2d-compat` + `rapier3d-compat` · `yuka` · `tweakpane` · `fflate` · `vite` + `vite-plugin-singlefile`. Plain JS + JSDoc. No other packages without owner approval. Bundled assets CC0 only (Kenney/Quaternius); Mixamo = import-only via the standard-rig retarget path, never redistributed.

## 3. Phase ledger

| Phase | Status | Ships-when |
|---|---|---|
| **P0 — Shell** | ✅ SHIPPED (`install_get_p0.py`, 50 files) | Cartridge survives browser restart (marker test in Studio tab) |
| **P1 — Light & Deck** | ✅ SHIPPED (`install_get_p1.py`, 9 files) | GLB + sprite render with bloom at 60fps, Deck open — owner to eyeball-confirm |
| **P2 — Stage** | ⬅ **NEXT** | A level can be arranged and test-played without reloading |
| P3 — First Blood | Platformer template + ~25 bricks + Pixel Atelier + SFX Foundry + Cartridge Press; a kid finishes an exported single-file platformer |
| P4–P8 | Sound/Story → Systems → 3D → Skunkworks → Going Public (see Constitution Art. XII) |

## 4. What exists in the repo right now

**Working (P0):** app shell (tabs: Studio, Warehouse, Deck, Backups, About; Stage/Bricks visibly locked) · cartridge service with schema authority in `src/editor/schema.js` (Article VI exactly; non-destructive validation/repair) · File System Access API save/open with download fallback · session persistence via localStorage (`get.session.v1`) · auto-backup: fflate zips in IndexedDB every 5 min + on save, pruned to 20, with restore/download/delete + pre-New/Open/Restore snapshots · Warehouse browser reading `src/data/warehouse/index.json`, tag search, drag payload contract live (`application/x-get-warehouse-item`) · seeded RNG (`src/engine/rng.js`, mulberry32 — no Math.random() in engine code, ever).

**Working (P1):** `src/engine/renderer.js` — one Three scene, ortho/persp cameras, EffectComposer chain with all six Article XI channels (bloom, DoF, vignette, noise, chromatic, pixelate; each fails safe individually) + 5 tone-map presets · GLB import via GLTFLoader with a verified embedded test cube (`src/data/test-assets/test-cube.glb`, 1 mesh/24 verts/12 tris) · 2D sprite path via CanvasTexture · `src/engine/debug.js` + Deck tab: FPS sparkline, event log, seeded-RNG demo, honest Phase-2 stubs for entity inspector / collision wireframes · channels + mode + tone persist into `cartridge.settings` (Law 1).

**Stubs with phase-gated headers:** physics, entities, runtime, all systems (motion/combat/triggers/story/ai/camera/score/audio), stage/bricks/atelier/kitbay/soundbooth/foundry/loft/lab/codex editors, meta (tycoon/pitch/ledger), press/export. `src/data/`: warehouse index (starter CC0 placeholder pack), `tags.json` (Pitch Meeting taxonomy), README stubs for bricks/templates/codex.

**Known minor cleanups (not blockers):** deck-panel.js declares a const after its using function (valid, tested; tidy during P2) · rapier/yuka/tweakpane installed-but-unused by design until their phases.

**Owner checklist before next session:** place `empire-constitution.md` as `docs/CONSTITUTION.md` and `CLAUDE.md` at repo root · run the P0 marker test · run the P1 Deck check (load GLB, toggle bloom, confirm ~60fps).

## 5. P2 — Stage: suggested ticket breakdown

- **P2-1** Entities for real: `entities.js` ECS-lite (plain objects, component registry, Article VI entity shape), scene list in cartridge becomes live.
- **P2-2** Stage view: render the current scene through the P1 engine; selection via raycast; Three `TransformControls` gizmos (move/rotate/scale), 2D-aware (lock Z, rotate-Z-only in 2D mode).
- **P2-3** Grid + vertex snapping; scene tree panel (DOM) + Tweakpane inspector bound to components.
- **P2-4** Prefabs: save selection as prefab, instantiate from Warehouse drags (payload contract already live) and from prefab list.
- **P2-5** Tile painting for 2D scenes (tilemap component + paint tool).
- **P2-6** Logic entities: trigger zones, spawn points, checkpoints, kill zones (visible in edit, invisible in play).
- **P2-7** Rapier integration: 2D bodies for tiles/entities, debug wireframes wired into the Deck's existing stub slots.
- **P2-8** Play/Stop toggle in place — enter runtime with current scene, exit restores edit state. Ships-when demo.

## 6. Model workflow

Opus for phase kickoffs / engine-critical systems; Sonnet for bounded tickets. Every session opens with: *"Read CONSTITUTION.md and CLAUDE.md. Confirm current phase and the standing rules. Then ticket X."* Verification bar set by P1: install real packages, check real API signatures, run real builds before shipping an installer.

## 7. Side artifacts (parked, not dead)

`paydirt.html` — PAYDIRT v0.6: real-money quest board (23 tickets, Vault, guided wizards, clerk interview) + SIGNALRUNNER paper-trading arcade in one file. Its honest-ledger rule ("only real dollars enter the ledger") is codified into GET's Constitution (Art. I, Phase 8). Broader business exploration lives in the earlier chats; the tycoon direction consolidated into GET.

## 8. Opening prompt for the new chat

> Attached: CONSTITUTION.md, CLAUDE.md, and this handoff. You are the engineering staff of Game Empire Tycoon. Read all three. Confirm in one short list: current phase (P2 — Stage), the owner's standing rules, and the dependency whitelist. Then execute tickets P2-1 through P2-8 from the handoff, delivery as ONE complete Python installer (whole files only, delete anything replaced), verified the P1 way: real npm install, real API checks, real vite build before shipping. Ask at most 3 questions first; if none needed, start.

*End of handoff. The Constitution outranks this file wherever they differ.*
