[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (Dig)

Per-quest seed and stage commands, with what each recipe has proven.

## The Dig Site — stage-scoped harness

[`e2e/digsite-251-live.ts`](../../e2e/digsite-251-live.ts) takes `--stage N` (`%itexamlevel`,
0 to 8) and clears `%itexam_errands` and `%itexam_bits` with it, then relogs. The three
varps are independent: the stage says which exam is next, the errands say which students
have been helped, and the bits carry the panning invite and the two winch ropes. Seeding
the stage alone leaves a character whose journal and world disagree.

```sh
HEADED=1 bun e2e/digsite-251-live.ts --stage 0 --until 9 --minutes 150 --tick 150   # end to end
HEADED=1 bun e2e/digsite-251-live.ts --stage 0 --until 2 --minutes 20 --tick 150    # letter, curator, hand-in
HEADED=1 bun e2e/digsite-251-live.ts --stage 2 --until 3 --minutes 40 --tick 150    # the three exam 1 errands
HEADED=1 bun e2e/digsite-251-live.ts --stage 3 --until 5 --minutes 45 --tick 150    # exams 2 and 3, and the opal
HEADED=1 bun e2e/digsite-251-live.ts --stage 5 --until 6 --minutes 40 --tick 150    # the level 3 dig and the permit
HEADED=1 bun e2e/digsite-251-live.ts --stage 6 --until 9 --minutes 60 --tick 150    # chemicals, blast, tablet
```

Stats are 70 rather than max: nothing in this quest fights, and the hard floors are
Agility 10 for the shaft, Herblore 10 for the compound and Thieving 25 for the workmen's
pockets. The bank holds coins and food alone — the trowel, the specimen jar, the brush,
the ropes, the panning tray, the opal, the charcoal and every chemical are sourced in the
world, and seeding one would hide whether the bot can find it.

| Recipe | What it proves | Status |
|---|---|---|
| `--stage 0 --until 2` | Examiner, Curator, the doomed first sitting | **PASS** (2min) |
| `--stage 2 --until 3` | Pickpocket, bush, the guide's tea, panning, exam 1 | **PASS** (5min) |
| `--stage 3 --until 5` | Exams 2 and 3, and the opal the purple student wants | **PASS** (8min) |
| `--stage 5 --until 6` | The level 3 dig, the expert and the workman's permit | **PASS** (3min) |
| `--stage 6 --until 9` | Both shafts, the chemicals, the blast and the tablet | **PASS** (11min, QP 0→2) |
| `--stage 0 --until 9` | Start to finish | **PASS** (22min, QP 0→2) |

`--stage` clears the errand and bit varps, so a jumped stage starts each exam's revision
and both winch ropes from nothing — a mid-quest recipe re-buys the guide's tea.

## See also

- [Quest harness recipes (Big)](quest-harness-recipes-17.md)
- [Quest harness recipes (A–D)](quest-harness-recipes.md)
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
- [Quest harness recipes (Tree–Tribal)](quest-harness-recipes-13.md)
- [Quest harness recipes (U)](quest-harness-recipes-16.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
