[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (M)

Per-quest seed and stage commands, with what each recipe has proven.

## Monk's Friend — stage-scoped harness

[`e2e/monks-friend-240-live.ts`](../../e2e/monks-friend-240-live.ts), members-only, so
`:8890`. `--stage N` is the raw `%drunkmonkquest` value and relogs after seeding it;
`--until N` is the value to reach, and `80` waits for the list to go green instead.

```sh
HEADED=1 bun e2e/monks-friend-240-live.ts --stage 0 --until 80 --minutes 30 --tick 200  # end to end
HEADED=1 bun e2e/monks-friend-240-live.ts --stage 0 --until 20 --minutes 20 --tick 200  # ladder, cave, hand-in
HEADED=1 bun e2e/monks-friend-240-live.ts --stage 10 --until 20 --minutes 12 --tick 200 # the blanket alone
HEADED=1 bun e2e/monks-friend-240-live.ts --stage 40 --until 60 --minutes 15 --tick 200 # jug, sink, Cedric
HEADED=1 bun e2e/monks-friend-240-live.ts --stage 50 --until 70 --minutes 15 --tick 200 # axe, logs, the cart
HEADED=1 bun e2e/monks-friend-240-live.ts --stage 70 --until 80 --minutes 12 --tick 200 # the party
```

Measured at `--tick 200`, no parks:

| Stages | Minutes | Covers |
|---|---|---|
| 0 → 20 | 2 | Omad, the hidden ladder, the cave, the hand-in |
| 20 → 40 | 1 | Omad names Cedric, Cedric asks for water |
| 40 → 60 | 2 | the jug at Port Khazard, the guardhouse sink, the cart |
| 50 → 70 | 2 | Kortan's iron axe, a forest tree, the logs |
| 70 → 80 | 1 | the dance and `QUEST COMPLETE!` |
| 0 → 80 | 5 | a clean account to green, 13 steps |

Three details govern this harness:

- **The relog after a seed does two jobs.** `update_questlist` recolours the list at
  login, and the same script re-arms the `blanket_ladder` timer whenever
  `%drunkmonkquest >= 10` — so `--stage 10` has no hidden ladder until it has relogged.
  See [Quest pitfalls](../decisions/quest-pitfalls-10.md).
- **The `quests` setting is a record id.** It seeds `drunkmonk`; the display name matches
  nothing, is filtered out, and an empty selection runs every quest instead.
- **The bank holds coins and food and nothing else.** The jug comes from Port Khazard's
  general store, the water from the sink at (2610,3195), the axe from Aemad's and the
  logs from a tree beside Cedric — seeding any of them hides whether the bot can find it.

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
- [Quest harness recipes (N–O)](quest-harness-recipes-14.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (Sea–Shades)](quest-harness-recipes-7.md)
- [Quest harness recipes (Sheep–Shield)](quest-harness-recipes-12.md)
- [Quest harness recipes (Tai–Temple)](quest-harness-recipes-9.md)
- [Quest harness recipes (Tree–Tribal)](quest-harness-recipes-13.md)
- [Quest harness recipes (U)](quest-harness-recipes-16.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
