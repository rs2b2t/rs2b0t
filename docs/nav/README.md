[Manual](../README.md) › Nav operator tools

# Nav (world walker)

There is one world walker. The dual-run "classic / v2" split is gone. Travel catalog and
skill/quest gates are always on the stack.

## Nav teleports

Spell and jewellery edges inject into A* and are opt-in.

| | |
|---|---|
| Global setting | **Nav teleports** (`navTeleports`), default **off** |
| URL | `?Global.navTeleports=true` |
| Per-walk force on | `useTeleportCatalog: true`, or `NAV_WITH_TELES` |
| Per-walk force off | `useTeleportCatalog: false`, or `NAV_PURE_WALK` |
| Min route span before a tele edge | 40 Chebyshev by default |

Harnesses that exercise teles pass `useTeleportCatalog: true` on the walk, which
overrides Global. `USE_TELEPORTS=0` forces pure-walk, with no jewellery kit on
travel-live.

Full write-up: [NAV.md § Nav teleports](../reference/nav-teleports.md).

## Where things are

| | |
|---|---|
| Product manual | [NAV.md](../NAV.md) |
| 2004 transport coverage | [transports-2004.md](../reference/transports-2004.md) |
| What counts as a transport | [transport-scope.md](../decisions/transport-scope.md) |
| Verify transport coverage | [verify-transports.md](../how-to/verify-transports.md) |
| Why paint and walk diverge | [client-vs-pack-path.md](../decisions/client-vs-pack-path.md) |
| Compare pack and client paint | [compare-path-paint.md](../how-to/compare-path-paint.md) |
| Code | `src/bot/event/webwalk/` |
| Unit tests | `bun test test/event/webwalk/` |
| Pack corpus | `bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts` |

## Live operator tools (not CI)

| Tool | Covers |
|---|---|
| `e2e/nav-script-routes-live.ts` | multi-OD script routes; set `LIMIT=10+`. HARD list comes from the ranked corpus, a different tool |
| `e2e/nav-script-travel-live.ts` | scrapes every clue / gathering / quest travel OD. `SEGMENT=clues`\|`quests`\|`gathering-all`\|`fishing`\|`mining`\|`woodcutting`\|`firemaking`\|`cooking`\|`all` |
| `e2e/nav-stress-live.ts` | teles, jewellery, paint cases |
| `e2e/nav-tele-smoke.ts` | Lumbridge → Varrock spell tele |
| `e2e/nav-path-paint-live.ts` | pack vs client segment paint |

## Regenerate the corpora

```bash
# Inspect / regenerate travel legs (optional JSON; live builds in-process)
bun --preload ./test/setup-dom.ts tools/nav/script-travel-corpus.ts --stats
bun --preload ./test/setup-dom.ts tools/nav/script-travel-corpus.ts --write

# Ranked HARD routes (separate corpus)
bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts --write --hardest=25

# Wipe local engine harness .sav clutter (dry-run first)
bash tools/cleanup-test-accounts.sh
```

Travel live pacing, stuck-abort, HP/energy sustain and env flags:
[NAV.md § Script travel OD](../how-to/script-travel-od.md).
