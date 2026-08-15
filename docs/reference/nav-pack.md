[Manual](../README.md) › [World-walking](../NAV.md) › Collision pack

# The collision pack

The client only knows collision for the scene it has loaded. World-scale pathfinding
needs the map, so collision is **baked ahead of time** from an engine's data by
[`tools/nav/build-collision.ts`](../../tools/nav/build-collision.ts) into
`out/collision.lcnav.gz`.

The pack is built from *the engine you are deploying into*
([`tools/deploy-local.sh`](../../tools/deploy-local.sh) does it on first run), so it
matches that server's map. The **map tile picker** uses the same pack for its
walkable overlay (and a separately baked worldmap basemap for decoration) — see
[Map tile picker](../MAP-PICKER.md).

Alongside the raw collision the pack carries a graph of traversal edges that plain
collision cannot express:

| Data | Source | What it adds |
|---|---|---|
| [`doors.json`](../../src/bot/event/webwalk/data/doors.json) | [`tools/nav/derive-doors.ts`](../../tools/nav/derive-doors.ts) | openable barriers, and which tiles they join |
| [`stairEdges.json`](../../src/bot/event/webwalk/data/stairEdges.json) | [`tools/nav/derive-stairs.ts`](../../tools/nav/derive-stairs.ts) | stairs and ladders, so paths can change level |
| [`transports.json`](../../src/bot/event/webwalk/data/transports.json) | curated | edges the derivations cannot infer |
| [`travelCatalog.ts`](../../src/bot/event/webwalk/travelCatalog.ts) | content constants | 2004 travel (spirit/glider/Entrana/cart/essence/levers/agi) merged at graph load |
| [`specialRequires.ts`](../../src/bot/event/webwalk/specialRequires.ts) | content scripts | plan-time skill/coin gates on doors and transport from-tiles |
| [`teleportCatalog.ts`](../../src/bot/event/webwalk/teleportCatalog.ts) | content / kit | spell + jewellery tele edges injected into A* by default |

There is a **single** door/transport/travelCatalog graph and a **single** executor
(`WalkExecutor` + `exec/`). Live walks snapshot WorldState so skill/quest/coin gates
fail closed when the player cannot use them. Offline / no-state path finds **fail open**
on requires (pack-tool parity — ships and skill doors still expand).

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

## See also

- [World-walking](../NAV.md)
