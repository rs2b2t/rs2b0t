[Manual](../README.md) › [World-walking](../NAV.md) › Walker

# The world walker

One `PathFinder` / `WalkExecutor` / transport graph. No classic/v2 dual stack.

| Concern | Behaviour |
|---|---|
| Graph | doors + transports + stairs + **travelCatalog** (spirit/glider/Entrana/cart/essence/levers/agi) |
| Requires | skill / quest / coins via `specialRequires` + catalog; live fail-closed, pack fail-open |
| Execute | doors, ships, gangplanks, gliders, spirit trees, carts, open-loc fast path — one `exec/` |
| Tele catalog | **Off by default** — see [Nav teleports](nav-teleports.md) |
| Path-scoped bank | one leg for runes/tolls when the planned path needs items (tele bank-plan only when nav teles on) |
| Hop logs | transport hop logging on walks |
| Heuristic | Chebyshev; **Dijkstra** when long-range edges exist (#335) |
| Paint / camera | optional globals (`showNavPath`, `navCameraFollow`) |

## Arrival

[`arrival.ts`](../../src/bot/event/webwalk/geometry/arrival.ts) answers "are we there?" honestly, and the
subtlety is that many destinations are **not standable** — a bank booth, a furnace,
a tree are all solid.

```ts
if (dist === 0) return true;                       // on it
if (probe.canReach(dest)) return true;             // adjacent and reachable
if (probe.walkable(dest)) return false;            // walkable but not reached — keep going
return !probe.probeable(dest) || probe.canReachAdjacent(dest);
```

So arriving *at* an unwalkable destination means standing beside it. A destination
that is walkable but unreached is never called arrived, which is what keeps "as close
as I could get" from masquerading as success.

Some bank stands are sealed collision **islands** in both the baked pack and the
client — banks are object-only tiles. "Never stuck at a bank" is therefore a
collision-data fix, not a walker fix.

## The Reach primitive

Most last-mile bugs came from every caller hand-rolling its own approach loop.
[`Reach`](../../src/bot/api/walking/Reach.ts) is the shared one — **use it rather than writing
another**:

```ts
await Reach.locOp({ near, ... });     // walk to a stand, then operate a loc
await Reach.npcDialog({ near, ... }); // walk to a stand, then talk to an NPC
```

It walks to the caller's `near` stand, performs the action, and — when the *server*
replies that it cannot reach — opens the blocking door and retries. It does not try to
race a door's re-shut. Status is explicit: `'done' | 'retry' | 'unreachable'`.

For a **loc** that server verdict decides it, and Reach runs no client-side
search. An **NPC** is different: the server only says "I can't reach that!" once its
own path search dead-ends, and a target that keeps wandering postpones that
indefinitely — clicking a farmer shut in the next room walks you to the door and
leaves you there, silently, forever. So the NPC paths (`npcDialog`, and `entityOp`
under `openWhenUnreachable`) probe the scene themselves and open the door on their own
verdict. A wrong probe is harmless: it falls through to the ordinary click.

That probe is only trusted within `PROBE_RADIUS` on the same level. `REACH_BFS_STEPS`
expansions run out at about eleven tiles of open ground, so past that "too far to
search" is indistinguishable from "walled off" — and a patrolling target would have
the bot opening doors it never needed.

`Reach.npcDialog` searches the scene and lets the server walk the player to the
target, so it follows an NPC that wanders. A leash-limited approach loop cannot — a
patrolling NPC walks out of range and the interaction is abandoned.

## When it gets stuck

[`walkLadder.ts`](../../src/bot/event/webwalk/walkLadder.ts) is an escalation ladder rather than a
retry count. It tracks progress, backs off, and after `UNREACHABLE_PASSES` concludes
the destination is unreachable — reporting `'arrived' | 'closest' |
'budget' | 'failed' | 'interrupted'` rather than silently spinning.

`classifyReason` separates "ran out of budget" from "failed", so a caller can tell a
slow route from an impossible one.

## Tuning constants

The top of [`WalkExecutor.ts`](../../src/bot/event/webwalk/WalkExecutor.ts) is a block of bare
numbers. What they govern:

| Constant | Meaning |
|---|---|
| `TARGET_STEPS`, `TARGET_JITTER` | how far ahead to click, and the randomisation on it |
| `ARRIVE_RADIUS` | how close counts as arrived |
| `PROGRESS_WINDOW` | how far ahead `locateOnPath` scans |
| `CORRIDOR` | how far off-path still counts as on-path |
| `OFF_CORRIDOR_STRIKES` | consecutive off-corridor passes before re-pathing |
| pathFollow `stallTicks` (default 9) | server ticks without **tile change** before stall recovery / repath (not reset on walk clicks) |
| `UNREACH_CLICK_IDLE_TICKS` | idle ticks before clearing an unreachable mid-path walk click (re-pick only; not stall recovery) |
| `MAX_REPATHS` | re-plans allowed for one walk |
| walk `timeoutMs` | wall-clock budget for the `walkTo` (shared across repaths); `walk timed out` when exhausted |
| `TRANSPORT_WAIT_MS` | how long to wait for a crossing to complete |
| `MULTI_DOOR_CROSS_MS` | budget for a door-dense interior |
| `OPEN_WAIT_MS` | how long to wait for a leaf to open |

## Path camera

Optional orbit-camera path facing so operators can see the route being walked
(diagnostics / recordings). **Off by default.**

| Setting | Default | Override |
|---|---|---|
| Global `navCameraFollow` | `false` | `?Global.navCameraFollow=true` |

When on, [`WalkExecutor`](../../src/bot/event/webwalk/WalkExecutor.ts) samples a path-facing yaw
each follow tick and [`PathCameraFollow`](../../src/bot/event/webwalk/cameraFollow.ts) eases the
orbit yaw on the **client frame loop** (not once per walk tick), so turns feel like
a human holding left/right rather than stepping.

- Yaw uses client units `0–2047` (same as [`Game.cameraYaw`](../reference/api-game.md#camera-client-only)).
- Lookahead stops at **transport boundaries** (level change, same-plane dungeon
  jumps such as z ± 6400, or a transport waypoint) so the camera aims at the local
  ladder/object, not the remote landing.
- Independent of path paint (`showNavPath`); both may be on together.
- Client camera packets remain rate-limited by the client itself.

Scripts that need a one-shot aim should call `Game.setCameraYaw` directly; prefer
the Global setting for continuous walk follow.

## See also

- [World-walking](../NAV.md)
