[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (A–D)

Per-quest seed and stage commands, with what each recipe has proven.

## Clock Tower — stage-scoped harness

[`e2e/clock-tower-236-live.ts`](../../e2e/clock-tower-236-live.ts) drives the
quest from a clean account, or one leg of it. `--stage N` counts **cogs already
placed**, 0 to 4, and writes `%cogquest` and `%cog_bits` together before
relogging.

```sh
HEADED=1 bun e2e/clock-tower-236-live.ts --stage 0 --until 5 --minutes 60 --tick 200   # end to end
HEADED=1 bun e2e/clock-tower-236-live.ts --stage 0 --until 1 --minutes 20 --tick 200   # black: bucket, water, cool
HEADED=1 bun e2e/clock-tower-236-live.ts --stage 2 --until 3 --minutes 20 --tick 200   # blue: the secret wall
HEADED=1 bun e2e/clock-tower-236-live.ts --stage 3 --until 4 --minutes 25 --tick 200   # white: lever, poison, gate
```

The bank holds coins and food alone. The bucket, its water and the rat poison
all have sources in the world, and seeding one hides whether the bot finds it.

Measured end to end at `--tick 200`: **6 minutes** from a clean account.

Four details govern this harness:

- **The two varps have to move together.** `%cogquest` bits 0-3 carry the step
  and `%cog_bits` carries which spindles are filled, so setting one alone leaves
  the journal and the world disagreeing. `--stage` writes both, in the module's
  own fetch order — black, red, blue, white — and sets the cooled bit whenever
  black is already placed, or the bot pours a second bucket over a cold cog.
- **Stats are maxed rather than 70.** Ogres stand over the red cog and stay
  passive only above 106 combat; at 70 they chew on the bot for the length of
  the leg.
- **`--until 5` waits for the quest list to go green**, not for the varp: the
  recolour and the quest point land a tick behind `%cogquest`.
- **It fails in the first minute if the loaded bundle has no Clock Tower in its
  queue.** The engine serves one `public/bot`, and a concurrent session that
  deploys while this harness boots hands the run their branch instead.

## Dwarf Cannon — stage-scoped harness

Dwarf Cannon needs no items and no prerequisite quests: the Commander issues the railings
and the tool kit, Nulodion issues the notes and the mould, and every one has a re-issue
branch. The bank seed is coins, food and a melee kit only — seeding anything the quest
hands out would hide a dialogue that never fired.

[`e2e/dwarf-cannon-254-live.ts`](../../e2e/dwarf-cannon-254-live.ts) takes `--stage N`
(`%mcannon`) and `--multi N` (`%mcannonmulti`: bits 5-10 are the six railings, bits 0-3
the four cannon components), then relogs, since `update_questlist` only recolours the
journal at login. Useful `--multi` values are `2016` for all six railings, `15` for all
four components and `2031` for both.

| Recipe | What it proves | Status |
|---|---|---|
| `--stage 1 --multi 0 --until 2` | Six railings, and the Commander accepting them | **PASS** (3min) |
| `--stage 2 --multi 2016 --until 3` | The watchtower climb, the remains, the descent | **PASS** (4min) |
| `--stage 3 --multi 2016 --until 5` | The goblin cave, the crate, the mud-pile exit | **PASS** (3min) |
| `--stage 5 --multi 2016 --until 9` | The tool kit, the shed door, the repair menu | **PASS** (7min) |
| `--stage 9 --multi 2031 --until 11` | Nulodion, and the hand-back | **PASS** (4min) |
| `--stage 4 --multi 2016 --at 2620,9797,0` | Resuming from inside the cave | **PASS** (12min, QP 0→1) |
| `--stage 0` | Start to finish | **PASS** (17min, QP 0→1) |

## See also

- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F–H)](quest-harness-recipes-2.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M–O)](quest-harness-recipes-6.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (S–Z)](quest-harness-recipes-7.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
