[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (U)

Per-quest seed and stage commands, with what each recipe has proven.

## Underground Pass — stage-scoped harness

[`e2e/upass-265-live.ts`](../../e2e/upass-265-live.ts) drives the quest from a clean
account or from any stage inside it.

```sh
HEADED=1 bun e2e/upass-265-live.ts --stage 0 --until 10 --tick 200 --minutes 120  # end to end
HEADED=1 bun e2e/upass-265-live.ts --stage 0 --until 2  --tick 200 --minutes 30   # Lathas, Koftik, the bridge
HEADED=1 bun e2e/upass-265-live.ts --stage 2 --until 3  --tick 200 --minutes 30   # four orbs, the grid, the well
HEADED=1 bun e2e/upass-265-live.ts --stage 3 --until 5  --tick 200 --minutes 40   # railing, boulder, paladins, temple
HEADED=1 bun e2e/upass-265-live.ts --stage 5 --until 7  --tick 200 --minutes 40   # dwarves, the cat, Kardia's chest
HEADED=1 bun e2e/upass-265-live.ts --stage 7 --until 9  --tick 200 --minutes 55   # the four elements and Iban
HEADED=1 bun e2e/upass-265-live.ts --stage 9 --until 10 --tick 200 --minutes 30   # out with Koftik, back to Lathas
```

Five things govern this harness:

- **A seeded stage has to be a state the quest could be in.** `%ibanmulti` carries
  sub-progress the stage number cannot, and skipping a bit builds a state the game never
  produces. Stage 7 is the sharp one: reaching it means the cat was delivered, and without
  bit 9 Kardia's door answers "Get away... Far away from here!" and takes a quarter of the
  character's hitpoints rather than opening — with the doll's owner sealed on the wrong
  side of it. `ibanmultiFor(stage)` is where that mapping lives.
- **`--stage` writes `%upass` and teleports.** Both varps are `scope=perm` with no
  `transmit`, so the stage is set by cheat and the module reads its own progress out of the
  journal text. Bit 11 — "Lathas has sent you" — is seeded at every stage, because Koftik
  refuses entry to a quest the journal says is under way without it.
- **Past stage 2 there is no bank.** The pass is one-way, so `seedPack` hands an
  inside-the-pass start its kit directly rather than letting the module withdraw one.
- **Some things are handed over once.** `STAGE_PACK` adds what a seeded stage skipped:
  the doll of Iban at stages 7 and 8, because Kardia's chest is the only thing that makes
  one and it will not make a second.
- **Stage 3 cannot be told from stage 4 by the journal**, and 7 cannot be told from 8 —
  each pair prints the same page. The legs are cut at stages the journal can see, which is
  why there is no `--until 4` and no `--until 8`.

Measured at `--tick 200`, per leg:

| Leg | `%upass` | Time |
|---|---|---|
| Lathas, Koftik, the bridge | 0 → 2 | 245s |
| Four orbs, the grid, the well | 2 → 3 | 339s |
| Railing, boulder, paladins, temple doors | 3 → 5 | 421s |
| Dwarves, the cat, Kardia's chest | 5 → 7 | 401s |

### The stall probe

[`e2e/upass-stall-probe.ts`](../../e2e/upass-stall-probe.ts) proves one engine behaviour
away from the quest: that an open quest journal suspends every NORMAL timer, and that the
op-click and the journal press have to land in separate server ticks or `updateMovement`
freezes at the first zone boundary and never resumes.

```sh
HEADED=1 bun e2e/upass-stall-probe.ts --tick 200
```

### The offline nav tools

Neither is part of a run; each answers a map question once so the module does not search
for the answer at runtime.

```sh
bun tools/nav/upass-seams.ts            # which pockets the pass is cut into, and what joins them
bun tools/nav/upass-platform-route.ts   # which collapsed bridge joins which level-1 platform
```

`upass-platform-route.ts` emits the `PLATFORM_LINKS` table as source. It exists because a
runtime search over twenty identical bridges wandered — four crossings in thirty-five
minutes, none of them toward the target.

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
- [Quest harness recipes (Tree–Tribal)](quest-harness-recipes-13.md)
- [Quest harness method](quest-harness-method.md)
- [Quest pitfalls: Underground Pass](../decisions/quest-pitfalls-29.md)
- [Quest pitfalls: Underground Pass, the live legs](../decisions/quest-pitfalls-31.md)
- [Seeding test accounts](seeding-test-accounts.md)
