# Multi-state world objects in game bots

External reference, copied verbatim from
<https://gist.github.com/lulwut/5636d6a3010af2646d341efa9b605599> (added 2026-07-29).

Status: the model and the "What it already handles" section describe the client as it
is today. Everything from "Bot and adapter layer" onward (`LocRef`, `LocView`,
`sceneRevision`, `occupancyRevision`, `Loc.valid()`/`refresh()`, `loc.changed`) is a
proposal — none of it is implemented.

---

This note describes the general problem using RuneScape-style world objects
(`locs`) as the example. In this terminology, a **loc** is scenery such as a
tree, door, rock, or farming patch; an **obj** is a ground item.

## The important model

Do not treat an object ID as the identity of a permanent object. Keep these
concepts separate:

- **Placement identity:** scene generation, plane, world tile, and shape/type.
- **Raw ID:** the loc ID placed in the map or supplied by a live update.
- **Effective ID:** the currently visible definition after any transform.
- **Version:** a monotonically changing placement/state revision.

A tree becoming a stump can therefore mean either "the placement now contains a
different raw ID" or "the same raw placement now resolves to a different
effective ID." Both look like an object changing to a script, but the engine
reaches that result differently.

## Applying this to `rs2b0t`

`rs2b0t` wraps a real 2004scape client, so it should use that client's live
scene rather than reproduce the headless state pipeline.

### What it already handles

The client already receives timed loc changes and applies them through
`Client.locChangeCreate`, `locChangeDoQueue`, and `locChangeUnchecked`. That
code removes the old loc, updates collision, and installs the replacement.
`ClientAdapter.locs()` reads the resulting `World`, so a fresh query naturally
sees a tree become a stump.

This client's `LocType` format currently has no varp/varbit transform table.
Multi-state locs in this revision are therefore explicit scene replacements,
not the multiloc mechanism described above. If a later cache/client revision
adds transforms, resolve them inside the client/config layer and let the adapter
export the result; scripts should not decode cache transforms themselves.

There is also one useful safety check already present. `Loc.interact()` passes
the captured scene `typecode` through `DirectInputDriver` into the real client.
Before writing the interaction packet, `Client.interactWithLoc()` asks
`World.typeCode2()` whether that exact typecode still occupies the tile. A stale
tree typecode therefore does not produce a packet after the tile becomes a
stump.

The remaining weakness is observability: `actions.menuAction()` returns `true`
after calling the client's `doAction()` even when the client rejected the stale
loc internally. The public `Loc` also has no `valid()`, state revision, or
changed/gone distinction.

### Bot and adapter layer

Add a loc view at the `ClientAdapter` boundary instead of exposing another raw
client detail:

```ts
interface LocRef {
    sceneRevision: number;
    level: number;
    x: number;
    z: number;
    layer: 'wall' | 'wallDecor' | 'ground' | 'groundDecor';
}

interface LocSnapshot {
    ref: LocRef;
    typecode: number;
    id: number;
    shape: number;
    angle: number;
    occupancyRevision: number;
    // existing name, ops, tile, distance
}

interface LocView {
    available: boolean;
    sceneRevision: number;
    revision: number;
    entries: LocSnapshot[];
}
```

`available` matters because the adapter currently represents both "scene not
ready" and "no locs found" as `[]`. The existing one-tick gap after a level
change must remain unknown, not become evidence that a target is gone.

Increment `sceneRevision` whenever a rebuilt scene commits. Increment a
per-placement `occupancyRevision` on every add, replace, and delete, even if the
same ID returns. The strongest implementation is a small counter hook where
`locChangeUnchecked()` commits the change. Diffing `reader.locs()` once per bot
tick is an acceptable MVP, but it can miss a tree-to-stump-to-tree A-B-A cycle
that occurs between scans.

Add adapter operations such as `locView()` and `locAt(ref)`. Before dispatch,
look up the placement again, require the same scene and occupancy revisions,
re-read its current actions, and only then call the input driver. Return `false`
when the target or named action changed. A `true` result should continue to mean
"accepted for dispatch," not "the game action succeeded."

### Public API and scripts

Extend `Loc` with a stable `ref`, `revision`, `valid()` and `refresh()` (or
equivalent `Locs.lookup(ref)`). Provide changed/gone observations whose result
can be unknown while `LocView.available` is false. `Loc.interact(action)` should
use the refreshed snapshot and resolve the action slot again rather than using
the old snapshot's `ops` array.

For future multiloc-capable clients, expose `rawId` and `effectiveId` separately
instead of changing the meaning of today's `id`.

An optional `loc.changed` event fits the existing producer/event-bus design,
with previous/current snapshots and the new revision. Polling must still work;
scripts should normally select a fresh loc for each operation:

```text
select a current tree
capture its ref/revision and the inventory count
interact; retry selection if dispatch says stale
wait until that loc changed OR the inventory count increased
select again for the next cycle
```

The implementation touches `ClientAdapter.ts`, `entities/index.ts`,
`Locs.ts`, `InputDriver.ts`/`DirectInputDriver.ts`, and optionally
`events/producers.ts`. Mirror public changes in `packages/rs2b0t-api/index.d.ts`
and bump the ABI version if external scripts must reject older runtimes.

Tests should cover tree-to-stump replacement, stale interaction returning
`false` without a packet, A-B-A revision changes, a same-coordinate scene
rebuild, refreshed action slots, and the temporary unavailable scene.

