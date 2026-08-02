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

**A note on module mocks.** `mock.module` is global in Bun and **permanent for the
process** — there is no unmock — so a mock leaks into every file that runs after it.
This caused every one of the suite's long-standing failures. Two distinct shapes:

- **Missing exports.** A mock returning `{ Npcs: … }` drops `talkOp` and `Npc`, so the
  next file importing them dies with `SyntaxError: Export named 'talkOp' not found`.
  Only modules with more than one *runtime* export can do this — `Npcs`, `Locs`,
  `GroundItems`, `Inventory`. Fix: `import * as Real from …` and spread it.
- **Overridden behaviour.** Even a complete mock replaces the singleton, so a test that
  needs the *real* implementation gets the stub. Spreading does not help here.
  Fix: **mutate the singleton instead of replacing the module**, scoped to the file:

  ```ts
  import * as RealInventory from '#/bot/api/hud/Inventory.js';
  const realFns = { ...RealInventory.Inventory };
  const stub = { items: () => […] };
  beforeEach(() => Object.assign(RealInventory.Inventory, stub));
  afterAll(() => Object.assign(RealInventory.Inventory, realFns));
  ```

  Mutation without the `afterAll` restore is the same leak in a new coat.

**Global singletons leak the same way.** `test/ui/bot-panel.test.ts` registered a fixture
script and never removed it, so `docs/SCRIPTS.md` read as stale against a registry holding
a script that does not exist. `ScriptRegistry.unregister(name)` exists for this.

**A test that asserts absence must establish it.** `Anchor.test.ts` asserted a task stays
idle "without a live `Game.tile()`" but never set that up — it silently inverted whenever
a file mocking `Game` ran first. Control your own inputs.

**Run a suspect file alone as well as in the suite.** These two disagreeing is the
signature of a leak, and a file can fail alone while passing in the suite (another file's
mock was covering for it).

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
| `HARNESS_VIEWPORT` | preferred page size **1280×720** (Playwright default) |
| `boot(page)` | wait until `client.constructor.loopCycle > 10` |
| `login(page, user, pass)` | log in and wait for `ingame && sceneState === 2` |
| `type(page, text)` | click the canvas, then type — cheats go through this |
| `bringUpOffIsland(page, opts)` | new account, teleported off tutorial island |
| `startFromLibrary(page, category, script)` | pick and start a script from the panel |

**Viewport (local preference).** Headed Chrome should use the **smaller** client scale
used by GatheringBot / `verify-gather-locs` / plain `browser.newPage()` — Playwright’s
default **1280×720**, exported as `HARNESS_VIEWPORT`. Do **not** set
`{ width: 1500, height: 1000 }` (or similar). `bot.html` scales the fixed **765×503**
game stage to fill the page; a large viewport makes the game look blown up and
flip-flops between harness prototypes. Prefer omitting `setViewportSize` /
`viewport` entirely so the default applies.

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
- **`::give` → inventory; `::givebank` → bank.** Local engine cheats (no busy-guard).
  Content debugprocs `~item` / `~bankitem` do the same but need `p_finduid` (seed after
  dialogs, not mid-`~maxme`). Prefer engine cheats from Playwright; verify bank counts
  with a booth open when the seed matters.
- **`::bank_f2p` stocks a bulk bank** (coins, food, pickaxes, scimitars, …) with no
  dialog. Prefer it to `::bank_preset`, which first asks "This clears your bank.
  Continue?" and needs the choice answered before it does anything. It is a blunt
  fixture, not a realistic kit for a low-level quest.
- **Seeding the bank for realistic quest tests** is documented below.

### Seeding inventory vs bank

A full AIOQuester pass must exercise **provisioning**: empty pack, tools in the bank,
min skill levels, scanBank → withdraw → enter. Pre-loading the pack and `~maxme` only
proves the mid-quest loop. Live harnesses always run against a **local** engine, so
Server debug cheats are fair game.

| Goal | How (local Server) |
|---|---|
| Item in **inventory** | engine `give bronze_pickaxe 1` (or content `~item bronze_pickaxe 1`) |
| Item in **bank** | engine `givebank bronze_pickaxe 1` (or content `~bankitem bronze_pickaxe 1`) |
| Wipe pack | `~clearinv` / `clearinv inv` |
| Wipe bank | `~clearbank` |
| Bulk max bank | `~bank_f2p` (no dialog) — blunt fixture, not a realistic low-level kit |
| Stats | `advancestat mining 20` (then clear level-up dialogs) or `statsCsv=max` |
| Tick rate | `speed 300` (2×) in cheats |

**Bank seed path** (`seedItemsToBank` in
[`tools/tutorial/harness.ts`](../tools/tutorial/harness.ts)):

1. `givebank <obj> <qty>` for each item (engine `ClientCheatHandler` — no busy-guard).
2. If verify fails, retry with `~bankitem` (content debugproc; needs `p_finduid`).
3. Tele next to a booth, open it once, assert `Bank.count(displayName)`.

Do **not** invent give→deposit loops for food/coal: backpack unstackables fill the
pack and the seed stalls. Direct bank cheats skip that entirely.

[`tools/aio-quest-test.ts`](../tools/aio-quest-test.ts) exposes bank seeds as a
**`bank:`** prefix on `giveCsv`:

```text
bank:knife:1,bank:hammer:1,bank:bronze_pickaxe:1,bank:coal:8
```

vs inventory-only `knife:1,hammer:1`. Display names for verification are mapped from
engine debug names inside the harness (`bronze_pickaxe` → `Bronze pickaxe`).

**Elemental Workshop — harness recipes and combat floor search**

Polish goal (all quests with non-required combat): find the **bare minimum**
stats that still clear, record fails, then later branch tactics by power level
([Quests — proven floors](QUESTS.md#official-reqs-vs-bot-proven-floors-polish-goal)).

| Recipe | What it proves | Status |
|---|---|---|
| Inv seed + `statsCsv=max` | Mid-quest loop | **PASS** |
| Bank seed + skills 20 + combat 40/40/25/40 | Low combat | **FAIL** (Water elemental death) |
| Bank seed + skills 20 + combat 50/50/40/50 | Bare-min combat (so far) | **PASS** (~270s, `givebank` seed) |
| Bank seed + combat 45/45/30/45 | Next lower probe | not run yet |
| Official skills only (20/20/20) | Server eligibility | required; combat not gated |

Constants:
[`EW_PROVEN_COMBAT_FLOOR`](../src/bot/quests/defs/elementalworkshop/supplies.ts)
(50/50/40/50), `EW_FAILED_COMBAT` (40/40/25/40), `EW_PROBE_COMBAT` (45/…),
`EW_OFFICIAL_SKILLS`. `warnReadiness` logs if the account is below the proven floor.

Ideal smoke:

```sh
HEADED=1 bun tools/aio-quest-test.ts http://localhost:8890 ew1 elemental_workshop 15 \
  'knife:1,hammer:1,bronze_pickaxe:1,thread:1,leather:1,needle:1,coal:4,lobster:15,steel_scimitar:1' \
  max Lobster 'speed 300' '2716,3481'
```

Realistic bank-seed at **proven floor** (safe default for writers):

```sh
HEADED=1 bun tools/aio-quest-test.ts http://localhost:8890 ewreal elemental_workshop 25 \
  'bank:knife:1,bank:hammer:1,bank:bronze_pickaxe:1,bank:thread:2,bank:leather:1,bank:needle:1,bank:coal:8,bank:lobster:20,bank:steel_scimitar:1,bank:coins:50000' \
  'mining:20,smithing:20,crafting:20,attack:50,strength:50,defence:40,hitpoints:50' \
  Lobster 'speed 300' '2725,3491'
```

Next lower probe (update `EW_PROVEN_COMBAT_FLOOR` only if green):

```sh
HEADED=1 bun tools/aio-quest-test.ts http://localhost:8890 ewprobe elemental_workshop 25 \
  'bank:knife:1,bank:hammer:1,bank:bronze_pickaxe:1,bank:thread:2,bank:leather:1,bank:needle:1,bank:coal:8,bank:lobster:25,bank:steel_scimitar:1,bank:coins:50000' \
  'mining:20,smithing:20,crafting:20,attack:45,strength:45,defence:30,hitpoints:45' \
  Lobster 'speed 300' '2725,3491'
```

Expect `check the bank` / `withdraw` after book/key. After journal **ENTERED**,
death recovery re-enters with **Push** (no key) and re-withdraws bank tools.

**Recipe for future quest harnesses:**

1. Prefer `bank:obj:qty` / `givebank` / `~bankitem` — not invent give→deposit for
   unstackable food.
2. Ideal smoke → realistic bank-seed → **lower non-required stats until red**;
   keep proven floor + failed floor + next probe in the module; `warnReadiness`.
3. Leave the pack empty after bank seed so provisioning runs.
4. Drain dialogs before `~bankitem`; prefer `givebank` mid-setup.
5. Assert journal complete + clean stop.
6. Later: power-level tactics (safespot vs melee) from the same skill snapshot.

- **`::death` is a clean kill** (`~damage_self(999)`): respawn is Lumbridge `(3221,3218)`,
  and `move_priciest_item_on_hero_to_death` keeps *one* of each of the three priciest items
  — so a coin stack comes back as a single coin. Use it to test death recovery for real
  rather than seeding a post-death pose.
- **A stage test seeds only what that stage produces, never its tools.** See
  [Quests](QUESTS.md#adding-a-quest) — every Watch Tower stage-10 test handed the bot
  a pickaxe, so all of them passed while the quest could not mine.
  [`tools/shilo-solo-test.ts`](../tools/shilo-solo-test.ts) is the current worked
  example: `--stage`/`--bits` jump the quest varps, `--tele` drops the account beside
  the leg under test, and `--speed 300` runs the engine at 2× ticks.
- **Measure throughput per tick, never per hour.** A dev world does not tick at 600ms
  and `--speed` changes it again, so an actions/hour figure read off a sim is fiction.
  [`tools/roguespurse-test.ts`](../tools/roguespurse-test.ts) reports herbs/**tick**
  from the `host.tickCount` delta, which is comparable to the engine's own limits
  (5 user events per tick) and to a real 600ms world.

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
