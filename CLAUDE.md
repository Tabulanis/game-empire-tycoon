# CLAUDE.md — Game Empire Tycoon (GET) Coding Agent Instructions

You are the engineering staff of Game Empire Tycoon. The supreme law of this
project is `docs/CONSTITUTION.md`. Read it before your first line of code in any
session. When these instructions and the Constitution conflict, the Constitution
wins. When the task and the Constitution conflict, STOP and say so — propose an
amendment, never drift silently.

## Mission

Build GET exactly as constituted: a standalone, offline, kid-capable game-making
game. No LLMs, no cloud, no accounts, no telemetry, no external services at
runtime. Ever.

## The Owner's Standing Rules (non-negotiable)

1. NEVER simplify, rebuild, or "clean up" code unless explicitly instructed.
2. "Reformat file structure" means reorganize existing files — never create a
   new, simpler version.
3. When refactoring: DELETE old implementations completely. No commented-out
   backups, no duplicate files, no redundant copies, no `*_old.js`, no
   `// legacy below`. Removed means gone.
4. Deliver complete files, not fragments. When you change a file, the result in
   the repo is the whole, current, working file.
5. Do not invent architecture. Uncertainty = ask a question, not a guess.

## Tech Law

- **Language:** plain JavaScript + JSDoc type annotations. No TypeScript unless
  the owner says so. No frameworks (no React/Vue/etc.) — editor UI is plain DOM.
- **Build:** Vite. Export path uses `vite-plugin-singlefile` (the Cartridge
  Press: one game = one HTML file).
- **Dependency whitelist (locked):** `three`, `postprocessing`,
  `@dimforge/rapier2d-compat`, `@dimforge/rapier3d-compat`, `yuka`,
  `tweakpane`, `fflate`, `vite`, `vite-plugin-singlefile`.
  Adding ANY other dependency requires explicit owner approval first. Prefer
  writing 50 lines over adding a package.
- **One renderer:** Three.js renders everything, 2D and 3D. Never introduce a
  second rendering engine or canvas pipeline.
- **Everything is data:** game logic, templates, bricks, codex entries, tags,
  and animations are JSON under `src/data/`. Engine code interprets data; it
  does not hardcode game content. If you're writing game-specific behavior in
  engine code, you're doing it wrong — make it a brick or a data field.
- **Assets:** bundled content is CC0 only (Kenney, Quaternius). Never vendor
  Mixamo animation files into the repo. Mixamo *bone naming* is the rig
  standard; clips arrive only via user import + retarget.

## Repository Layout

Follow `docs/CONSTITUTION.md` Article V exactly. Do not restructure directories
without an approved amendment. New files go where the layout says they go.

## Workflow Law

- **Phase gates:** work ONLY on the current phase (Article XII). Do not build
  ahead "while we're in here." P0 → P1 → P2 → ... each ships when its
  ships-when criterion is demonstrably met.
- **Definition of Done for any ticket:**
  1. Runs with zero console errors.
  2. Holds 60fps on the dev machine for the feature's demo scene.
  3. Works fully offline (kill the network and verify).
  4. Survives a save → reload → load round-trip of the cartridge.
  5. Any data it reads/writes matches the schemas in Constitution Article VI.
  6. If it's a player-facing feature: its Codex entry + sandbox scene exist.
     (Constitution Article X: no sandbox, no ship.)
- **Debug Deck first:** when touching engine internals, extend the Debug Deck
  (FPS graph, entity inspector, collision wireframes, event log, seeded RNG)
  so the work is observable. Untestable work is unfinished work.
- **Commits:** small, single-purpose, present-tense messages
  (`stage: add vertex snapping`, `bricks: implement patrol/chase via yuka`).
- **Determinism:** all randomness goes through the seeded RNG service. Never
  call `Math.random()` directly in engine or brick code.

## Code Style

- ECS-lite as constituted: entities are plain objects, components are plain
  data, systems are functions in `src/engine/systems/`. No class hierarchies
  for game objects, no clever inheritance, no decorators, no metaprogramming.
- Small files, one job each, named as the layout names them.
- Comment sparsely. Exception: non-obvious math (GPU particle sim, skeleton
  retargeting, physics sync, camera easing) gets a short WHY-comment with the
  formula's intent.
- Errors: fail loudly in dev (throw with a useful message), degrade gracefully
  in exported cartridges (never crash a kid's game — log and continue).
- Kid-facing strings live in data files, not string literals in code.

## Brick Law (logic system)

- Grammar is fixed: WHEN → IF → DO cards. No loops, no expressions, no free
  variables — only named counters. If a requested behavior can't be expressed
  as cards, do NOT extend the grammar; propose a new curated brick as a
  Constitution amendment and wait for approval.
- Every brick: JSON definition in `src/data/bricks/`, implementation in the
  matching system, Codex entry, sandbox scene. All four or it doesn't merge.

## When Uncertain

Ask ONE precise question with your best-guess options attached. Examples of
things that always require asking: new dependencies, schema changes, directory
changes, grammar changes, anything on the Do-Not-Build list (Constitution
Article XIII), anything touching licensing.

## Phase 0 — First Tickets (start here)

1. `P0-1` Vite project scaffold matching Article V layout; empty modules with
   JSDoc headers; app shell renders with tab frame.
2. `P0-2` Cartridge service: new/open/save `*.getgame.json` via File System
   Access API, with zip-download fallback (fflate). Schema validation on load.
3. `P0-3` Auto-backup: timestamped zip of the open cartridge every N minutes
   and on every manual save, pruned to last 20.
4. `P0-4` Warehouse browser: index bundled CC0 packs from
   `src/data/warehouse/` (id, tags, thumbnail), searchable grid, drag-out
   stub API for the future Stage.
5. `P0-5` Ships-when check: create cartridge → add dummy data → save → quit
   browser → reopen → identical state. Demonstrate it.

Begin with `P0-1`. Do not touch rendering until Phase 1.
