[Manual](../README.md) › [World-walking](../NAV.md) › Pathfinding

# Pathfinding

[`PathFinder`](../../src/bot/event/webwalk/PathFinder.ts) is A\* over the pack, running inside a
worker ([`NavWorker.ts`](../../src/bot/event/webwalk/NavWorker.ts)) so a long search never stalls
the game loop. [`Navigator`](../../src/bot/event/webwalk/Navigator.ts) is the front end:

```ts
const path = await Navigator.findPath(from, to, { avoidDoors, timeoutMs, maxExpansions });
```

### Danger zones (optional avoid)

Scripts can ban axis-aligned map rects from A\* so low-level accounts do not walk
wolf packs (idea **@lolwut**). Known ids live in
[`dangerZones.ts`](../../src/bot/event/webwalk/data/dangerZones.ts); pass them on any walk
(`walkTo` or `walkResilient` — resilient forwards them on every baked repath):

```ts
await Traversal.walkResilient(dest, {
  radius: 2,
  avoidZones: ['white-wolf-mountain'],
  // or ad-hoc: { minX, maxX, minZ, maxZ, level? }
});
```

The pathfinder never expands *into* resolved danger tiles (walk or transport
landing). Ad-hoc rects and ordinary catalog zones are strict and opt-in.

Catalog entries may also define live activation policy. `draynor-jail-guards`
is automatic for players at combat level 50 or below. It is an
`allowWhenEndpointInside` transit exclusion: ordinary routes avoid the guarded
compound, while quest destinations inside remain reachable and a player already
inside can path out. Combat level 51 and above does not activate this bot-safety
policy. This threshold is navigation policy, not a claim that the guards stop
being aggressive at that level.

The Draynor bounds conservatively expand the four guard spawns by their maximum
interaction tether. Background configuration/map references:
[`draynor.npc`](https://github.com/LostCityRS/Content/blob/274/scripts/areas/area_draynor/configs/draynor.npc),
[`all.hunt`](https://github.com/LostCityRS/Content/blob/274/scripts/_unpack/225/all.hunt), and
[`m48_50.jm2`](https://github.com/LostCityRS/Content/blob/274/maps/m48_50.jm2).

**Pack check (baked collision):** Taverley bank ↔ Catherby bank free path crosses
White Wolf Mountain (~cost 239, dozens of zone tiles). With
`avoidZones: ['white-wolf-mountain']` the same OD stays outside the zone
(~cost 710+, longer coastal/ship detour, zero zone tiles). Unit tests live in
`test/event/webwalk/dangerZones.test.ts`.

The outcome is explicit about failure:

```ts
type PathOutcome =
    | { ok: true;  waypoints: Waypoint[]; cost: number; expanded: number }
    | { ok: false; reason: string;        expanded: number };
```

A `Waypoint` may carry a `TransportInfo`, which is how a door, stair, or ship
crossing is represented mid-path. `avoidDoors` lets a caller re-path around a barrier
that has refused to open.

[`DirectNavigator`](../../src/bot/event/webwalk/DirectNavigator.ts) is the script-facing wrapper —
see [Movement](../reference/api-movement.md).

## Following a path

[`WalkExecutor`](../../src/bot/event/webwalk/WalkExecutor.ts) turns waypoints into clicks. Each
pass it:

1. locates the player on the path ([corridor snap](../decisions/corridor-snap.md));
2. picks the furthest clickable tile within reach and clicks it;
3. watches for arrival, deviation, a shut barrier, or a stall;
4. re-paths when the world disagrees with the plan.

The pure geometry is split into [`followMath.ts`](../../src/bot/event/webwalk/geometry/followMath.ts) so it
can be unit-tested without a client — [`test/event/webwalk/followMath.test.ts`](../../test/event/webwalk/followMath.test.ts)
is the executable specification of the rules below.

## See also

- [World-walking](../NAV.md)
