[Manual](README.md) › Testing

# Testing

Two layers, testing different things:

| Layer | What it proves | Cost |
|---|---|---|
| **Unit tests** (`bun test`) | the logic is right | seconds |
| **Live harnesses** (`tools/*-test.ts`) | the bot actually works against a real engine | minutes to hours |

The split exists because a bot can be logically perfect and still fail live — a door
that re-shuts, a dialogue that gained an option, a scene that has not rebuilt yet.
Unit tests cannot see any of that; live harnesses cannot iterate quickly.

## Contents

- [Unit tests](#unit-tests)
- [What makes this testable](#what-makes-this-testable)
- [Live harnesses](#live-harnesses)
- [The end-to-end smoke](#the-end-to-end-smoke)
- [Writing a harness](#writing-a-harness)
- [Known failures](#known-failures)

## Unit tests

```sh
bun test                 # everything — 1303 tests across 139 files
bun test test/nav        # one directory
bun test test/docs       # the manual's own integrity
```

| Directory | Files | Covers |
|---|---|---|
| [`test/scripts/`](../test/scripts/) | 26 | per-bot decision logic |
| [`test/quests/`](../test/quests/) | 26 | quest `decide()` branches, engine, primitives |
| [`test/api/`](../test/api/) | 16 | the scripting surface |
| [`test/bot/`](../test/bot/) | 13 | base classes, paint, combat, nav |
| [`test/clues/`](../test/clues/) | 10 | clue db, executor, solvers |
| [`test/multibox/`](../test/multibox/) | 9 | slots, vault, login coordination |
| [`test/runtime/`](../test/runtime/) | 8 | scheduler, registry, settings |
| [`test/tools/`](../test/tools/) | 8 | tooling libraries, including doc links |
| [`test/ui/`](../test/ui/) | 6 | panel and overlay |
| [`test/nav/`](../test/nav/) | 4 | path math, reach, walk ladder |
| [`test/shops/`](../test/shops/) | 4 | stock model, ring logic |
| [`test/config/`](../test/config/) · [`test/events/`](../test/events/) · [`test/input/`](../test/input/) · [`test/io/`](../test/io/) · [`test/client/`](../test/client/) · [`test/util/`](../test/util/) · [`test/docs/`](../test/docs/) | 1–2 each | targeted |

## What makes this testable

`bunfig.toml` preloads [`test/setup-dom.ts`](../test/setup-dom.ts), which registers
happy-dom globally:

```ts
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
```

That, plus the [DOM fence](ARCHITECTURE.md#the-fences), is why subsystem modules can
be imported directly in a test without a browser.

The deeper reason the logic is testable at all is that the pure parts are
deliberately separated from the driving parts — [`followMath.ts`](../src/bot/nav/followMath.ts)
from `WalkExecutor`, a quest's [`decide()`](QUESTS.md#quest-state) from the engine
that executes it. Those pure functions are the specification, and their tests are the
place to encode a bug you just fixed.

**A note on module mocks.** `mock.module` is global in Bun and leaks across test
files, so a partial mock can poison an unrelated file depending on run order. Either
re-export everything from the mocked module, or do not mock something that already
behaves correctly.

## Live harnesses

`tools/*-test.ts` drive a real browser against a real engine with Playwright. They
attach to the client through the harness ABI the client installs at
`globalThis.rs2b0t`:

```ts
rs2b0t.client     // ingame, sceneState, login(), loginUser/loginPass
rs2b0t.host       // tickCount
rs2b0t.runner     // state, ctx.log, bot, start(), stop()
rs2b0t.reader     // inventory(), npcs(), locs(), worldTile(), stat(), chat(), varp()
rs2b0t.registry   // the script registry
rs2b0t.actions
```

[`tools/lib/harness.ts`](../tools/lib/harness.ts) holds the shared parts:

| Helper | Job |
|---|---|
| `parseArgs(argv, defaults)` | `--base`, `--minutes`, positional rest |
| `launchBrowser({ swiftshader })` | a configured Playwright browser |
| `boot(page)` | wait until `client.constructor.loopCycle > 10` |
| `login(page, user, pass)` | log in and wait for `ingame && sceneState === 2` |
| `type(page, text)` | click the canvas, then type — cheats go through this |
| `bringUpOffIsland(page, opts)` | new account, teleported off tutorial island |
| `startFromLibrary(page, category, script)` | pick and start a script from the panel |

Some hard-won details:

- **Logging in auto-creates the account** on a local engine, so harnesses generate a
  fresh username per run rather than sharing state.
- **`type()` clicks the canvas first.** Keystrokes sent without focusing the canvas
  are dropped.
- **Cheats need a clean dialog state.** `::~maxme` raises level-up dialogs that
  swallow the *next* typed command.
- **Prove the bot worked, don't assume it.** Assert on game state — XP gained, items
  held, tiles reached — not on log lines.
- Software rendering (SwiftShader) is unreliable for some harnesses; several need a
  real GPU. Parallel browsers also perturb door timing, so validate a door fix solo.
- **`~maxme` grants stats and never gear.** A quest with a real fight in it needs
  the harness to give and equip a kit, or the "max stats" account is punching a
  level-93 boss. `Equipment.equip()` awaits `Execution.delayUntil`, which needs a
  running script context and throws from `page.evaluate` — drive the Wield/Wear
  held-op yourself; the direct input driver's is synchronous.
- **`::give` reaches the inventory, never the bank.** There is no working bank cheat
  in the current content, so a bank-withdraw path stays a unit-test concern.
- **A stage test seeds only what that stage produces, never its tools.** See
  [Quests](QUESTS.md#adding-a-quest) — every Watch Tower stage-10 test handed the bot
  a pickaxe, so all of them passed while the quest could not mine.
  [`tools/shilo-solo-test.ts`](../tools/shilo-solo-test.ts) is the current worked
  example: `--stage`/`--bits` jump the quest varps, `--tele` drops the account beside
  the leg under test, and `--speed 300` runs the engine at 2× ticks.

## The end-to-end smoke

```sh
bun run smoke                                     # against localhost:8890
bun run smoke http://localhost:8888 user pass     # another engine, named account
```

[`tools/e2e-smoke.ts`](../tools/e2e-smoke.ts) is the single harness that stands in
for the whole client. It boots `bot.html`, logs in, asserts the adapter banner is
empty and the tick counter is advancing, then starts `QuestDashboard` from the
library and drives it through pause, resume and stop — checking that the overlay
actually paints and that a paused script makes no progress. Screenshots land in
`out/`, and any page error fails the run.

It does **not** deploy. Deploy first (`bun run b0t`, or
[`tools/deploy-local.sh`](../tools/deploy-local.sh)) or it loads a stale client.

The other harnesses are per-subsystem and are run individually — a quest chain,
FireGiant, GatheringBot (`bun run verify:gatheringbot`), the hosted wall, relogin,
external script loading, a nature-runner soak. Several want a real GPU or a special
environment rather than a plain local engine.

```sh
bun run verify:gatheringbot                 # Miner/Fisher/Woodcutter live paths
bun run verify:gatheringbot -- mining acquire
HEADED=1 BUDGET_S=180 bun tools/gatheringbot-test.ts fish-cook-bank fish-bank-raw-cook restock-fly-barb
```

GatheringBot scenarios cover bank/power gather, Catherby cook-then-bank (seed cooked
lobster → catch last → cook → deposit), Catherby bank-raw-then-cook (noted raw seed
un-notes into bank, catch last → bank hits N → cook batch), long paths, Buy/repair
(coins-only + Bob/Nurmof broken-tool repair), Gerrant multi-buy restock, Auto freeform
outside preset 64×64 map squares, and smith. Named camps floor leash to 64; only
Location Auto respects a tight `leashRadius` (and skips mob flee). See
[DEV.md](DEV.md#gatheringbot-behaviour-smoke) for the full id table and redeploy
notes. Mainland setup always relogs after tutorial unlock (`RELOG_*` env overrides
in `tools/tutorial/harness.ts`).

## Writing a harness

```ts
import { boot, fail, launchBrowser, parseArgs } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { minutes: 4 });
const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    // log in, seed preconditions with cheats, start the script,
    // then poll game state for evidence it worked
} finally {
    await browser.close();
}
```

Seed preconditions with cheats rather than waiting for the world to provide them, and
poll for a condition instead of sleeping a fixed time — a fixed wait is the most
common source of a flaky harness.

## Known failures

[`src/bot/clues/data/cluedb.ts`](../src/bot/clues/data/cluedb.ts) is currently stale
against the local content pack (one medium clue's `Rope` requirement), so
`bun tools/clues/gen-cluedb.ts --check` reports drift.

## See also

- [Manual index](README.md)
- [Running locally](RUNNING.md#tests) — getting an engine to run these against
- [Architecture](ARCHITECTURE.md#the-fences) — the fences that keep the logic headless
