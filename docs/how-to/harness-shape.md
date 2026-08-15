[Manual](../README.md) › [Testing](../TESTING.md) › Write a harness

# Write a harness


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

## The end-to-end smoke

```sh
bun run smoke                                     # against localhost:8890
bun run smoke http://localhost:8888 user pass     # another engine, named account
```

[`e2e/e2e-smoke.ts`](../../e2e/e2e-smoke.ts) is the single harness that stands in
for the client. It boots `bot.html`, logs in, asserts the adapter banner is
empty and the tick counter is advancing, then starts a looping bundled script
(`AIO Teleport`) from the library and drives it through pause, resume and stop —
checking that the overlay paints and that a paused script makes no
progress. Screenshots land in `out/`, and any page error fails the run.

It does **not** deploy. Deploy first (`bun run b0t`, or
[`tools/deploy-local.sh`](../../tools/deploy-local.sh)) or it loads a stale client.

The other harnesses are per-subsystem and are run individually — a quest chain,
FireGiant, GatheringBot (`bun run verify:gatheringbot`), the hosted wall, relogin,
external script loading, a nature-runner soak. Several want a physical GPU or a special
environment rather than a plain local engine.

```sh
bun run verify:gatheringbot                 # Miner/Fisher/Woodcutter live paths
bun run verify:gatheringbot -- mining acquire
HEADED=1 BUDGET_S=180 bun e2e/gatheringbot-test.ts fish-cook-bank fish-bank-raw-cook restock-fly-barb
```

GatheringBot scenarios cover bank/power gather, Catherby cook-then-bank (seed cooked
lobster → catch last → cook → deposit), Catherby bank-raw-then-cook (noted raw seed
un-notes into bank, catch last → bank hits N → cook batch), long paths, Buy/repair
(coins-only + Bob/Nurmof broken-tool repair), Gerrant multi-buy restock, Auto freeform
outside preset 64×64 map squares, and smith. Named camps floor leash to 64; only
Location Auto respects a tight `leashRadius` (and skips mob flee). See
[DEV.md](../how-to/gatheringbot-smoke.md) for the full id table and redeploy
notes. Mainland setup always relogs after tutorial unlock (`RELOG_*` env overrides
in `e2e/tutorial/harness.ts`).

## See also

- [The live-harness ABI](write-a-harness.md)
