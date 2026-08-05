# Nav (world walker)

There is **one** world walker. Historical dual-run “classic / v2” is gone.
Travel catalog and skill/quest gates are always on the stack. **Nav teleports**
(spell/jewellery inject) are **Global `navTeleports`, default off**.

| | |
|---|---|
| Product manual | [docs/NAV.md](../NAV.md) |
| **2004 transport coverage** | [TRANSPORTS-2004.md](./TRANSPORTS-2004.md) |
| Client path vs pack paint | [CLIENT-PATH-ALIGN.md](./CLIENT-PATH-ALIGN.md) |
| Code | `src/bot/nav/` (`PathFinder`, `WalkExecutor`, `exec/`, catalogs, WorldState) |
| Unit | `bun test test/nav/` |
| Pack corpus | `bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts` |

### Live operator tools (not CI)

- `tools/nav-script-routes-live.ts` — multi-OD script routes (set `LIMIT=10+`)
- `tools/nav-stress-live.ts` — teles, jewellery, paint cases
- `tools/nav-tele-smoke.ts` — Lumbridge → Varrock spell tele
- `tools/nav-path-paint-live.ts` — pack vs client segment paint

`USE_TELEPORTS=0` on script-routes disables tele inject for pure-walk smokes.
