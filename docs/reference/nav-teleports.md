[Manual](../README.md) › [World-walking](../NAV.md) › Teleports

# Nav teleports

Spell and jewellery **teleport edges are not part of normal walking unless turned on.**
They are a separate inject into A* (catalog in `teleportCatalog.ts`), not map doors or ships.

### Global toggle (default off)

| Control | Default | How to enable |
|---|---|---|
| Global setting **Nav teleports** (`navTeleports`) | **false** | Bot panel → Global, or `?Global.navTeleports=true` |

With the toggle **off** (default):

- Bare `Traversal.walkTo` / `walkResilient` never inject spell/jewellery hops.
- Combat escape kits, AIOTeleport law stacks, and looted laws are not spent as *routing*.
- Ships, gliders, spirit trees, ladders, doors, and other travel-catalog edges still work.

With the toggle **on**, these apply:

- A* may inject standard-spellbook teles (Varrock, Lumbridge, Falador, Camelot, …) and
  jewellery Rub destinations (dueling ring, games necklace, glory, …) when
  **live inventory** (and magic level / quest gates) can pay for them.
- Jewellery is **inventory Rub only** — the bank planner does not withdraw rings/glories.
- Path-scoped bank may withdraw **runes/toll coins** if a cheaper tele path needs them
  and `bankItemCounts` / open-bank snapshot allows it.

### Per-walk resolution order

For each `walkTo` / `walkResilient`, tele inject is decided as follows (first match wins):

1. **Force off** — `useTeleportCatalog: false`, or `policy: { useTeleports: false }`,
   or spread `NAV_PURE_WALK` / `Traversal.pureWalk`.
2. **Force on** — `useTeleportCatalog: true`, or `policy: { useTeleports: true }`,
   or spread `NAV_WITH_TELES` / `Traversal.withTeles`.
3. **Else** — Global **`navTeleports`** (default **false**).

```ts
// Default: pure walk (Global off)
await Traversal.walkResilient(dest, { radius: 3 });

// Operator enabled nav teles globally; this walk uses them
// ?Global.navTeleports=true  or panel toggle

// Script/harness forces teles on even if Global is off
await Traversal.walkTo(dest, { ...NAV_WITH_TELES, radius: 3 });

// Force pure walk even if Global is on
await Traversal.walkTo(dest, { ...NAV_PURE_WALK, radius: 3 });
```

**ClueSolver** sets tele inject from its own **Use teleports** script setting (not the
Global default): on → force-on with `distanceBeforeTeleport: 40` (unchanged span floor);
off → force-off. Other scripts use Global / A* cost (default span 0).

### Costs (lowest wins)

Path costs are **time in run-tile units** (`src/bot/event/webwalk/geometry/edgeCosts.ts`, idea **@lulwut**),
aligned with server movement:

| Mode | Server | Cost of one map step |
|------|--------|----------------------|
| Run | up to **2** steps/tick (`PathingEntity` + `MoveSpeed.RUN`) | **1** (default A*) |
| Walk | **1** step/tick | **2** (half speed) |

Run energy drain/recover uses the server agility/weight formulas (`Player.updateEnergy`).
Action edges (doors, ships, gliders, teles, bank withdraw) are priced with
`ticksToCost(ticks) = ticks × 2` so they share the same currency. A* picks the cheapest
total. Prefer that over static span gates.

### Min span when teles are enabled

When tele inject is active, `policy.distanceBeforeTeleport` defaults to **0** — A* cost
decides (e.g. a ~5-tick spell tele costs **10** run-tiles; short hops stay walk). Pass a
positive floor only if a caller wants a hard gate.

### Other gates (content / live state)

Even when inject is on, a tele edge is only admitted if:

- magic level / members / quest requires pass (spells),
- required runes are held (or bank-planned),
- jewellery name matches a charged inventory item,
- wilderness origin limits are satisfied (e.g. spells ≤20 wildy at *path start*),
- optional `allowTeleportIds` / `denyTeleportIds` policy lists allow it.

Failed mid-walk casts are suppressed for the rest of that walk (`denyTeleportIds`).

### Path paint

Global **Show nav path** + group **Nav path paint** (`showIf`).

- **Path tiles** paint into the **game surface** after the 3D world (`BotClient.onAfterWorldRender`
  → `pathScenePaint.ts`) with the same camera projection as the scene.
- **Object highlighter**: each transport hop draws a **3D AABB hull** of the live loc the executor
  will click (`reader.locBox` + live `Locs` match). Teleports / NPC-only hops / missing scene locs
  draw **nothing** (no fake cube on the stand tile). Next hop is emphasized; hulls clip to the game viewport.
- **Click tile** outline = next walker click. **Hop labels** on the HTML overlay.

True z-buffer path paint *under* models would need injecting into `World` draw order; object hulls
do not require that (overlay projection is enough for interact targeting).

**Quest-lock doors:** mesbox → session blacklist + repath.

**2004 travel + gates:** spirit/glider/Entrana/cart/essence/levers/agi
(`travelCatalog.ts`); quest seeds (`transportQuestReqs.ts`); guild skill doors + mining ladder
(`specialRequires.ts`). Matrix: [transport reference](../reference/transports-2004.md).

**Essence mine multiloc (litmus):** multi-entry, **same-origin exit only**. Entering
via a wizard sets the session return; every exit portal telejumps to that return — not
to a fixed Sedridor stand. Nav must **never route a surface OD *through* the mine** as
a shortcut (entry at A + exit as if at B). Implementation: entry edges set
`essenceEntrySetsReturn`; PathFinder carries return in the A\* key; exit edges require
matching `essenceExitReturn`; live `EssenceSession` (server varp 64 is not on the wire).

**Door placement (stall open):** when stuck, `tryNearbyDoor` prefers a closed door on
the **path corridor** ahead of the player, not merely the nearest Open-door within 3
tiles (wrong doorway / same loc type).

**Loc placement ref (`locRef.ts`):** scenery-backed edges are keyed by **placement**
(level + tile) plus optional closed/open ids — not by name alone. `matchesLocRef` /
`locRefValid` / `locRefStale` support “is this edge still present in the scene?” checks
(open leaf counts as valid for Open-actions).

**Code map:** `src/bot/event/webwalk/` — `PathFinder`, `WalkExecutor`, `exec/`, `data/`, plus
teleport catalog, travel catalog, WorldState helpers, bank plan. Transport matrix:
[transport reference](../reference/transports-2004.md).

## See also

- [World-walking](../NAV.md)
