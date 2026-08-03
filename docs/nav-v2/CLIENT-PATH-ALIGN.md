# Client path vs pack path / ground paint (notes)

**Status:** exploration notes for follow-up work (not a shipped design).  
**Date:** 2026-08-03  
**Context:** operators see the painted webwalker route diverge from the tiles the
client actually walks after a click.

## Two different pathfinders

| Layer | Where | Algorithm | Collision source |
|---|---|---|---|
| **Pack A\*** | `PathFinder` / `NavWorker` | A\* over world collision pack + door/transport graph | `out/collision.lcnav.gz` (baked at deploy) |
| **Client walk** | `Client.tryMove` | BFS on **scene** `CollisionMap` (104×104), cardinal + diagonal with wall flags | Live scene flags from map build + locs |

Walk clicks go through `ActionRouter.driver.walk` → `actions.walkTo` →
`raw.tryMove(..., tryNearest=true, type=0)`. That is the **only** path the server
accepts for gameclick movement.

Paint draws `PathPublish` tiles, which come from **pack** waypoints expanded by
`expandWaypoints` (Chebyshev diagonal steps between waypoints) — **not** the
client BFS polyline from `tryMove`.

## Why they disagree

1. **Different maps** — pack is full-world snapshot; client only knows the loaded
   scene and its loc-built flags. A door open/closed mid-walk changes scene flags
   but not the pack path until repath.
2. **expandWaypoints ≠ route** — between pack waypoints we draw a Chebyshev
   diagonal corridor. Client BFS prefers open 8-connected steps with wall tests
   (`CollisionFlag.PL_WALK_*`); it often takes a different polyline around a wall.
3. **Click horizon** — walker clicks ~20 path steps ahead; client may only route
   partway (`tryNearest`) or refuse the tile entirely (`tryMove` → false).
4. **Projection paint is scene-aligned** — `pathScenePaint` uses the same camera
   projection as the 3D world (so the quads sit on the ground). Remaining visual
   “offset” is usually **wrong tile sequence**, not wrong screen projection.

## "I can't reach that!"

- Server gamechat `I can't reach that!` is emitted when an **interaction** cannot
  be pathed (loc/npc ops). Transport/door execute already fail-fast on
  `GameMessages` + `CANT_REACH` (since `d001764`).
- **Plain walk clicks never listened** for that line historically — not a
  regression from nav-v2, just a gap. Client-side, `tryMove` returns `false`
  without chat when scene BFS fails (no packet).
- Fix direction (this branch): honor `walk()` false by trying closer path tiles,
  then repath immediately; also repath if `CANT_REACH` appears after a walk click.

## Follow-ups (not in this change)

1. **Paint client route after click** — after successful `tryMove`, read
   reconstructed steps from client route buffers (if exposed via adapter) and
   paint those as the “active segment”.
2. **Expand waypoints with local BFS** — for same-level segments inside the scene,
   replace Chebyshev fill with `canStepLocal` / flag-aware BFS so paint matches
   what `tryMove` would walk.
3. **Prefer tryMove when choosing click** — already done for walk clicks via
   `selectClientWalkTarget`; extend stall recovery the same way (done).
4. **Scene-flag repath triggers** — on door open/close packets, invalidate pack
   path if the current click target becomes unwalkable in scene flags.
5. **Optional clone of engine client** under `/tmp` for side-by-side `tryMove`
   vs pack A\* dumps (this repo already vendors `src/client/Client.ts` tryMove).

## Code map

| Concern | File |
|---|---|
| Client BFS walk | `src/client/Client.ts` `tryMove` |
| Collision flags | `src/dash3d/CollisionMap.ts` |
| Walk click | `src/bot/input/DirectInputDriver.ts` → `actions.walkTo` |
| Pack path expand + follow | `src/bot/nav/WalkExecutor.ts` `expandWaypoints` / `followPath` |
| Scene paint | `src/bot/nav/pathScenePaint.ts` |
| Cant-reach chat | `src/bot/events/gameMessages.ts` `CANT_REACH` |
