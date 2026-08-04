# GAME EMPIRE TYCOON
## The Empire Constitution — v1.0

*The founding document. Everything the project is, in one file. When in doubt, this file wins. When this file is wrong, amend it (Article XIV) — don't drift.*

---

## Article I — Identity

Game Empire Tycoon (GET) is **a game that builds a game company**. The player runs a studio; running the studio means actually making real, playable, exportable games. It is:

- **Standalone.** No LLMs, no cloud, no accounts, no external services. Works offline forever. A kid's games are theirs, on their machine.
- **A complete console.** Everything needed lives in the box: engine, editors, art tools, sound tools, starter assets. Lineage: PICO-8, Mario Maker, Game Builder Garage.
- **Finite by design.** A curated brick vocabulary, curated effect channels, curated templates. Lego, not clay. Constraints are the pedagogy.
- **A secret curriculum.** A kid who plays for three years ends up with a real library of games and maybe a few honest sales. Nobody says "curriculum" out loud.
- **Honest about money.** Real sales are logged as the legendary events they are. No pretend gold in the real ledger. (PAYDIRT DNA: only real dollars enter the ledger.)

### The Five Laws

1. **Everything is data.** A game is a JSON cartridge; the engine is an interpreter. Templates, bricks, scenes, animations, songs — all data, all inspectable, all remixable.
2. **One renderer.** Three.js renders everything, 2D and 3D. One scene graph, one effects chain, one export path. No second engine, ever.
3. **We can only do what we can understand to do.** Advanced power unlocks by *doing the sandbox*, not by grinding. Every knob teaches itself (Article X).
4. **Complete in the box.** If a game needs it, GET contains it. No step of making a game may require leaving the app (importing is allowed; requiring imports is not).
5. **Ship small, ship real.** Every phase ends with something playable or exportable. The single-file cartridge is sacred.

---

## Article II — The Player's Arc (the three-year secret curriculum)

The tycoon progression IS the curriculum. Studio "wings" open in order; each wing is a genre-plus-skills era.

| Era | Studio fiction | What actually unlocks | Real skills smuggled in |
|---|---|---|---|
| **Garage** (months 0–3) | Founding the studio | Pixel Atelier, SFX Foundry, Platformer template, basic bricks | Sprites, hitboxes, cause→effect logic |
| **First Office** (3–9) | First hires | Side-scroller & Word templates, Sound Booth (tracker), tile painting | Level design, rhythm/audio, difficulty curves |
| **The Annex** (9–18) | Story department | Story/Mystery & RPG templates, dialogue cards, stats/inventory bricks | Branching narrative, systems design |
| **The Tower** (18–30) | Tech department | 3D mode, Kit Bay, Level Stage 3D, Strategy template, effect channels | Cameras, spatial design, turn systems |
| **The Skunkworks** (30–36) | R&D wing | FPS/First-person template, Particle Lab full rack, Animation Loft advanced, shader slot (workshop mode) | 3D movement feel, VFX, performance |
| **Going Public** (ongoing) | Publishing arm | Cartridge export polish, itch.io shipping guide, real-sale ledger | Finishing, packaging, selling |

Rule: no era is time-locked — eras open by **shipped cartridges + completed sandboxes**, so a fast kid moves fast and a slow kid is never punished.

---

## Article III — System Map (the departments)

Renderer & Channels · Physics · Level Stage (editor) · Brick Workshop (logic) · Particle Lab · Animation Loft · Pixel Atelier · Kit Bay (3D primitives) · Sound Booth (tracker) · SFX Foundry · UI/HUD Wardrobe · Input Desk · Camera Unit · Save Vault (player saves) · Debug Deck · Codex · Pitch Meeting (template assembler) · Cartridge Press (export) · The Tycoon Shell (meta) · Warehouse (bundled assets).

---

## Article IV — Technology Manifest

All npm, all local, zero cloud, zero AI.

| Dependency | Job | Notes |
|---|---|---|
| `three` | Renderer, GLB via GLTFLoader (+DRACO, +KTX2), TransformControls gizmos, AnimationMixer, SkeletonUtils retarget | The one engine |
| `postprocessing` (pmndrs) | Effect channels: bloom, blur/DoF, vignette, noise, chromatic aberration, tone mapping | Better than stock EffectComposer |
| `@dimforge/rapier2d-compat` / `rapier3d-compat` | Physics, both dimensions, one vendor | WASM, deterministic |
| `yuka` | Game AI: steering (seek/flee/wander/arrive/flock), FSM, perception, navmesh | "Basic AI, not real AI" — bricks wrap these verbs |
| `tweakpane` | Inspector panels (internal editor UI) | Reskin later if kid-facing |
| `fflate` | Project zips, backups, warehouse packs | |
| `vite` + `vite-plugin-singlefile` | Dev server + single-file cartridge export | The Cartridge Press |
| *(no howler)* | Raw WebAudio | We wrote a tracker; we own audio |
| *(no inkjs, no blockly, no litegraph)* | Story = our own card format; bricks = our own outline UI | Finite > general |

**Bundled content licenses:** Warehouse ships **CC0 only** — Kenney (sprites, tiles, low-poly kits, UI, audio), Quaternius (rigged + animated characters). Mixamo clips are permitted in a *player's own games* via import+retarget but are **never bundled** in the product (Adobe license does not clearly permit redistribution). This line is bright and non-negotiable.

**Language:** Plain JS + JSDoc types. TypeScript only if pain demands it later.

---

## Article V — Repository Layout

```
game-empire-tycoon/
├─ index.html                 # the app shell
├─ src/
│  ├─ engine/
│  │  ├─ renderer.js          # scene, cameras (ortho/persp), channels chain
│  │  ├─ physics.js           # rapier 2d/3d wrappers
│  │  ├─ entities.js          # ECS-lite: entity, component registry
│  │  ├─ systems/             # per-domain update systems
│  │  │   ├─ motion.js  combat.js  triggers.js  story.js
│  │  │   ├─ ai.js (yuka)  camera.js  score.js  audio.js
│  │  ├─ animation/           # retarget, procedural cycles, tweens, flipbooks
│  │  ├─ particles/           # GPU sim, forces rack, presets
│  │  └─ runtime.js           # game-mode loop, save vault, input desk
│  ├─ editor/
│  │  ├─ shell.js             # app frame, tabs, project mgmt
│  │  ├─ stage.js             # level editor: gizmos, snap, prefabs, tiles, logic entities
│  │  ├─ bricks.js            # brick workshop outline UI
│  │  ├─ atelier.js           # pixel editor
│  │  ├─ kitbay.js            # primitive 3D builder
│  │  ├─ soundbooth.js        # mini tracker
│  │  ├─ foundry.js           # sfx generator
│  │  ├─ loft.js              # animation timeline / rig tools
│  │  ├─ lab.js               # particle lab
│  │  └─ codex.js             # explainers + sandboxes + unlock gates
│  ├─ meta/
│  │  ├─ tycoon.js            # studio fiction, eras, milestones, staff
│  │  ├─ pitch.js             # Pitch Meeting: interview + tag matcher + assembler
│  │  └─ ledger.js            # real-sale ledger (honest dollars only)
│  ├─ press/
│  │  └─ export.js            # single-file cartridge build
│  └─ data/
│     ├─ bricks/*.json        # the catalog (Article VII)
│     ├─ templates/*/         # manifest.json + starter scenes + presets
│     ├─ codex/*.json         # explainer entries + sandbox scenes
│     ├─ tags.json            # Pitch Meeting taxonomy + keyword table
│     └─ warehouse/           # CC0 packs, indexed with tags
├─ tools/                     # dev scripts (asset indexing, pack building)
└─ docs/CONSTITUTION.md       # this file
```

---

## Article VI — Data Constitution (schemas)

### Cartridge (project) file — `*.getgame.json`
```json
{
  "get": 1,
  "meta": { "title": "", "author": "", "created": "", "era": "garage", "template": "platformer" },
  "settings": { "mode": "2d", "palette": "kenney-a", "channels": ["bloom"], "input": {"jump": ["Space","GamepadA","TouchA"]} },
  "assets": { "sprites": [], "models": [], "songs": [], "sfx": [], "anims": [] },
  "scenes": [ { "id": "level1", "entities": [] } ],
  "bricksheets": { "player": [], "enemy-goomba": [] },
  "story": { "cards": [] },
  "saveSchema": { "coins": 0, "checkpoint": null }
}
```

### Entity
```json
{ "id": "door-3", "name": "Big Door", "prefab": "door",
  "components": {
    "transform": {"p":[0,0,0], "r":[0,0,0], "s":[1,1,1]},
    "sprite": {"asset":"door.png","frame":0},
    "body": {"type":"static","shape":"box"},
    "bricks": "door-rules",
    "tags": ["openable","metal"] } }
```

### Brick (the atom of logic) — When → [If] → Do
```json
{ "when": "touched", "by": "player",
  "if": [{"check":"hasItem","item":"key"}],
  "do": [{"act":"open"},{"act":"playSfx","sfx":"creak"},{"act":"award","points":10}] }
```
A **bricksheet** is an ordered list of these cards attached to an entity or the game itself. That's the whole logic model. No loops, no variables beyond named counters (`score`, `health`, custom counters), no expressions. If a behavior can't be said as When/If/Do cards, it becomes a new curated brick — the catalog grows, the grammar never does.

### Template manifest
```json
{ "id":"platformer", "era":"garage",
  "tags":["side-view","jump","run","collect","2d"],
  "modules":["motion2d","triggers","score","camera-follow"],
  "starter":"scenes/meadow.json",
  "brickPresets":["player-platformer","patrol-enemy","coin","checkpoint"],
  "questions":["hero","goal","tone","difficulty"] }
```

### Codex entry
```json
{ "id":"bloom", "dept":"fx", "voice":"sparks",
  "oneLiner":"Makes bright things glow.",
  "explainer":"Light spilling past where it should stop — like squinting at headlights...",
  "sandbox":"codex/sandboxes/bloom.json",
  "unlocks":["channel:bloom"] }
```

---

## Article VII — The Brick Catalog v1 (~72 bricks)

Grammar: **WHEN** (events) · **IF** (conditions) · **DO** (actions). Curated, versioned, documented. Target: every brick understandable by a 9-year-old with the Codex open.

**WHEN — events (16):** game starts · scene starts · touched (by X) · bumped from above/below/side · clicked/tapped · key pressed (action) · timer elapses · every N seconds · health reaches 0 · counter reaches N · item collected · enemy defeated · player enters zone · player leaves zone · message received · story card reached

**IF — conditions (12):** has item · counter ≥ / = / ≤ N · chance (%) · facing left/right · on ground · in zone · story flag set · timer running · era of day (game clock) · nearby (X within R) · health above/below N · difficulty is (easy/normal/hard)

**DO — motion (12):** move toward · move away · patrol between points · wander · chase (target) · flee (target) · jump · dash · teleport to · follow path · stop · face (target)   *(seek/flee/wander/arrive/flock ride on Yuka)*

**DO — combat & health (8):** deal damage · heal · knockback · become invincible (N s) · shoot (projectile) · explode · defeat self · respawn at checkpoint

**DO — world (10):** open/close · spawn (prefab) at · destroy · show/hide · swap sprite/model · play animation · shake camera · set checkpoint · lock/unlock zone · send message

**DO — story & score (8):** say (dialogue card) · show choice card · set story flag · award points · set counter · give item · take item · end game (win/lose screen)

**DO — sound & fx (6):** play sfx · play song · stop music · emit particles (preset) · flash channel (bloom pulse etc.) · slow time (N s)

Rules of the catalog: bricks are added only through the Constitution's amendment process; every brick ships with a Codex entry AND a sandbox; no brick may require another brick to be comprehensible.

---

## Article VIII — Pitch Meeting Tag Taxonomy

Deterministic. Interview answers + free-text keyword hits → tag vector → assembler scores templates, brick presets, warehouse packs, palettes, music seeds. Always ends on the **design-doc confirmation screen** ("Did we hear you right?" — every line editable).

**Axes:** `perspective` (side / top / first / iso) · `verb` (jump, shoot, solve, talk, build, collect, deliver, sneak, race) · `hero` (human, animal, robot, dragon, vehicle, blob…) · `goal` (rescue, escape, collect-all, reach-end, defeat-boss, uncover-truth, high-score) · `tone` (cozy, spooky, silly, epic, mysterious) · `world` (forest, city, space, dungeon, ocean, desert, house) · `difficulty` (chill, normal, spicy)

**Keyword table (excerpt):** "dragon"→hero:dragon, verb:fly · "pizza/deliver"→goal:deliver · "haunted/ghost"→tone:spooky, world:house · "detective/clue"→template:mystery, goal:uncover-truth · "castle"→world:dungeon · "puppy/cat"→hero:animal, tone:cozy. Unmatched pitch → staff asks one more structured question. Never fails, never guesses silently.

---

## Article IX — Embedded Studios (specs)

- **Pixel Atelier:** 16/32/64px canvases, layers-lite (2), curated palettes, flipbook frames, auto-hitbox suggestion, export to warehouse.
- **Kit Bay:** primitive construction (box/cylinder/sphere/wedge/plane), snap-together, per-face palette colors, save-as-prefab. The kid's Blender.
- **Sound Booth:** distilled Arranger — 4 channels, 32-step patterns, pattern chaining, voices: pulse/tri/saw/noise + 4 sample slots; song saves as data, renders at export.
- **SFX Foundry:** jsfxr-style parameter synth; preset buttons (jump, coin, hit, zap, boom, powerup) + mutate dice.
- **Particle Lab:** GPU sim (positions/velocities in textures); forces rack: gravity well(s), curl-noise field, vortex, wind, drag; n-body mutual gravity mode (GPU brute force to ~50k) for galaxy toys; presets: fire, smoke, magic, rain, snow, sparkle, galaxy.
- **Animation Loft:** standard humanoid rig = Mixamo bone naming; auto-retarget on import (SkeletonUtils); bundled CC0 clip library (Quaternius); procedural cycle generator (sliders: stride, bounce, swagger); tween timeline for props; flipbooks for 2D. Advanced drawer only.
- **AI Workshop:** bricksheets ARE the AI tool; steering/perception bricks surface Yuka. Outline UI v1 (drag-to-reorder cards); node canvas maybe never (finite > fancy).
- **Level Stage:** gizmos, grid+vertex snap, prefabs, tile painting (2D), logic entities (trigger zones, spawners, checkpoints, kill zones), play/stop toggle in place.
- **Debug Deck:** FPS graph, runtime entity inspector, collision wireframes, seeded RNG, event log. Built in Phase 1, not later.

---

## Article X — The Codex & Understanding Gates

Every brick, channel, tool, and advanced knob has: **one-liner → staff explainer (in fiction voice) → live sandbox**. The sandbox is a preset scene where the concept is the only variable.

**The Gate Rule:** advanced features unlock when their sandbox is completed once. The tutorial IS the lock. Corollary: nothing may ship without its sandbox — if we can't build the sandbox, we don't understand the feature well enough to ship it either.

Suggested staff voices (rename freely): **Pix** (art), **Echo** (sound), **Sparks** (FX/particles), **Watts** (engine/3D), **Quill** (story), **Scout** (AI/behavior), **The Founder** (tycoon shell, ledger, shipping).

---

## Article XI — Render Doctrine

One Three.js scene graph. `mode: "2d"` = orthographic camera + sprite/tile helpers; `mode: "3d"` = perspective + GLB/kit meshes. The **channels chain** (postprocessing) applies to both — bloom on a word game is legal and encouraged. Channel list v1: bloom, blur/DoF, vignette, noise/grain, chromatic aberration, pixelate, tone-map presets. Workshop mode (hidden dev flag, for the Founder-founder): raw GLSL material slot, channel parameter overrides, import anything.

---

## Article XII — Phase Gates

Each phase **ships when** its criterion is met. No phase starts before the prior ships.

- **P0 — Shell:** app frame, cartridge new/save/load (File System Access + zip fallback), warehouse browser, auto-backup zips. *Ships when: a cartridge survives a browser restart.*
- **P1 — Light & Deck:** renderer, 2D/3D cameras, channels chain, Debug Deck. *Ships when: a GLB and a sprite render with bloom, at 60fps, with the deck open.*
- **P2 — Stage:** gizmos, snap, prefabs, tiles, logic entities, play/stop. *Ships when: a level can be arranged and test-played without reloading.*
- **P3 — First Blood (vertical slice):** Platformer template + core bricks (~25) + Pixel Atelier + SFX Foundry + Cartridge Press. *Ships when: a complete tiny platformer exports as ONE html file and a kid-shaped human finishes it.*
- **P4 — Sound & Story:** Sound Booth, dialogue/choice cards, Word + Side-scroller + Story templates, Pitch Meeting v1. *Ships when: a pitched game assembles from the interview.*
- **P5 — Systems:** RPG + Strategy templates, counters/inventory bricks, A* grid, Codex fully wired with gates. *Ships when: an RPG with items and a shop exports.*
- **P6 — The Third Dimension:** 3D mode public, Kit Bay, Animation Loft, camera unit. *Ships when: a 3D collect-a-thon exports.*
- **P7 — Skunkworks:** Particle Lab full rack, FPS/first-person template, workshop mode. *Ships when: something explodes beautifully at 60fps.*
- **P8 — Going Public:** tycoon shell complete, eras, staff, real-sale ledger, itch shipping guide. *Ships when: the first real dollar is logged honestly.*

---

## Article XIII — The Do-Not-Build List

No custom physics. No hand-parsed GLB. No second renderer. No node-graph editor v1. No shader-graph tool. No multiplayer. No accounts or cloud saves. No plugin marketplace. No LLM/AI anything. No scripting language exposure to players (bricks only). No infinite anything.

---

## Article XIV — Amendments

The Constitution changes by explicit amendment: state the article, the change, the reason, bump the version, date it. New bricks, channels, templates, and tags are amendments to their catalogs. Drift without amendment is a bug.

**Amendment log:**
- v1.0 — Founding document.

---

*Signed in the garage era.* 🏗️
