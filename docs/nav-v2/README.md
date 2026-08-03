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

**v2 adds:** spell + jewellery tele edges (magic/runes/quests via WorldState; jewellery inventory only), hop logs, path-scoped bank for runes/tolls, optional path paint, quest-lock door blacklist, danger zones.

**Coverage program:** close remaining 2004-era travel systems (spirit trees, glider, Entrana, carts, agility shortcuts, …) using Server `content/scripts` as source of truth — see [TRANSPORTS-2004.md](./TRANSPORTS-2004.md).

**Not in the original v2 ship:** bank cache API, multi-dest quest ladders, live CI harness suite, fairy rings / post-era transport matrix.

Operator live tools live under `tools/nav-*.ts` (not CI). Do not document personal deploy paths here.
