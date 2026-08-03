# Nav v2

Opt-in walker: Global **World walker** = `classic` (default) | `v2`.

| | |
|---|---|
| Code | `src/bot/nav/v2/`, `exec/`, `pathPublish` / `pathOverlay` / `pathPaintTheme` |
| Tele catalog | `src/bot/nav/v2/teleportCatalog.ts` |
| Manual | [docs/NAV.md](../NAV.md) § Nav v2 |
| **2004 transport coverage plan** | [TRANSPORTS-2004.md](./TRANSPORTS-2004.md) |
| Unit | `bun test test/nav/` |
| Pack corpus | `bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts` |

**v2 adds:** spell + jewellery tele edges (magic/runes/quests via WorldState; jewellery inventory only), hop logs, path-scoped bank for runes/tolls, optional path paint + live loc hulls, quest-lock door blacklist, danger zones.

**Coverage program:** 2004-era travel (spirit trees, glider, Entrana, carts, essence entry, levers, OD agility) in `travelCatalog.ts` / `loadTransportGraph.ts`; guild skill doors + mining ladder gates in `specialRequires.ts`; quest seeds in `transportQuestReqs.ts` — see [TRANSPORTS-2004.md](./TRANSPORTS-2004.md).

**Not in this ship:** bank cache API, multi-dest quest ladders (Horror/Watchtower maze), Ranging Guild door (not in doors.json), fairy rings / post-era transport matrix, live CI harness suite.

Operator live tools live under `tools/nav-*.ts` (not CI). Do not document personal deploy paths here.
