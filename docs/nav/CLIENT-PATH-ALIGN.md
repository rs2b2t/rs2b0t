# Client path vs pack path / ground paint

**Status:** experimental debug features (opt-in Global settings under Show nav path).  
**Date:** 2026-08-03  

Operators see the painted webwalker route diverge from the tiles the client actually
walks after a click. This doc tracks root cause and the experimental dual-paint work.

## Two different pathfinders

| Layer | Where | Algorithm | Collision source |
|---|---|---|---|
| **Pack A\*** | `PathFinder` / `NavWorker` | A\* over world collision pack + door/transport graph | `out/collision.lcnav.gz` (baked at deploy) |
| **Client walk** | `Client.tryMove` | BFS on **scene** `CollisionMap` (104×104), cardinal + diagonal with wall flags | Live scene flags from map build + locs |

Walk clicks go through `ActionRouter.driver.walk` → `actions.walkTo` →
`raw.tryMove(..., tryNearest=true, type=0)`. That is the **only** path the server
accepts for gameclick movement.

## Why they disagree

1. **Different maps** — pack is full-world snapshot; client only knows the loaded scene.
2. **Chebyshev expand quirk** — `expandChebyshevSegment` uses `sign(dx)*step` for
   `max(|dx|,|dz|)` steps, so uneven diagonals **overshoot** the waypoint (documented
   in `pathExpand.test.ts`).
3. **Click horizon** — walker clicks ~20 path steps ahead; client may only route partway.
4. **Projection is fine** — `pathScenePaint` is camera-aligned; the bug is **tile sequence**.

## Explore implementation (this branch)

| Control | Default | Effect |
|---|---|---|
| `Global.navPathSceneExpand` | **false** (opt-in) | Pack path segments expanded with scene-flag BFS when both ends are in the loaded scene |
| `Global.navPathClientSegment` | **false** (opt-in) | After each successful walk click, paint the **exact** `tryMove` tiles |
| `Global.navPathColorClient` | `#00D4FF` | Solid trail colour when walking |
| `Global.navPathColorClientRunAlt` | `#FFFF00` | When run is on, alternate tiles use this (yellow) |

**How to try live**

```text
?Global.showNavPath=true
# optional: &Global.navPathSceneExpand=true&Global.navPathClientSegment=true
```

- **Red** = pack path (scene-expanded when possible).
- **Client trail** = last walk-click route as the **client** routed it
  (`Client.lastWalkPathLocal` from `tryMove`), trimmed to the player as you move.
  **Walk:** solid primary colour. **Run:** alternating primary / yellow tiles.
  No centre-line. Falls back to scene-flag BFS if the client buffer is empty.
- **Green** = transports; **white outline** = pack click target.

### Live harnesses (operator)

```bash
~/redeploy.sh   # branch explore/client-path-paint

# Focused paint compare (default classic pure-walk, dual paint ON)
HEADED=1 bun tools/nav-path-paint-live.ts
HEADED=1 CASES=lumb-dray,varrock-edge bun tools/nav-path-paint-live.ts
HEADED=1 LIMIT=1 PATH_PAINT_SCENE_EXPAND=0 bun tools/nav-path-paint-live.ts

# Stress suite paint cases only
HEADED=1 CASES=path-paint,paint-compare bun tools/nav-stress-live.ts

# Script routes with paint (default PATH_PAINT=1)
HEADED=1 LIMIT=10 USE_TELEPORTS=0 bun tools/nav-script-routes-live.ts
HEADED=1 LIMIT=2 PATH_PAINT=0 bun tools/nav-script-routes-live.ts   # paint off
```

Env toggles (all three harnesses): `PATH_PAINT_SCENE_EXPAND=0|1`, `PATH_PAINT_CLIENT_SEG=0|1`.

### Known limits

1. Client trail is the **current walk-click** only (not the entire remaining pack path).
2. Scene expand also feeds **corridor snap** (not paint-only) — keep off unless debugging.
3. Off-scene / multi-level / transport pack segments still Chebyshev.
4. `tryMove` records at most the scene-local path (104×104).

## Follow-ups

1. Paint the full remaining plan as one continuous trail.
2. Scene expand that only affects paint, not corridor snap.
3. Diff metric: pack vs client trail overlap for automated probes.

## Code map

| Concern | File |
|---|---|
| Scene/Chebyshev expand | `src/bot/nav/pathExpand.ts` |
| Publish + client segment | `src/bot/nav/pathPublish.ts` |
| Walk expand + segment publish | `src/bot/nav/WalkExecutor.ts` |
| Scene cyan paint + path line | `src/bot/nav/pathScenePaint.ts` |
| Settings | `src/bot/runtime/Settings.ts` (`navPathSceneExpand`, …) |
| Client walk + path capture | `src/client/Client.ts` `tryMove` / `lastWalkPathLocal` |
| Adapter world path | `src/bot/adapter/ClientAdapter.ts` `lastWalkPathWorld` |
| Step flags (fallback BFS) | `src/bot/nav/localReach.ts` `canStepLocal` |
