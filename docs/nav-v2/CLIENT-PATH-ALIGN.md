# Client path vs pack path / ground paint

**Status:** **EXPLORE branch** (`explore/client-path-paint`) — not upstream-ready.  
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
| `Global.navPathSceneExpand` | **true** (explore) | Pack path segments expanded with scene-flag BFS when both ends are in the loaded scene (`pathExpand.ts` → `WalkExecutor.expandWaypoints`) |
| `Global.navPathClientSegment` | **true** (explore) | After each successful walk click, paint a **cyan** scene-BFS polyline player→click tile |
| `Global.navPathColorClient` | `#00D4FF` | Colour for that segment |

**How to try live**

```text
?Global.showNavPath=true
# optional: &Global.navPathSceneExpand=true&Global.navPathClientSegment=true
```

- **Red** = pack path (scene-expanded when possible).
- **Cyan** = last walk-click client-like BFS (compare curves around walls).
- **Green** = transports; **white outline** = click target.

### Known limits (why not upstream yet)

1. Scene BFS is **our** `canStepLocal`, not a dump of `Client.dirMap` after `tryMove`
   (client buffers are private and discarded after the MOVE packet is built).
2. `tryNearest` may land one tile off the click; we still BFS to the **intended**
   pack path tile.
3. Scene expand changes the dense tile list used for **corridor snap**, not only paint —
   behaviour change beyond cosmetics (needs live soak).
4. Off-scene / multi-level / transport segments still Chebyshev.
5. HTML overlay may not yet dual-paint cyan (scene paint is the primary).

## Follow-ups

1. Expose last walk polyline from client (`tryMove` save route before packet) for exact match.
2. Gate scene expand behind a “paint only” mode that does not affect corridor snap.
3. Diff metric: % of cyan tiles not on red (and vice versa) for automated probes.
4. Optional HTML overlay cyan segment for operators who use overlay-only.

## Code map

| Concern | File |
|---|---|
| Scene/Chebyshev expand | `src/bot/nav/pathExpand.ts` |
| Publish + client segment | `src/bot/nav/pathPublish.ts` |
| Walk expand + segment publish | `src/bot/nav/WalkExecutor.ts` |
| Scene cyan paint | `src/bot/nav/pathScenePaint.ts` |
| Settings | `src/bot/runtime/Settings.ts` (`navPathSceneExpand`, …) |
| Client BFS walk | `src/client/Client.ts` `tryMove` |
| Step flags | `src/bot/nav/localReach.ts` `canStepLocal` |
