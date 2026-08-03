[Manual](README.md) › World-walking

# World-walking

Getting a bot from where it is to where it needs to be, across the whole map,
through doors, gates, stairs, and paid ship crossings — and knowing honestly whether
it arrived.

The hard part is not the search. It is that the client can only express movement as
*clicks on tiles it can see*, while the destination is usually off-screen, behind a
shut door, or on another level.

> **Nav v2 (experimental)** — see [Nav v2](#nav-v2-experimental) below and
> [`docs/nav-v2/`](nav-v2/README.md). Default walker remains **classic**.

## Contents

- [The collision pack](#the-collision-pack)
- [Pathfinding](#pathfinding)
- [Following a path](#following-a-path)
- [Corridor snap](#corridor-snap)
- [Doors](#doors)
- [Special crossings](#special-crossings)
- [Nav v2 (experimental)](#nav-v2-experimental)
- [Path camera](#path-camera)
- [Route corpus / HARD stress](#route-corpus--hard-stress)
- [Level-change loc lag](#level-change-loc-lag)
- [Arrival](#arrival)
- [The Reach primitive](#the-reach-primitive)
- [When it gets stuck](#when-it-gets-stuck)
- [Tuning constants](#tuning-constants)

## The collision pack

The client only knows collision for the scene it has loaded. World-scale pathfinding
needs the whole map, so collision is **baked ahead of time** from an engine's data by
[`tools/nav/build-collision.ts`](../tools/nav/build-collision.ts) into
`out/collision.lcnav.gz`.

The pack is built from *the engine you are deploying into*
([`tools/deploy-local.sh`](../tools/deploy-local.sh) does it on first run), so it
matches that server's map. Alongside the raw collision it carries a graph of
traversal edges that plain collision cannot express:

| Data | Source | What it adds |
|---|---|---|
| [`doors.json`](../src/bot/nav/data/doors.json) | [`tools/nav/derive-doors.ts`](../tools/nav/derive-doors.ts) | openable barriers, and which tiles they join |
| [`stairEdges.json`](../src/bot/nav/data/stairEdges.json) | [`tools/nav/derive-stairs.ts`](../tools/nav/derive-stairs.ts) | stairs and ladders, so paths can change level |
| [`transports.json`](../src/bot/nav/data/transports.json) | curated | edges the derivations cannot infer |

Multi-level routing is therefore a **data** property, not an algorithm one: the
executor already knows how to climb, and gains a new route the moment an edge for it
exists in the pack.

So is *same-level* routing, wherever the link is an Agility shortcut. `derive-doors`
only sees doors, so a balance log or a climbable outcrop leaves two regions looking
disconnected however open they are in game. Southern Karamja was the extreme case:
the 6,193-tile jungle holding the Ah Za Rhoon mound and Rashiliyia's tomb, and all of
Cairn Isle, were unreachable from anywhere until four `kind: "dungeon"` edges — a
wooden log and a set of climbing rocks — were curated in. When a quest reports a stand
tile as `pathable-from=[nothing]`, look for the shortcut before touching the walker.

A pack-less checkout is a silent failure mode — the navigator has nothing to search,
so every route fails rather than erroring loudly.

## Pathfinding

[`PathFinder`](../src/bot/nav/PathFinder.ts) is A\* over the pack, running inside a
worker ([`NavWorker.ts`](../src/bot/nav/NavWorker.ts)) so a long search never stalls
the game loop. [`Navigator`](../src/bot/nav/Navigator.ts) is the front end:

```ts
const path = await Navigator.findPath(from, to, { avoidDoors, timeoutMs, maxExpansions });
```

### Danger zones (optional avoid)

Scripts can ban axis-aligned map rects from A\* so low-level accounts do not walk
wolf packs (idea **@lolwut**). Known ids live in
[`dangerZones.ts`](../src/bot/nav/data/dangerZones.ts); pass them on any walk
(`walkTo` or `walkResilient` — resilient forwards them on every baked repath):

```ts
await Traversal.walkResilient(dest, {
  radius: 2,
  avoidZones: ['white-wolf-mountain'],
  // or ad-hoc: { minX, maxX, minZ, maxZ, level? }
});
```

The pathfinder never expands *into* those tiles (walk or transport landing). A
start tile already inside a zone can still path *out*. Off by default — no
routing change unless a script (or future Global setting) opts in.

**Pack check (baked collision):** Taverley bank ↔ Catherby bank free path crosses
White Wolf Mountain (~cost 239, dozens of zone tiles). With
`avoidZones: ['white-wolf-mountain']` the same OD stays outside the zone
(~cost 710+, longer coastal/ship detour, zero zone tiles). Unit tests live in
`test/nav/dangerZones.test.ts`.

The outcome is explicit about failure:

```ts
type PathOutcome =
    | { ok: true;  waypoints: Waypoint[]; cost: number; expanded: number }
    | { ok: false; reason: string;        expanded: number };
```

A `Waypoint` may carry a `TransportInfo`, which is how a door, stair, or ship
crossing is represented mid-path. `avoidDoors` lets a caller re-path around a barrier
that just refused to open.

[`DirectNavigator`](../src/bot/nav/DirectNavigator.ts) is the script-facing wrapper —
see [Movement](API.md#movement).

## Following a path

[`WalkExecutor`](../src/bot/nav/WalkExecutor.ts) turns waypoints into clicks. Each
pass it:

1. locates the player on the path ([corridor snap](#corridor-snap));
2. picks the furthest clickable tile within reach and clicks it;
3. watches for arrival, deviation, a shut barrier, or a stall;
4. re-paths when the world disagrees with the plan.

The pure geometry is split into [`followMath.ts`](../src/bot/nav/followMath.ts) so it
can be unit-tested without a client — [`test/nav/followMath.test.ts`](../test/nav/followMath.test.ts)
is the executable specification of the rules below.

## Corridor snap

The player is rarely exactly on a path tile: the server walks its own route, so the
bot drifts a tile or two off the plan. `locateOnPath` therefore matches the
**furthest** path index within `CORRIDOR` tiles of the player, scanning only a window
ahead of the last known index:

```ts
for (let i = fromIdx; i < Math.min(fromIdx + window, tiles.length, limitIdx + 1); i++) {
    if (tiles[i].level === me.level && chebyshev(tiles[i], me) <= corridor) found = i;
}
```

The window matters. A path that folds back on itself passes near its own earlier
tiles, and an unwindowed search would "advance" the bot across a fold it never
walked.

`selectClickTarget` then picks a target **by path index, not straight-line
distance** — the furthest clickable tile at or before the limit, walking backwards
from the top:

```ts
for (let i = top; i > pathIdx; i--) { if (isClickable(tiles[i])) return i; }
```

Choosing by distance instead would cut corners across walls, because two tiles either
side of a wall are adjacent in space and far apart along the path.

### The starvation case

Those two rules interact badly at very short range. `selectClickTarget` searches
strictly `i > pathIdx`, and the terminal snap can put `pathIdx` **on the last tile**.
For any hop of three tiles or fewer the search window is then empty, and the executor
emits **zero clicks** — reporting "blocked" or "as close as reachable" while standing
still, having never tried.

`starvedTerminalIndex` is the rescue: when the player is not already on the end tile
and the end tile is clickable, it returns the terminal index directly.

```ts
export function starvedTerminalIndex(tiles, me, isClickable): number {
    const end = tiles[tiles.length - 1];
    if (end.level !== me.level || (end.x === me.x && end.z === me.z)) return -1;
    return isClickable(end) ? tiles.length - 1 : -1;
}
```

**Players and NPCs never block navigation.** A bot standing on your destination tile
is not why a walk failed — this was proven live with two clients stacked on one tile.
Suspect click starvation or a door instead.

## Doors

A door is a path edge whose two tiles are not otherwise connected. Crossing one is
three separate problems, and conflating them is the classic bug:

- **Opening is not crossing.** The leaf animating open does not mean the player moved
  through it. The executor verifies the crossing itself — `isOnFarSide` compares
  distances to the near and far tiles rather than trusting the door's state.
- **Arrival at a door is wall-aware.** Plain Chebyshev distance says the tile on the
  other side of a wall is adjacent. `crossingEligible` requires the landing to be
  genuinely reachable before the crossing is triggered.
- **A door can re-shut** while you approach. `shouldApproachClosedBarrier` decides
  whether to close in first, and `chooseCrossClick` picks between stepping directly,
  clicking the landing tile, or clicking it in the scene.

Doors that are scripted to refuse entry from one side are **never** baked as
bidirectional — a one-way door baked both ways lures paths into dead ends. Double
doors are opened from the **exterior** stand; standing on a leaf wedges the crossing.

A door that refuses from *both* sides is not a door at all, and `derive-doors` skips
the type outright. `Open` in a loc's ops says nothing about whether the script honours
it: McGrubor's Wood's front gate is locked from inside the wood and guarded by the
Forester from outside, so the only way through the fence is the Loose Railing one
`Squeeze-through` edge away — curated, because "Squeeze-through" is not an `Open`.

## Special crossings

Some barriers need more than an `Open`: a toll, a fare, a dialogue, or a quest state.
Those are curated in
[`specialCrossings.ts`](../src/bot/nav/data/specialCrossings.ts):

```ts
{ x: 3268, z: 3227, level: 0, locName: 'Gate', action: 'Open',
  requires: { item: 'Coins', count: 10 }, dialogue: { choose: ['Yes, ok.'] },
  label: 'Al Kharid toll gate' }
```

`specialCrossingAt(x, z, level)` finds one, `meetsRequirement` checks affordability,
and `pickChoice` matches a dialogue option case-insensitively by substring so small
wording differences do not break a route.

Some barriers need a **permanent quest unlock** rather than a one-shot dialog at the
gate. Mort Myre’s Ulizius gate is a hard mesbox while Nature Spirit is not started;
once started the gate opens with no dialog. Those crossings carry `unlockQuest`: if
the quest is red, the executor walks to the NPC (`Drezel` in the Paterdomus mausoleum
after Priest in Peril), drives the start dialogue, returns to the gate, then opens it.

When the unlock NPC **grants items** on accept (Drezel: six unstackable pies), set
`freeSlots`. The executor banks disposable junk first if the pack is tight; if there
is still not enough space (or no bankable junk / bank unreachable), it **gives up**
rather than half-starting the quest or dropping gear.

A crossing can also gate on a **skill**, which is how Agility shortcuts are modelled:

```ts
{ x: 2598, z: 3477, level: 0, locName: 'Log balance', action: 'Walk-across',
  requiresSkill: { name: 'agility', level: 20 },
  label: 'Coal trucks log balance' }
```

`meetsSkill` checks it in the same two places `meetsRequirement` is checked — pruning
in `resetAvoids`, refusing in `handleSpecialCrossing`. Pruning is the important half:
without it a sub-20 account paths at a log it can never walk and wedges there, instead
of taking the long way round. The coal trucks log cuts mine→Seers from cost 263 to
156, and prunes back to 263 — still reachable — below the gate.

Note these entries are keyed at the edge's **`from` tile**, not the loc's own tile,
because `PathFinder` records `transport.locX/locZ` as the edge origin. A two-way
shortcut therefore needs two entries, one per direction.

Ship crossings carry a `toTile`, because they teleport rather than step — the
executor waits to land near that tile instead of watching for an adjacent move. A
crossing the bot cannot afford should be avoided **during planning**; discovering it
at the gate wastes the whole walk.

## Exact transport loc metadata

Location-backed transports may carry `locId` / `locX` / `locZ` from content-pack enrichment
(`bun run gen:nav-transports`). `locId` is the **map placement** (closed trapdoor on
the floor). When climb only exists on a transformed open loc, `openLocId` is set too;
`matchesTransportLoc` accepts either id. PathFinder prefers that metadata; the executor
falls back to nearby-name lookup when ids are absent. Special crossings resolve via
`specialCrossingForTransport` (exact loc tile, then approach stand).

Ladders with a single tele still wrapped in quest/skill/inv guards stay in the JSON as
`disabledReason` audit rows (not active graph edges), unless a curated activation in
`src/bot/nav/v2/stateAwareRequires.ts` re-enables them with `requires` (nav v2 only —
classic skips requires-gated edges when no WorldState snapshot is sent).

## Nav v2 (experimental)

**Global → World walker:** `classic` (default) | `v2`. Override: `?Global.navEngine=v2`
or `walkTo(dest, { navEngine: 'v2' })`.

| | Classic | v2 |
|---|---|---|
| Tele catalog (spell + jewellery) | no | yes |
| Live WorldState for edge `requires` | snapshot when available | yes |
| Hop logs | no | yes |
| Path-scoped bank (runes/tolls; inv jewellery only) | no | yes (one leg max) |
| Path camera follow | optional (`navCameraFollow`) | optional (`navCameraFollow`) |
| Path paint | optional | optional (`showNavPath`) |

**Path paint:** Global **Show nav path** + group **Nav path paint** (`showIf`). Tile quads paint
into the **game surface** after the 3D world (`BotClient.onAfterWorldRender` →
`pathScenePaint.ts`) using the same camera projection as the scene — so the path lines up
with the ground under the current view. Transport **loc** placements (often 1 tile off the
stand tile) get a separate ring; the walker’s next click tile is outlined. Hop labels stay
on the HTML overlay for crisp text. Quads are still drawn after the model composite (not
true z-buffer under people); depth-correct under entities would need World inject.

**Jewellery:** inventory Rub only at plan+execute. Bank planner does not withdraw rings/glories
(bank-cache API is separate). **Quest-lock doors:** mesbox → session blacklist + repath.

**Code:** `src/bot/nav/v2/`, `exec/`, `pathPublish.ts`, `pathOverlay.ts`, `cameraFollow.ts`. Tele catalog:
`teleportCatalog.ts`. Pack stress: `tools/nav/script-route-corpus.ts`. Live/operator tools
under `tools/nav-*.ts` (not CI). Index: [docs/nav-v2/](nav-v2/).

## Path camera

Optional orbit-camera path facing so operators can see the route being walked
(diagnostics / recordings). **Off by default.**

| Setting | Default | Override |
|---|---|---|
| Global `navCameraFollow` | `false` | `?Global.navCameraFollow=true` |

When on, [`WalkExecutor`](../src/bot/nav/WalkExecutor.ts) samples a path-facing yaw
each follow tick and [`PathCameraFollow`](../src/bot/nav/cameraFollow.ts) eases the
orbit yaw on the **client frame loop** (not once per walk tick), so turns feel like
a human holding left/right rather than stepping.

- Yaw uses client units `0–2047` (same as [`Game.cameraYaw`](API.md#camera-client-only)).
- Lookahead stops at **transport boundaries** (level change, same-plane dungeon
  jumps such as z ± 6400, or a transport waypoint) so the camera aims at the local
  ladder/object, not the remote landing.
- Independent of path paint (`showNavPath`); both may be on together.
- Client camera packets remain rate-limited by the client itself.

Scripts that need a one-shot aim should call `Game.setCameraYaw` directly; prefer
the Global setting for continuous walk follow.

## Route corpus / HARD stress

The script-route corpus ranks hard OD pairs for live regression walks. Artifacts
are **generated and gitignored** — regenerate before `HARD=1` live runs.

| Artifact | Role |
|---|---|
| `tools/nav/script-routes.generated.json` | Full successful probe set after endpoint + corridor dedupe (gitignored) |
| `tools/nav/script-routes.hardest.json` | Top-N by difficulty for live HARD walks (gitignored) |

**Generate (requires collision pack):**

```bash
bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts
# optional: --no-tele for pure-walk ranking; tele ranking is default (full runes)
```

**Dedupe stages** (see `tools/nav/script-route-corpus.ts`):

1. **Endpoint near-dedupe** (`dedupePaths`) — drop generator twins with nearly the
   same directed from→to.
2. **Corridor / journey fingerprint** (`pathCorridorSignature` + `dedupeByCorridor`)
   — fingerprint is start map-square + end map-square + hop sequence (tele vs
   pure-walk and distinct starts stay separate); keep the highest-difficulty row
   per signature.
3. **HARD top-N** (`rankHardest`) — score cost / expansions / hop count for the
   live sample list.

**Live HARD:** `tools/nav-script-routes-live.ts` with `HARD=1` reads
`tools/nav/script-routes.hardest.json`. Fresh checkouts without the pack or
generated JSON will not exercise collision-backed corpus coverage; unit tests that
need the pack use `test.skipIf` rather than silent pass.

## Level-change loc lag

**Every scene query is empty for about a tick after the level changes.** Climb a
ladder and immediately ask for nearby locs, and you get nothing — not because nothing
is there, but because the scene has not been rebuilt yet.

This is the single most expensive gotcha in this subsystem: blank looks exactly like
absent, so code concludes an object is missing and starts a recovery it never needed.
It caused a false "the crystal broke" wander loop at the Camelot tower, and phantom
ladder detours in the walker.

The executor settles after any level-changing transport before trusting the scene
([`WalkExecutor.ts`](../src/bot/nav/WalkExecutor.ts)):

```ts
if (crossed) {
    if (transport.toLevel !== undefined) {
        await Execution.delayTicks(2);
    }
```

**Rule: require positive evidence of scene sync before concluding something is
absent.** An empty result immediately after a level change means "ask again".

## Arrival

[`arrival.ts`](../src/bot/nav/arrival.ts) answers "are we there?" honestly, and the
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
[`Reach`](../src/bot/api/Reach.ts) is the shared one — **use it rather than writing
another**:

```ts
await Reach.locOp({ near, ... });     // walk to a stand, then operate a loc
await Reach.npcDialog({ near, ... }); // walk to a stand, then talk to an NPC
```

It walks to the caller's `near` stand, performs the action, and — when the *server*
replies that it cannot reach — opens the blocking door and retries. It does not try to
race a door's re-shut. Status is explicit: `'done' | 'retry' | 'unreachable'`.

For a **loc** that server verdict is the whole story, and Reach runs no client-side
search. An **NPC** is different: the server only says "I can't reach that!" once its
own path search dead-ends, and a target that keeps wandering postpones that
indefinitely — clicking a farmer shut in the next room just walks you to the door and
leaves you there, silently, forever. So the NPC paths (`npcDialog`, and `entityOp`
under `openWhenUnreachable`) probe the scene themselves and open the door on their own
verdict. A wrong probe is harmless: it falls through to the ordinary click.

That probe is only trusted within `PROBE_RADIUS` on the same level. `REACH_BFS_STEPS`
expansions run out at about eleven tiles of open ground, so past that "too far to
search" is indistinguishable from "walled off" — and a patrolling target would have
the bot opening doors it never needed.

`Reach.npcDialog` searches the whole scene and lets the server walk the player to the
target, so it follows an NPC that wanders. A leash-limited approach loop cannot — a
patrolling NPC simply walks out of range and the interaction is abandoned.

## When it gets stuck

[`walkLadder.ts`](../src/bot/nav/walkLadder.ts) is an escalation ladder rather than a
retry count. It tracks progress, backs off, and after `UNREACHABLE_PASSES` concludes
the destination is genuinely unreachable — reporting `'arrived' | 'closest' |
'budget' | 'failed' | 'interrupted'` rather than silently spinning.

`classifyReason` separates "ran out of budget" from "failed", so a caller can tell a
slow route from an impossible one.

## Tuning constants

The top of [`WalkExecutor.ts`](../src/bot/nav/WalkExecutor.ts) is a block of bare
numbers. What they govern:

| Constant | Meaning |
|---|---|
| `TARGET_STEPS`, `TARGET_JITTER` | how far ahead to click, and the randomisation on it |
| `ARRIVE_RADIUS` | how close counts as arrived |
| `PROGRESS_WINDOW` | how far ahead `locateOnPath` scans |
| `CORRIDOR` | how far off-path still counts as on-path |
| `OFF_CORRIDOR_STRIKES` | consecutive off-corridor passes before re-pathing |
| `STALL_TICKS` | ticks without movement before treating it as a stall |
| `STUCK_ITERS` | passes without progress before the escalation ladder gives up |
| `MAX_REPATHS` | re-plans allowed for one walk |
| `TRANSPORT_WAIT_MS` | how long to wait for a crossing to complete |
| `MULTI_DOOR_CROSS_MS` | budget for a door-dense interior |
| `OPEN_WAIT_MS` | how long to wait for a leaf to open |

## See also

- [Manual index](README.md)
- [Scripting API](API.md#movement) — the script-facing movement surface
- [Architecture](ARCHITECTURE.md#from-interact-to-a-packet) — how a click reaches the client
- [Running locally](RUNNING.md#deploying-the-client) — building the collision pack
- [Quests](QUESTS.md) — a heavy consumer of walking and doors
- [Clue scrolls](CLUES.md) — coordinate clues and chasing NPCs
- [Testing](TESTING.md) — the nav unit tests and live route harnesses
