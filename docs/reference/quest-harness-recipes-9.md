[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (T)

Per-quest seed and stage commands, with what each recipe has proven.

## Tai Bwo Wannai Trio — brother-scoped harness

[`e2e/tbwt-261-live.ts`](../../e2e/tbwt-261-live.ts) drives the quest from a clean
account, or one brother's leg of it. Six varps are seeded together, then a relog.

```sh
HEADED=1 bun e2e/tbwt-261-live.ts --stage 0 --minutes 180 --tick 300                      # end to end
HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --until 4 --minutes 45                        # the Lubufu bait leg
HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --lubufu 31 --at 2912,3118,0                  # Tiadeche's catch
HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --lubufu 31 --tiadeche 4 --at 2844,3042,0     # Tamayu's hunt
HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --lubufu 31 --tiadeche 4 --tamayu 3 --flags 480  # the killing hunt alone
HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --lubufu 31 --tiadeche 4 --tamayu 4 --at 2764,2976,0  # Tinsay
```

`--flags` is `%tbwt_flags`: bits 3-5 hold Tamayu's agility count, bit 6 that his spear
is strong enough, bit 7 that it is poisoned and bit 8 that the poison is Karambwan.

| `--flags` | State |
|---|---|
| `32` | four doses drunk, no spear given — the seed for testing the spear chain |
| `480` | four doses and an Iron spear(kp) — what the killing hunt needs |

A Tinsay-only run wants `--tamayu 4`: Tamayu is the only NPC on the island who will
skin a monkey, and he does it only once his own hunt is over.

`--packed` hands the kit straight to the pack. It is for iterating on one leg: a
mid-quest seed lands on Karamja, and without it the first four minutes of every leg
test are the ferry to Ardougne and back. The end-to-end run never takes it — sourcing
the kit is part of what that run proves.

Four details govern this harness:

- **`--stage` alone reaches none of the quest.** `%tbwt_main` holds one value across
  the brothers phase; the progress is in `%tbwt_tiadeche`, `%tbwt_tinsay`,
  `%tbwt_tamayu`, `%tbwt_lubufu` and `%tbwt_flags`, and each is set separately.
- **`%tbwt_main` and `%tbwt_tiadeche` are `transmit=yes`.** They are the exception the
  [varp decision](../decisions/quest-state-not-varps.md) names, so the module reads
  them off the wire and only opens the journal for the other three brothers.
- **The bank holds no knife, pestle or tinderbox.** Jiminua stocks all three inside the
  village, and seeding them would hide whether the bot can buy them. The net, seaweed,
  iron spear and agility potion are seeded, because nothing on Karamja sells those.
- **The kit is ranged.** `opnpc2,monkey` deflects every melee swing while the quest is
  live, so a seed with a scimitar in it never gets a monkey corpse.
- **The bundle guard earns its keep here.** Five other quest harnesses were deploying
  into the same `public/bot/` while this one was written, and one of them landed inside
  the fifteen seconds this harness spends booting. The queue-line check failed the run
  in the first minute with `another worktree deployed over it`; the fix is to rerun.

What the live runs paid for is in [Tai Bwo Wannai Trio's pitfalls](../decisions/quest-pitfalls-14.md).

## Tribal Totem — stage-scoped harness

[`e2e/tribal-totem-262-live.ts`](../../e2e/tribal-totem-262-live.ts) drives the quest from a
clean account, or one leg of it. `--stage N` is `%totemquest` itself and relogs.

```sh
HEADED=1 bun e2e/tribal-totem-262-live.ts --stage 0 --until 5 --minutes 45 --tick 200  # end to end
HEADED=1 bun e2e/tribal-totem-262-live.ts --stage 1 --until 3 --minutes 15 --tick 200  # label, crate, delivery
HEADED=1 bun e2e/tribal-totem-262-live.ts --stage 4 --until 5 --minutes 20 --tick 200  # lock, trap, chest, hand-in
HEADED=1 bun e2e/tribal-totem-262-live.ts --stage 4 --combo --until 5 --minutes 15     # skip the lock
```

Measured at `--tick 200` on 70 stats, no parks:

| Stages | Minutes | Covers |
|---|---|---|
| 1 → 3 | 1 | the address label, the relabel, the R.P.D.T. delivery |
| 4 → 5 | 3 | the KURT lock, the stairs trap, the chest, the ferry home |
| 0 → 5 | 4-5 | a clean account to `QUEST COMPLETE!` |

Four details govern this harness:

- **`--stage` is the varp, and 4 starts inside the mansion.** Nothing walks into Handelmort
  Mansion — its one ground-floor door opens outward only — so a stage-4 seed teleports to
  Cromperty's landing tile at (2638,3321) rather than the bank every earlier stage starts at.
- **The stairs trap bit is never seeded.** `--combo` sets bit 0 of
  `%handelmort_traps_disabled` to skip the four dials, and bit 21 is deliberately left clear:
  a run that climbs without Investigating falls into the Ardougne sewers for a fifth of its
  hitpoints, and that is the thing worth proving.
- **The bank holds coins and lobsters and nothing else.** The address label comes off a crate
  in the R.P.D.T. depot and the ferry fare comes out of the engine's coin float, so seeding
  either would hide whether the bot can find it.
- **The first Talk-to after a long walk can report unreachable.** Kangai Mau stands behind a
  counter and Cromperty wanders his own house; each cost one retry per run and neither cost a
  park. Read the second attempt's timing, not the first's.

It is members-only, so it needs the `:8890` world; the `:8888` sim also answers neither
`givebank` nor `~bankitem`, so a run there starts with an empty bank and parks on the coin
float.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (H)](quest-harness-recipes-8.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M–O)](quest-harness-recipes-6.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (S)](quest-harness-recipes-7.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
