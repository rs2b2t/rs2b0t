[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (N–O)

Per-quest seed and stage commands, with what each recipe has proven.

## Nature Spirit — stage-scoped harness

[`e2e/naturespirit-239-live.ts`](../../e2e/naturespirit-239-live.ts), members-only,
so `:8890`:

```sh
HEADED=1 bun e2e/naturespirit-239-live.ts --stage 0 --until 110 --minutes 120 --tick 200  # end to end
HEADED=1 bun e2e/naturespirit-239-live.ts --stage 0 --until 40 --minutes 45 --tick 200    # camp chain
HEADED=1 bun e2e/naturespirit-239-live.ts --stage 40 --until 75 --minutes 30 --tick 200   # ritual and grotto
HEADED=1 bun e2e/naturespirit-239-live.ts --stage 70 --until 85 --minutes 20 --stocked    # the sickle
HEADED=1 bun e2e/naturespirit-239-live.ts --stage 85 --until 110 --minutes 30 --tick 200  # the ghasts
```

Three things it does beyond the Horror shape:

- **Sets both prerequisites.** Eligibility reads the quest-list colour, so
  `prieststart` and `priestperil` are set and the run relogs — `update_questlist`
  only recolours at login. `priestperil` goes to 61, not 60: the Salve barrier the
  route depends on is `^priestperil_access_holy_barrier`.
- **Gives the pack what the stage implies.** A mid-quest start hands over the
  ghostspeak amulet, and from stage 75 the blessed sickle and a druid pouch — both
  come from Filliman, so a run seeded past him otherwise describes an unreachable
  state. Stage 0 gets none of it, which is what makes the end-to-end run the proof.
- **`--stocked` banks a mould and a silver bar** — ordinary clutter on an
  established account, and the only way to reach the cast without the Al Kharid
  round trip. Leave it off for anything claiming the quest works.

The bank holds coins and food alone by default. Nothing seeds a pickaxe: mining
without one raises no refusal at all, so a seeded run would pass while the quest
could not mine.

Measured end to end at `--tick 200`: **19 minutes, 37 steps, no parks** — walking,
with no teleports. Roughly half of that is the Mort Myre ↔ Al Kharid round trip the
silver sickle costs.

## Observatory Quest — stage-scoped harness

[`e2e/observatory-252-live.ts`](../../e2e/observatory-252-live.ts), members-only, so
`:8890`. `--stage` is the raw `%itgronigen` value and the run relogs after seeding it,
since `update_questlist` only recolours the journal entry at login.

```sh
HEADED=1 bun e2e/observatory-252-live.ts --stage 0 --until 7 --minutes 120 --tick 200  # end to end
HEADED=1 bun e2e/observatory-252-live.ts --stage 0 --until 1 --minutes 15 --tick 200   # the professor
HEADED=1 bun e2e/observatory-252-live.ts --stage 1 --until 2 --minutes 60 --tick 200   # the supply loop
HEADED=1 bun e2e/observatory-252-live.ts --stage 4 --until 6 --minutes 30 --stocked    # mould, lens, hand-in
HEADED=1 bun e2e/observatory-252-live.ts --stage 6 --until 7 --minutes 20 --tick 200   # cavern and dome
```

Three things worth knowing before reading a result:

- **`--until 2` covers the outing rather than one errand.** The module opens every leg whose
  stage is in reach, so reaching stage 2 means the sand, the pickaxe, the ore, the planks,
  the seaweed, both smelts and the cavern have all already run. It is the costly stage
  jump, and the one that proves the loop.
- **`--stats` is 70, not 99.** The only fight is the level-42 goblin guard on the keep
  gate. `setstat` is used rather than `~maxme`, which leaves the player delayed through its
  level-up cascade and swallows the next typed command.
- **`--stocked` banks three planks, a bronze bar and molten glass** — ordinary clutter on
  an established account, and the only way to reach the lens without the full loop. Leave
  it off for anything claiming the quest works.

The bank holds coins and food alone by default. Nothing seeds a pickaxe: mining without
one raises no refusal at all, so a seeded run would pass while the quest could not mine.

Measured end to end at `--tick 200`: **14 minutes, 27 steps, no parks** — walking, with no
teleports, from a bank holding coins and food alone. The stage jumps run **0 → 1 in 1
minute**, **1 → 4 in 11 minutes** (the outing plus four hand-overs) and **6 → 7 in 2
minutes**.

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
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (Sea–Shades)](quest-harness-recipes-7.md)
- [Quest harness recipes (Sheep–Shield)](quest-harness-recipes-12.md)
- [Quest harness recipes (Tai–Temple)](quest-harness-recipes-9.md)
- [Quest harness recipes (Tree–Tribal)](quest-harness-recipes-13.md)
- [Quest harness recipes (U)](quest-harness-recipes-16.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
- [The Observatory's pitfalls](../decisions/quest-pitfalls-27.md)
