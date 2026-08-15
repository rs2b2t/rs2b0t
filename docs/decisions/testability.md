[Manual](../README.md) › [Testing](../TESTING.md) › Testability

# What makes this testable

`bunfig.toml` preloads [`test/setup-dom.ts`](../../test/setup-dom.ts), which registers
happy-dom globally:

```ts
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
```

That, plus the [DOM fence](../reference/import-fences.md), is why subsystem modules can
be imported directly in a test without a browser.

The deeper reason the logic is testable at all is that the pure parts are
deliberately separated from the driving parts — [`followMath.ts`](../../src/bot/event/webwalk/geometry/followMath.ts)
from `WalkExecutor`, a quest's [`decide()`](../reference/quest-engine.md#quest-state) from the engine
that executes it. Those pure functions are the specification, and their tests are the
place to encode a bug you have fixed.

**A note on module mocks.** `mock.module` is global in Bun and **permanent for the
process** — there is no unmock — so a mock leaks into every file that runs after it.
This caused every one of the suite's long-standing failures. Two distinct shapes:

- **Missing exports.** A mock returning `{ Npcs: … }` drops `talkOp` and `Npc`, so the
  next file importing them dies with `SyntaxError: Export named 'talkOp' not found`.
  Only modules with more than one *runtime* export can do this — `Npcs`, `Locs`,
  `GroundItems`, `Inventory`. Fix: `import * as Real from …` and spread it.
- **Overridden behaviour.** Even a complete mock replaces the singleton, so a test that
  needs the unstubbed implementation gets the stub. Spreading does not help here.
  Fix: **mutate the singleton instead of replacing the module**, scoped to the file:

  ```ts
  import * as RealInventory from '#/bot/api/inventory/Inventory.js';
  const realFns = { ...RealInventory.Inventory };
  const stub = { items: () => […] };
  beforeEach(() => Object.assign(RealInventory.Inventory, stub));
  afterAll(() => Object.assign(RealInventory.Inventory, realFns));
  ```

  Mutation without the `afterAll` restore is the same leak in a new coat.

**Global singletons leak the same way.** `test/panel/bot-panel.test.ts` registered a fixture
script and never removed it, so `docs/SCRIPTS.md` read as stale against a registry holding
a script that does not exist. `ScriptRegistry.unregister(name)` exists for this.

**A test that asserts absence must establish it.** `Anchor.test.ts` asserted a task stays
idle "without a live `Game.tile()`" but never set that up — it silently inverted whenever
a file mocking `Game` ran first. Control your own inputs.

**Run a suspect file alone as well as in the suite.** These two disagreeing is the
signature of a leak, and a file can fail alone while passing in the suite (another file's
mock was covering for it).

## See also

- [Test suites](../reference/test-suites.md)
