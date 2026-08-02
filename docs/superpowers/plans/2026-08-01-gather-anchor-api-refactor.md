# Gathering / Anchor API Refactor

> **Status:** in progress on `refactor/gather-anchor-api` (Phase 1 started after #282 landed).  
> Phase 1: helpers moved to `api/`; Cook/Smelt/Smith/Flax use `withinOf`.

**Goal:** Pull duplicated leash / soft-home / nearest-target policy out of fat scripts (especially `GatheringBot`) into `src/bot/api/`, so mine/fish/cook/thieve/fighter scripts share one implementation instead of re-copying Chebyshev disks and “return to pin” walks.

**Context (2026-08):** Fishing camp membership + player chase and mine local-prefer / post-deplete cooldown fixes landed (or are landing) as product PRs. Those pure helpers currently live in `GatheringBot.ts` exports; they are the first extraction targets.

## Why

| Already API | Script-local / duplicated |
| --- | --- |
| `api/Anchor.ts` — `beyondLeash`, `tileWithinLeash`, `createReturnToAnchorTask` | Soft home (`HOME_ARRIVE_RADIUS`, `shouldWalkHomeToGatherAnchor`, `shouldSoftHomeFromGatherMiss`) only in GatheringBot |
| `api/GatheringLocations.ts` — camps, `campRadius` / `chaseRadius` | `pickNearestPreferLocal`, tile cooldown policy only in GatheringBot |
| `Query.nearest()` — global player distance | Cook/Smelt/Smith/Flax hand-roll `tile.distanceTo(stand) <= leash` |
| | Chicken/Chaos/AutoFighter reimplement return-to-anchor with different slack (`+4` / `+8` / `+10`) |

`GatheringBot.ts` is ~5k+ lines and exports ~15 pure policy functions that are not “bot class” concerns.

## Sequencing (less effort)

1. **Land product fixes first** (mine nearest, any remaining gather thrash) as small PRs.  
2. **Then** open `refactor/gather-anchor-api` from that `main`.  
3. Do **not** start the refactor under unfinished gather branches — same files (`findRock` / `executeMine` / helpers) thrash on rebase.

## Branch

- **Name:** `refactor/gather-anchor-api`  
- **Base:** `main` after mine/fish gather fixes merge  
- **PR style:** behavior-preserving extract + thin adopters; no headed suite required for Phase 1

## Phase 1 — API surface (no behavior change)

Move pure helpers + unit tests; GatheringBot re-exports aliases if anything still imports from the script path.

| Destination | Contents |
| --- | --- |
| Extend `api/Anchor.ts` (or `api/SoftHome.ts`) | `HOME_ARRIVE_RADIUS`, `shouldWalkHomeToGatherAnchor`, `shouldSoftHomeFromGatherMiss` |
| New `api/TargetPick.ts` (or extend `Query.ts`) | `LOCAL_MINE_PREFER_RADIUS`, `pickNearestPreferLocal`, `shouldCooldownGatherTile` |
| Optional `api/GatherCamp.ts` / keep in `GatheringLocations.ts` | `resourceWithinCamp`, `effectiveGatherLeash`, `gatherHuntRadius`, `spotWithinGatherRange`, `gatherSpotRangeOrigin` |
| Extend `api/queries/Query.ts` | `nearestPreferLocal(preferRadius)`, `withinOf(tile, r)` so scripts stop hand-rolling distance filters |
| Tests | Move from `test/scripts/GatheringBotLogic.test.ts` → `test/api/…` |

### Checklist

- [x] Create branch from updated `main`
- [x] Extract pure functions; keep GatheringBot imports working (re-export or update imports)
- [x] Move/adjust unit tests under `test/api/` (added TargetPick + GatherCamp tests; GatheringBotLogic still re-exports)
- [x] `bun test` green for api + GatheringBotLogic

## Phase 2 — adopters (behavior-preserving)

- [x] **GatheringBot** — fish + mine paths call API only
- [ ] **ThievingBot** — soft-home / return-to-anchor options aligned with Anchor helpers
- [x] **Cook / Smelt / Smith / Flax** — `Locs.query()…withinOf(stand, leash).nearest()`
- [ ] **Chicken / Chaos / AutoFighter** (optional, lower priority) — shared leash+slack target filter

## Phase 3 — only if still sloppy

- [ ] Split GatheringBot into `scripts/gather/*` without product behavior change
- [ ] Document membership vs player-prefer vs soft-home in `docs/API.md`

## Explicit non-goals (first PR)

- No new gather features  
- No headed / deploy verification required for pure moves  
- No forced rewrite of every fighter on day one  
- No tick-manip shipping changes (`TICK_MANIP_SHIPPED`)

## Success criteria

- Target-pick / soft-home helpers have **one** implementation under `api/`  
- GatheringBot loses the pure-function block (or only re-exports)  
- At least 2–3 non-gather scripts use the same query helpers  
- Unit tests pass; mine/fish regression tests still green  

## Related product work (do not re-litigate here)

- Named-camp fish: membership + no player-distance wall; freeform hunt pad  
- Mine: prefer rocks within 12 of player; no post-deplete tile cooldown (iron respawn ~6t vs old 8t skip)  
- Server rock ids: `api/MiningRocks.ts` / Server `skill_mining` `rocks.loc` + `loc.pack` (iron 2092/2093)

## Resume prompt (for a future agent)

```
Implement docs/superpowers/plans/2026-08-01-gather-anchor-api-refactor.md
Phase 1 only: extract gather/anchor pure helpers into api/, move tests, keep behavior.
Branch from main after gather mine/fish fixes are merged.
```
