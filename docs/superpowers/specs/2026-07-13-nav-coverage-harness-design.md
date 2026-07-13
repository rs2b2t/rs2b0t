# Nav-tile coverage harness + bank-tile fixes (resilient-walking Phase 2) — Design

**Goal:** Systematically find every tile a bot web-walks to that is a sealed nook / island in the baked collision graph (so the bot can't actually reach it by walking), and repoint the flagged bank/approach tiles to connected tiles. This closes the "stuck at the bank" class the Phase-1 walker core can't fix (it's a bad-tile-config problem, not a walker problem — the collision baker is faithful to the server).

**Context:** The Phase-1 resilient-walker core shipped (escalation ladder, honest arrival, budget, retry-forever). Investigation proved the Varrock East bank stand `(3253,3418)` — used as `BANK_STAND` by EssMiner — is a genuine sealed nook (booths wall it north, building walls south) in BOTH the baked pack and the client, matching the server. Bots reach banks only via `openBooth`'s OPLOC server-walk, which masks the nook except on the cold-start-from-far case. This phase makes the whole class discoverable and fixes the offenders. Related: `docs/superpowers/specs/2026-07-13-resilient-world-walking-design.md`.

## Component 1 — the coverage harness

### Target registry: `src/bot/nav/data/navTargets.ts`

A curated, hand-maintained list (the `WALK_DESTINATIONS` pattern) of the tiles bots actually web-walk to:

```ts
export interface NavTarget { bot: string; label: string; tile: { x: number; z: number; level: number } }
export const NAV_TARGETS: NavTarget[] = [ /* ~23 entries: bank stands, furnace/anvil/range/quest stands */ ];
```

Seeded from the current bot constants (the ~23 distinct `new Tile(...)` bank/stand tiles enumerated across `src/bot/scripts/*.ts`, e.g. EssMiner `(3253,3418)`, ArdyThiever/ArdyFighter `(2655,3286)`, CookBot `(2809,3441)`/`(2817,3443)`, SmelterBot `(3275,3185)`, SmithingBot `(3188,3425)`, FlaxSpinner `(2722,3493)`/`(2711,3471,1)`, etc.). A comment ties each entry to its owning bot constant so they stay in sync.

### Pure logic: `tools/nav/coverageLogic.ts` (client-free, unit-tested)

- `classifyTarget(finder, target, anchor): 'ok' | 'unwalkable' | 'island'` — using an injected reachability interface so it's testable against a tiny synthetic collision (no build artifact):
  - **unwalkable**: the EXACT tile is not walkable in the pack.
  - **island**: walkable but not reachable from `anchor` (Lumbridge) OR can't reach `anchor` back (both directions, since PathFinder's radius-5 goal snap otherwise hides a 1-tile nook — check reachability to the EXACT tile, radius 0).
  - **ok**: walkable and mutually connected.
- `nearestConnected(finder, tile, anchor, maxRing): {x,z,level} | null` — Chebyshev-ring BFS outward from `tile` for the nearest walkable tile that IS connected to `anchor`, so a flagged tile ships with a concrete suggested replacement.

Exact-tile reachability needs a radius-0 path check; the harness passes a `maxExpansions` cap and treats "reached the exact tile" as connected (not the radius-5 snap). If `PathFinder` has no radius-0 mode, `coverageLogic` does its own connectivity via the pack's walk/exit bitsets (a small BFS) rather than `findPath` — decided at implementation time by reading `PathFinder`'s goal handling; the classification contract above is fixed either way.

### The tool: `tools/nav/coverage.ts`

Loads `out/collision.lcnav.gz` + the real `PathFinder` (+ `doors.json`/`transports.json`), like `bench-path.ts`. For each `NAV_TARGET`, runs `classifyTarget`; for each non-`ok`, prints `bot label (x,z,level): <kind>; nearest connected = (x',z',level')`. Prints a summary and **exits non-zero if any target is not ok** (so it can gate a build / smoke sweep). A `--anchor x,z` override and `--pack <path>` flag (default `out/collision.lcnav.gz`) mirror bench-path.

## Component 2 — the bank/approach-tile fixes

Run the harness; for each flagged tile, repoint the owning bot's constant/default to the harness's suggested nearest-connected tile (or a hand-picked better one if the suggestion is awkward — verified by re-running the harness). Banking stays OPLOC-first (`openBooth`): the walk only needs to reach the connected approach tile; the server-walk finishes onto the booth. Known offender: EssMiner `BANK_STAND (3253,3418)`. Others surface when the harness runs — the fix set is "whatever the harness flags," not a guessed list.

For each repointed bot: re-run the harness (that target now `ok`) and, where the bot has a live smoke (EssMiner especially), re-run it to confirm the loop still works end-to-end.

## Testing

- **Unit** (`test/bot/nav/coverageLogic.test.ts`): `classifyTarget` returns `ok`/`unwalkable`/`island` correctly against a hand-built synthetic collision (an open field, a walled-off pocket, an off-map tile); `nearestConnected` finds the nearest connected ring tile and returns null when boxed in. No build artifact — pure logic with injected reachability.
- **Real-pack** (run `bun tools/nav/coverage.ts` after `bun run build:bot`): before the fixes it flags `(3253,3418)` (island) with a suggested replacement; after the fixes it exits 0 (all targets ok).
- **No-regression:** re-run `tools/essminer-test.ts` (the repointed EssMiner still completes its loop) + `tools/nav/bench-path.ts` (routes unaffected).
- Wire `coverage.ts` into the build or `run-all-smokes` so a future bad-tile config fails loudly.

## Risks / non-goals

- **Registry drift:** `navTargets.ts` is hand-maintained; a new bot's nav tile must be added. Mitigated by the per-entry comment linking to the bot constant, and the harness gating so a wrong tile is caught if listed. (Auto-discovery from settings/AST is a non-goal — incomplete + fragile.)
- **The harness finds bad tiles; it does not fix collision data.** The baker is faithful (established Phase-1); a genuinely-mis-baked tile (if ever found) would be a separate baker/data investigation, not this harness's job.
- **Non-goals:** live route-walking coverage, a general "walk between all destination pairs" matrix, and any change to the Phase-1 walker core.
