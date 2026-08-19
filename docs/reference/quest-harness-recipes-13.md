[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (Tree–Tribal)

Per-quest seed and stage commands, with what each recipe has proven.

## Tree Gnome Village — stage-scoped harness

[`e2e/treegnome-263-live.ts`](../../e2e/treegnome-263-live.ts) drives the quest from a
clean account or from any point inside it. `--stage N` sets `%treequest`, hands over the
orb that stage assumes was already won, and relogs; `--lost-orb` withholds it.

```sh
HEADED=1 bun e2e/treegnome-263-live.ts --stage 0 --until 9 --minutes 90 --tick 200  # end to end
HEADED=1 bun e2e/treegnome-263-live.ts --stage 0 --until 4 --minutes 45 --tick 200  # Bolren, Montai, the axe, six logs
HEADED=1 bun e2e/treegnome-263-live.ts --stage 4 --until 7 --minutes 30 --tick 200  # ballista, breach, chest, Bolren
HEADED=1 bun e2e/treegnome-263-live.ts --stage 7 --until 9 --minutes 45 --tick 200  # the warlord and the hand-back
HEADED=1 bun e2e/treegnome-263-live.ts --stage 6 --until 9 --minutes 45 --lost-orb  # the chest again after a lost orb
```

Measured at `--tick 200` on 70 stats, no parks:

| Stages | Minutes | Covers |
|---|---|---|
| 0 → 4 | 5 | Bolren through the railing, Montai, Aemad's axe, six logs |
| 4 → 7 | 3 | the ballista, the crumbled wall, the inner door, the chest, Bolren |
| 7 → 9 | 3 | the warlord and both orbs back to Bolren |
| 0 → 9 | 8 | a clean account to `QUEST COMPLETE!` |

Four details govern this harness:

- **The bank holds coins, food and a rune melee kit.** The axe, the six logs and both
  orbs have a source in the world; seeding one would hide whether the bot can find it.
- **Stats are 70 rather than max.** Prayer 70 covers Protect from Melee, which is what
  makes the warlord a fight the bot walks away from at full health.
- **It runs on `:8890`.** `givebank` is inert there and every seed falls through to
  `~bankitem`, which the helper verifies at a booth before trusting it.
- **The quest is members-only, and the run deploys its own client.** A neighbouring
  harness writing `public/bot/` mid-boot would otherwise decide which branch runs.

What the live runs paid for is in [Tree Gnome Village's pitfalls](../decisions/quest-pitfalls-17.md).

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
- [Quest harness recipes (Big)](quest-harness-recipes-17.md)
- [Quest harness recipes (Dig)](quest-harness-recipes-15.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
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
- [Quest harness recipes (U)](quest-harness-recipes-16.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
