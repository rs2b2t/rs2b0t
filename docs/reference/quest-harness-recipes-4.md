[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (E)

Per-quest seed and stage commands, with what each recipe has proven.

## Elemental Workshop — harness recipes and combat floor search

Polish goal (all quests with non-required combat): find the **bare minimum**
stats that still clear, record fails, then later branch tactics by power level
([Quests — proven floors](../reference/quest-eligibility.md#bot-proven-floors-polish-goal)).

| Recipe | What it proves | Status |
|---|---|---|
| Inv seed + `statsCsv=max` | Mid-quest loop | **PASS** |
| Bank seed + skills 20 + combat 40/40/25/40 | Low combat | **FAIL** (Water elemental death) |
| Bank seed + skills 20 + combat 50/50/40/50 | Bare-min combat (so far) | **PASS** (~270s, `givebank` seed) |
| Bank seed + combat 45/45/30/45 | Next lower probe | not run yet |
| Official skills only (20/20/20) | Server eligibility | required; combat not gated |

Constants:
[`EW_PROVEN_COMBAT_FLOOR`](../../src/bot/api/ai/quests/defs/elementalworkshop/supplies.ts)
(50/50/40/50), `EW_FAILED_COMBAT` (40/40/25/40), `EW_PROBE_COMBAT` (45/…),
`EW_OFFICIAL_SKILLS`. `warnReadiness` logs if the account is below the proven floor.

The ideal smoke run is this:

```sh
HEADED=1 bun e2e/aio-quest-test.ts http://localhost:8890 ew1 elemental_workshop 15 \
  'knife:1,hammer:1,bronze_pickaxe:1,thread:1,leather:1,needle:1,coal:4,lobster:15,steel_scimitar:1' \
  max Lobster 'speed 300' '2716,3481'
```

Realistic bank-seed at **proven floor** (safe default for writers):

```sh
HEADED=1 bun e2e/aio-quest-test.ts http://localhost:8890 ewreal elemental_workshop 25 \
  'bank:knife:1,bank:hammer:1,bank:bronze_pickaxe:1,bank:thread:2,bank:leather:1,bank:needle:1,bank:coal:8,bank:lobster:20,bank:steel_scimitar:1,bank:coins:50000' \
  'mining:20,smithing:20,crafting:20,attack:50,strength:50,defence:40,hitpoints:50' \
  Lobster 'speed 300' '2725,3491'
```

## Ernest the Chicken — stage-scoped harness

[`e2e/ernest-chicken-229-live.ts`](../../e2e/ernest-chicken-229-live.ts) drives
the quest from a clean account, or one stage of it. `--stage N` sets
`%haunted` and relogs; the module reads the quest tab, not the varp.

```sh
HEADED=1 bun e2e/ernest-chicken-229-live.ts --stage 0 --until 3 --minutes 90   # end to end
HEADED=1 bun e2e/ernest-chicken-229-live.ts --stage 2 --until 3 --minutes 60   # the three parts
HEADED=1 bun e2e/ernest-chicken-229-live.ts --stage 1 --until 2 --minutes 20   # Oddenstein, on L2
HEADED=1 bun e2e/ernest-chicken-229-live.ts --stage 2 --until 3 --poisoned     # Search-first branch
```

The bank is seeded with coins and food and nothing else. The spade, poison, fish
food and closet key all have sources in the world, and seeding one hides whether
the bot can find it.

Measured end to end at the default `--tick 300`: **11 minutes** from a clean
account, no parks.

Three details govern this harness:

- **`--poisoned` sets `haunted_manor_fountain_poisoned`.** The gauge leg Searches
  the fountain first and only fetches poison and fish food if the piranhas bite,
  because the latch is not readable. A fresh account always takes the bitten
  branch, so the other half is only reachable on a resume — or with this flag.

- **Stats are set to 70, not `~maxme`.** A maxed account hides reach and damage
  problems, and nothing in Draynor Manor is aggressive anyway — the only
  guaranteed damage in the quest is the 1 hp piranha bite from searching the
  fountain before it has been poisoned.
- **It runs on :8890 even though Ernest is free-to-play.** The quest needs
  nothing members-only, but *bank seeding* does: the :8888 sim answers neither
  `givebank` nor `~bankitem`, so a run there starts with an empty bank and parks
  on the food float.

Next lower probe (update `EW_PROVEN_COMBAT_FLOOR` only if green):

```sh
HEADED=1 bun e2e/aio-quest-test.ts http://localhost:8890 ewprobe elemental_workshop 25 \
  'bank:knife:1,bank:hammer:1,bank:bronze_pickaxe:1,bank:thread:2,bank:leather:1,bank:needle:1,bank:coal:8,bank:lobster:25,bank:steel_scimitar:1,bank:coins:50000' \
  'mining:20,smithing:20,crafting:20,attack:45,strength:45,defence:30,hitpoints:45' \
  Lobster 'speed 300' '2725,3491'
```

Expect `check the bank` / `withdraw` after book/key. After journal **ENTERED**,
death recovery re-enters with **Push** (no key) and re-withdraws bank tools.

## Eadgar's Ruse — harness recipes

[`e2e/eadgar-ruse-241-live.ts`](../../e2e/eadgar-ruse-241-live.ts), base `:8890`.
The bank gets coins, food, a rune kit and **one ranarr weed** — no 2004 shop sells a
ranarr or a ranarr potion (unf), and everything else the quest wants (the boots, the
knife, the pineapple, the vodka, the axe, the pestle, the tinderbox, the logs, the
chickens, the grain) has to be sourced by the run.

| Flag | What it changes |
|---|---|
| `--stage N` | `%eadgar_quest`, then relogs so the journal recolours |
| `--until N` | stop at that stage; `>= 110` waits for the journal to go green |
| `--at x,z,level` | start tile, so an inner leg skips the walk in |
| `--pack` | boots, food, a scimitar and coins straight to the inventory |
| `--unfreed` | leaves `troll_freed_eadgar` clear, so the free-Eadgar recovery runs |
| `--paint` | draws the planned route in red and the client's own leg in cyan |

```sh
HEADED=1 bun e2e/eadgar-ruse-241-live.ts --stage 0 --minutes 180 --tick 200
HEADED=1 bun e2e/eadgar-ruse-241-live.ts --stage 25 --until 50 --at 2890,10086,2 --pack --minutes 45 --tick 200
HEADED=1 bun e2e/eadgar-ruse-241-live.ts --stage 70 --until 110 --minutes 90 --tick 200
```

Measured at `--tick 200`, with 70 in every skill and the bank seed above:

| Leg | What it proves | Time |
|---|---|---|
| `--stage 0 --until 10` | Sanfew's offer, and buying the boots from Tenzing | 3 min |
| `--stage 10 --until 15` | the walk onto Trollheim and into Mad Eadgar's cave | 5 min |
| `--stage 15 --until 25` | the stronghold kitchen and Burntmeat | 2 min |
| `--stage 25 --until 50` | the parrot chain end to end, three counters and two kingdoms | 16 min |
| `--stage 70 --until 110` | robe, potion, parrot back, fake man, storeroom, Sanfew | 42 min |

It deploys its own copy of the client through
[`deployIsolatedClient`](../../e2e/lib/harness.ts), which this quest needs more than most:
it adds three transport edges, and a neighbouring session's deploy landing in the shared
`public/bot` shows up only as `no path to (2890,10086,2): unreachable`.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (Big)](quest-harness-recipes-17.md)
- [Quest harness recipes (Dig)](quest-harness-recipes-15.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (Fre)](quest-harness-recipes-18.md)
- [Quest harness recipes (G)](quest-harness-recipes-11.md)
- [Quest harness recipes (Haz–Hol)](quest-harness-recipes-8.md)
- [Quest harness recipes (Her)](quest-harness-recipes-19.md)
- [Quest harness recipes (Hor)](quest-harness-recipes-10.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M)](quest-harness-recipes-6.md)
- [Quest harness recipes (N–O)](quest-harness-recipes-14.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (Sea–Shades)](quest-harness-recipes-7.md)
- [Quest harness recipes (Sheep–Shield)](quest-harness-recipes-12.md)
- [Quest harness recipes (Tai–Temple)](quest-harness-recipes-9.md)
- [Quest harness recipes (Tree–Tribal)](quest-harness-recipes-13.md)
- [Quest harness recipes (U)](quest-harness-recipes-16.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
