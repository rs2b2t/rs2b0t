[Manual](../README.md) › [Scripting API](../API.md) › Movement

# Movement

## Movement

How this works underneath — the collision pack, doors, transports, and arrival
semantics — is [World-walking](../NAV.md).

```ts
Traversal.walkTo(dest: WorldTile, opts?: {
    radius?: number;    // arrive within N tiles (default 2)
    timeoutMs?: number;
    log?: (msg: string) => void;
    maxExpansions?: number;
    // Spell/jewellery tele edges — see Nav teleports below.
    useTeleportCatalog?: boolean;
    policy?: {
        useTeleports?: boolean;
        distanceBeforeTeleport?: number; // default 0 (cost decides); set 40 for hard floor
        allowTeleportIds?: string[];
        denyTeleportIds?: string[];
    };
    bankItemCounts?: Record<string, number>;
    // Optional: ban map rects from A* (ids or ad-hoc). See docs/reference/nav-pathfinding.md#danger-zones-optional-avoid
    avoidZones?: readonly (string | { minX: number; maxX: number; minZ: number; maxZ: number; level?: number })[];
}): Promise<boolean>

// Prefer for unattended walks — escalates re-path / big-budget / scene bridge
// and by default never gives up (only random-event or Stop ends it early).
// Forwards useTeleportCatalog / policy / bankItemCounts on every baked repath.
Traversal.walkResilient(dest: WorldTile, opts: {
    radius: number;
    attempts?: number;
    timeoutMs?: number;
    sceneRadius?: number;
    maxBudget?: number;
    log?: (msg: string) => void;
    useTeleportCatalog?: boolean;
    policy?: WalkOptions['policy'];
    bankItemCounts?: WalkOptions['bankItemCounts'];
    avoidZones?: WalkOptions['avoidZones'];
}): Promise<boolean>

// Spread helpers (override Global navTeleports for one walk)
NAV_PURE_WALK   // { useTeleportCatalog: false, policy: { useTeleports: false } }
NAV_WITH_TELES  // { useTeleportCatalog: true,  policy: { useTeleports: true } }
Traversal.pureWalk   // same as NAV_PURE_WALK
Traversal.withTeles  // same as NAV_WITH_TELES

Traversal.preload(): void      // warm the nav worker before the first walk
Traversal.remaining(): number  // path tiles left in the active walk
```

`Traversal.walkTo` web-walks the world (A\* over the collision pack + door/
transport graph, opens doors, recovers from stuck). Resolves `false` on
timeout/no-path; unwalkable destinations snap to the nearest reachable tile.
There is **one** walker: live **WorldState** (skills, quests, inventory, members)
gates skill doors, tolls, and quest transports.

### Nav teleports (default off)

Spell/jewellery tele hops are **not** used unless enabled:

| Source | Default | Enable |
|---|---|---|
| Global **Nav teleports** (`navTeleports`) | **off** | Panel or `?Global.navTeleports=true` |
| Per-walk override | inherits Global | `useTeleportCatalog: true` or `...NAV_WITH_TELES` |
| Force pure walk | — | `useTeleportCatalog: false` or `...NAV_PURE_WALK` |

Resolution: explicit force-off → explicit force-on → Global (default off).

When teles are on, `distanceBeforeTeleport` defaults to **0** so A* cost decides. Short
city hops stay pure walk. Full behaviour, jewellery limits, and bank-plan rules:
[Nav teleports](../reference/nav-teleports.md). Transport matrix:
[transport reference](../reference/transports-2004.md).

**Essence mine (session multiloc):** multi-entry, **same-origin exit only**. Exit
portals share one loc type but telejump to the wizard you entered with
(`%exit_essence_mine_coord`). That varp is **not** sent to the client — the bot
tracks return on `EssenceSession` when an entry hop succeeds, and PathFinder
carries the same return in the A\* key so nav **never routes a surface path
through the mine** as a free teleport between wizards. Scripts that enter via
NPC without the walker should call `__rs2b0t.EssenceSession.noteEntryFromNpc('Aubury')`
(or `noteEntry('aubury')`) after a successful teleport.

**Loc placement (`locRef`):** transport/door edges refer to scenery by placement
(tile + optional loc id / open id). Helpers in `nav/locRef.ts` match live locs
and probe validity (including already-open barriers).

`walkResilient` wraps the same pathfinder in an escalation ladder — **use it for
script bank runs and long unattended walks**. Pass `avoidZones: ['white-wolf-mountain']`
(or ad-hoc rects) so low-level accounts skip wolf-heavy corridors; off by default.
See [Danger zones](../reference/nav-pathfinding.md#danger-zones-optional-avoid) for catalog + pack verification.

For same-scene clicks, `DirectNavigator.walk(dest)` / `walkTo(dest, radius?,
timeoutMs?)` are available, but prefer `Traversal.walkTo` / `walkResilient`.

```ts
if (!await Traversal.walkResilient({ x: 2662, z: 3305, level: 0 }, { radius: 0 })) {
    this.log('could not reach the stall');
}

// Skip White Wolf Mountain on a long unattended walk
await Traversal.walkResilient(catherby, {
    radius: 2,
    avoidZones: ['white-wolf-mountain'],
});
```

---

## See also

- [Scripting API index](../API.md)
