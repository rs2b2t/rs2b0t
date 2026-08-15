[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (M–O)

Per-quest seed and stage commands, with what each recipe has proven.

## Murder Mystery — leg-scoped harness

[`e2e/murder-mystery-256-live.ts`](../../e2e/murder-mystery-256-live.ts), members-only,
so `:8890`:

```sh
HEADED=1 bun e2e/murder-mystery-256-live.ts --stage 0 --until 5 --minutes 90 --tick 200            # end to end
HEADED=1 bun e2e/murder-mystery-256-live.ts --stage 1 --until 2 --minutes 20 --tick 200            # pot, then the thread
HEADED=1 bun e2e/murder-mystery-256-live.ts --stage 2 --until 3 --sus 4 --minutes 40 --tick 200    # the print hunt
HEADED=1 bun e2e/murder-mystery-256-live.ts --stage 3 --until 4 --sus 4 --minutes 30 --tick 200    # salesman, suspect, loc
HEADED=1 bun e2e/murder-mystery-256-live.ts --stage 4 --until 5 --sus 4 --minutes 20 --tick 200    # the hand-in
```

`--stage` counts **legs**, not the varp: `%murderquest` only knows started and
complete, and the three pieces of evidence live in `%murder_evidence` (bits 1 and 2)
and `%murder_poisonproof_progress`. The legs are 0 not started, 1 started, 2 thread
found, 3 prints matched, 4 poison proved, 5 complete, and the harness writes every
variable that leg implies before relogging — `update_questlist` only recolours the
journal at login.

Three details govern this harness:

- **`--sus N` pins the guilty sibling, 1 to 6 in Anna, Bob, Carol, David, Elizabeth,
  Frank order.** The guard's own dialogue rolls `%murdersus`, so a seeded stage that
  leaves it at 0 describes a murder with no murderer and every later check reads a
  quest that cannot be finished. Left off, the harness rolls one and says which.
  `--sus 4` is the most useful single run: green thread puts Anna first and David
  second, so one pass covers a mismatch, a match, and a barrel on each floor.
- **A seeded leg gets the evidence it produced, never the tools.** From leg 2 that is
  the thread whose colour matches the roll, and from leg 3 the killer's print and the
  guilty sibling's keepsake — the keepsake because the pack is what names the murderer
  again after a restart. The empty pot is a tool: the bot buys its own from Arhein.
- **The bank holds coins and food alone.** The flour, the flypaper, the six keepsakes
  and the dagger are all at the mansion, and the pot is a gold piece in Catherby, so
  seeding any of them hides whether the bot can find it.

It serves its own client through `deployIsolatedClient`, so a neighbouring harness
deploying mid-boot cannot decide which branch this run exercises; the queue-line check
that remains proves this run's own deploy landed.

Measured at `--tick 200`, no parks and no failed steps. The seeded legs pin `--sus 4`;
the end-to-end run takes whatever the guard rolls, and three of them rolled Bob, David
and David:

| Legs | Minutes | Covers |
|---|---|---|
| 1 → 2 | 2 | Arhein's pot, then the thread off the window |
| 2 → 3 | 3 | the dagger, Anna cleared, David matched, both floors |
| 3 → 4 | 2 | the salesman, David's answer, the spiders' nest |
| 4 → 5 | 2 | the hand-in and `QUEST COMPLETE!` |
| 0 → 5 | 4 | a clean account to `QUEST COMPLETE!`, three times |

The end-to-end run is shorter than the sum of its legs because a seeded leg pays for a
walk out to wherever the previous leg would already have left the bot standing.

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

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F–H)](quest-harness-recipes-2.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (S–Z)](quest-harness-recipes-7.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
