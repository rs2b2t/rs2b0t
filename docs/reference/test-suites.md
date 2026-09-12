[Manual](../README.md) › [Testing](../TESTING.md) › Suites

# Test suites

```sh
bun test                 # everything
bun test test/event/webwalk        # one directory
bun test test/docs       # the manual's own integrity
```

`test/` mirrors `src/bot/`, so a test lives at the path its subject does.

| Directory | Covers |
|---|---|
| [`test/scripts/`](../../test/scripts/) | per-bot decision logic |
| [`test/api/ai/quests/`](../../test/api/ai/quests/) | quest `decide()` branches, engine, primitives |
| [`test/api/`](../../test/api/) | the scripting surface, mirroring `src/bot/api/` |
| [`test/api/ai/clues/`](../../test/api/ai/clues/) | clue db, executor, solvers |
| [`test/event/webwalk/`](../../test/event/webwalk/) | path math, reach, walk ladder, pathfinder goals |
| [`test/multibox/`](../../test/multibox/) | slots, vault, login coordination |
| [`test/runtime/`](../../test/runtime/) | scheduler, registry, settings, diagnostics |
| [`test/tools/`](../../test/tools/) | tooling libraries, including doc links |
| [`test/panel/`](../../test/panel/) | panel and overlay |
| [`test/adapter/`](../../test/adapter/) · [`test/client/`](../../test/client/) · [`test/docs/`](../../test/docs/) | targeted |

### Collision pack (nav)

`out/collision.lcnav.gz` is gitignored. Pack-backed nav tests use
`test.skipIf(!HAS_COLLISION_PACK)` so a fresh checkout reports **skipped** coverage,
not silent green passes (#341). Build the pack via
[`tools/nav/build-collision.ts`](../../tools/nav/build-collision.ts) or
[`tools/deploy-local.sh`](../../tools/deploy-local.sh), then re-run `bun test test/event/webwalk`.

## See also

- [Why this is testable](../decisions/testability.md)
- [Write a harness](../how-to/write-a-harness.md)
