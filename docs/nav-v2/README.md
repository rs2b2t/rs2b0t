# Nav v2

Opt-in walker: Global **World walker** = `classic` (default) | `v2`.

| | |
|---|---|
| Code | `src/bot/nav/v2/`, `exec/`, `pathPublish` / `pathOverlay` / `pathPaintTheme` |
| Tele catalog | `src/bot/nav/v2/teleportCatalog.ts` |
| Manual | [docs/NAV.md](../NAV.md) § Nav v2 |
| Unit | `bun test test/nav/` |
| Pack corpus | `bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts` |

**v2 adds:** spell + jewellery tele edges (magic/runes/quests via WorldState; jewellery inventory only), hop logs, path-scoped bank for runes/tolls, optional path paint, quest-lock door blacklist.

**Not in this ship:** bank cache API, multi-dest quest ladders, live CI harness suite.

Operator live tools live under `tools/nav-*.ts` (not CI). Do not document personal deploy paths here.
