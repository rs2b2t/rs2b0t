# Nav (world walker)

There is **one** world walker. Historical dual-run “classic / v2” is gone.
Travel catalog and skill/quest gates are always on the stack.

**Nav teleports** (spell/jewellery inject into A*) are **opt-in**:

- Global setting **Nav teleports** (`navTeleports`) — **default off**
- URL: `?Global.navTeleports=true`
- Per-walk force on: `useTeleportCatalog: true` or `NAV_WITH_TELES`
- Per-walk force off: `useTeleportCatalog: false` or `NAV_PURE_WALK`
- When on, min route span before a tele edge is **40** Chebyshev by default

Full write-up: [docs/NAV.md § Nav teleports](../NAV.md#nav-teleports).

| | |
|---|---|
| Product manual | [docs/NAV.md](../NAV.md) |
| Nav teleports | [NAV.md § Nav teleports](../NAV.md#nav-teleports) |
| **2004 transport coverage** | [TRANSPORTS-2004.md](./TRANSPORTS-2004.md) |
| Client path vs pack paint | [CLIENT-PATH-ALIGN.md](./CLIENT-PATH-ALIGN.md) |
| Code | `src/bot/nav/` (`PathFinder`, `WalkExecutor`, `teleportCatalog`, WorldState) |
| Unit | `bun test test/nav/` |
| Pack corpus | `bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts` |

### Live operator tools (not CI)

- `tools/nav-script-routes-live.ts` — multi-OD script routes (set `LIMIT=10+`)
- `tools/nav-script-travel-live.ts` — **every** clue / gathering / quest travel OD
  (SEGMENT=`clues`|`quests`|`gathering-all`|`fishing`|`mining`|`woodcutting`|`firemaking`|`cooking`|`all`;
  corpus: `tools/nav/script-travel-corpus.ts`)
- `tools/nav-stress-live.ts` — teles, jewellery, paint cases
- `tools/nav-tele-smoke.ts` — Lumbridge → Varrock spell tele
- `tools/nav-path-paint-live.ts` — pack vs client segment paint

Harnesses that exercise teles pass `useTeleportCatalog: true` on the walk (overrides
Global). `USE_TELEPORTS=0` on script-routes forces pure-walk for those smokes.
