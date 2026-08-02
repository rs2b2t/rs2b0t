# Nav v2

Shortest Path–class planning + web-walker execution for the 2004 client.

| | |
|---|---|
| Toggle | Global **World walker** `classic` \| `v2` |
| Code | [`src/bot/nav/v2/`](../../src/bot/nav/v2/), `exec/`, path paint |
| Catalog | [`teleportCatalog.ts`](../../src/bot/nav/v2/teleportCatalog.ts) |
| Unit | `bun test test/nav/` |
| Pack corpus | `bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts` |
| Manual | [docs/NAV.md](../NAV.md) |

| Included | Out of scope (this ship) |
|---|---|
| Spell + jewellery in A\* + execute | Bank cache API / bank jewellery |
| Path paint (tile quads + hop text) | Live collision / A\* heat paint |
| Path-scoped bank for runes/tolls | Multi-dest quest ladders |
| Quest-lock door blacklist | Upstream live CI suite |
| Script-ripped pack route corpus | Fairy / cape / OSRS tele matrix |

Live harnesses (`tools/nav-v2-*.ts`, `nav-script-routes-live.ts`) are operator-only.
Do not put personal deploy paths in upstream docs.

See [TELEPORTS.md](./TELEPORTS.md) for catalog fidelity notes; [PLAN.md](./PLAN.md) for phase history.
