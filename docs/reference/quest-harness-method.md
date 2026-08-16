[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness method

# Quest harness method

What every quest harness does, independent of which quest it drives.

## Building one

1. Prefer `bank:obj:qty` / `givebank` / `~bankitem` over give→deposit loops for unstackable food.
2. Ideal smoke → realistic bank-seed → **lower non-required stats until red**;
   keep proven floor + failed floor + next probe in the module; `warnReadiness`.
3. Leave the pack empty after bank seed so provisioning runs.
4. Drain dialogs before `~bankitem`; prefer `givebank` mid-setup.
5. Assert journal complete + clean stop.
6. Later: power-level tactics (safespot vs melee) from the same skill snapshot.

## Facts a harness is built on

- **`::death` is a clean kill** (`~damage_self(999)`): respawn is Lumbridge `(3221,3218)`,
  and `move_priciest_item_on_hero_to_death` keeps *one* of each of the three priciest items
  — so a coin stack comes back as a single coin. Use it to drive death recovery through a death
  rather than seeding a post-death pose.
- **A stage test seeds only what that stage produces, never its tools.** See
  [Quests](../how-to/add-a-quest.md) — every Watch Tower stage-10 test handed the bot
  a pickaxe, so all of them passed while the quest could not mine.
  [`e2e/shilo-solo-test.ts`](../../e2e/shilo-solo-test.ts) is the current worked
  example: `--stage`/`--bits` jump the quest varps, `--tele` drops the account beside
  the leg under test, and `--speed 300` runs the engine at 2× ticks.
- **Measure throughput per tick, never per hour.** A dev world does not tick at 600ms
  and `--speed` changes it again, so an actions/hour figure read off a sim is fiction.
  [`e2e/roguespurse-test.ts`](../../e2e/roguespurse-test.ts) reports herbs/**tick**
  from the `host.tickCount` delta, which is comparable to the engine's own limits
  (5 user events per tick) and to a 600ms world.
- **A live harness runs the built bundle, not the working tree.** Deploy
  `botclient.js`, `botclient.js.map`, `navworker.js` and `navworker.js.map` together;
  a client-only deploy leaves the navigator on the old edges.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (H)](quest-harness-recipes-8.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M–O)](quest-harness-recipes-6.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (S)](quest-harness-recipes-7.md)
- [Quest harness recipes (T)](quest-harness-recipes-9.md)
- [Seeding test accounts](seeding-test-accounts.md)
