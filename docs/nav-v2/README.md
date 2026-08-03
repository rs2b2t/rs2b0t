# Nav modes (classic / v2)

> **Honest framing:** there is **one** world walker. The dual-run flag did not leave a
> frozen “v1 engine” beside a new “v2 engine.” Most of the nav-v2 program **landed in
> the shared stack**. What the UI still calls **classic** vs **v2** is a **feature gate**
> on that stack. Details: [CLASSIC-PARITY.md](./CLASSIC-PARITY.md).

| | |
|---|---|
| Product manual | [docs/NAV.md](../NAV.md) § [One walker, two modes](../NAV.md#one-walker-two-modes-classic--v2) |
| Classic vs pre-v2 audit | [CLASSIC-PARITY.md](./CLASSIC-PARITY.md) |
| **2004 transport coverage** | [TRANSPORTS-2004.md](./TRANSPORTS-2004.md) |
| Client path vs pack paint (notes) | [CLIENT-PATH-ALIGN.md](./CLIENT-PATH-ALIGN.md) |
| Shared code | `PathFinder`, `WalkExecutor`, `exec/`, `loadTransportGraph`, `data/*` |
| Mostly under `v2/` (shared use) | `travelCatalog`, `specialRequires`, `worldState*`, path paint |
| True v2-only | `teleportCatalog` inject, path-scoped bank, hop logs |
| Unit | `bun test test/nav/` (incl. `classicParity.test.ts`) |
| Pack corpus | `bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts` |

### What is shared (both modes)

Doors, transports, **travelCatalog** (spirit/glider/Entrana/cart/essence/levers/agi),
special crossings (ships, gangplanks, tolls), guild skill gates, WorldState requires,
open-door fast path, path paint / camera (optional globals), danger zones.

**Essence session multiloc** (shared): exit portals × known returns; path-state
`essenceEntrySetsReturn` / `essenceExitReturn`; live `EssenceSession` (server
`exit_essence_mine_coord` is not on the client wire).

### What only `navEngine: 'v2'` turns on

1. Spell + jewellery **teleport catalog inject** (jewellery = inventory Rub only)
2. **Path-scoped bank** for runes/tolls (one leg; not jewellery bank withdraw)
3. Transport **hop logs** under v2 policy

Default Global remains **`classic`** so scripts do not gain tele inject by surprise.

### Still deferred

Bank cache API, multi-dest quest ladders (Horror/Watchtower maze), fairy rings /
post-era matrix, live CI harness suite.

Operator live tools: `tools/nav-*.ts` (not CI). Do not document personal deploy paths here.
