# bricks/

One JSON file per curated brick. Constitution Article VII holds the catalog.

Every brick needs all four before it merges:
1. JSON definition here
2. implementation in the matching `src/engine/systems/` module
3. a Codex entry in `src/data/codex/`
4. a sandbox scene

Grammar is fixed: WHEN -> IF -> DO. No loops, no expressions, no free variables.
Populated in Phase 3.
