[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (Haz–Hol)

Per-quest seed and stage commands, with what each recipe has proven.

## Hazeel Cult — stage-scoped harness

[`e2e/hazeel-cult-248-live.ts`](../../e2e/hazeel-cult-248-live.ts). Members content, so
`:8890` only.

```sh
HEADED=1 bun e2e/hazeel-cult-248-live.ts --stage 0 --until 9 --minutes 45 --tick 200  # end to end
HEADED=1 bun e2e/hazeel-cult-248-live.ts --stage 4 --until 6 --minutes 25 --tick 200  # valves, raft, Alomone
HEADED=1 bun e2e/hazeel-cult-248-live.ts --stage 7 --until 9 --minutes 15 --tick 200  # the cupboard
```

| Flag | Default | Purpose |
|---|---|---|
| `--stage N` | 0 | `setvar hazeelcultquest N` plus `setvar hazeelcult_side 0`, then relog so the quest list recolours |
| `--until N` | 9 | stop at this stage; 9 waits for the journal to go green |
| `--tick N` | 300 | server tick in ms; 200 is faster than live |
| `--minutes N` | 60 | wall-clock budget |
| `--stats N` | 70 | every skill, rather than `~maxme` |
| `--food NAME` | Lobster | the AIO Quester's food setting |
| `--no-deploy` | off | skip the build and copy |

`--stage` takes 0, 2, 3, 4, 6, 7 or 9 — the raw `%hazeelcultquest`, which has no 1 and no
8, and whose 5 is the cult side's poison. Every seed pins `%hazeelcult_side` to the
Carnillean side, because each branch past Clivet reads that rather than the stage.

The bank holds coins and lobsters and nothing else. The armour is Alomone's drop, and the
five sewer valves are world state a seed cannot stand in for.

What the legs proved, at `--tick 200` on `:8890` with 70s across the board:

| Leg | Result | What it covered |
|---|---|---|
| 0 → 2 | PASS, 1 min | Ceril's two choices, the journal parse, the mansion doors |
| 2 → 4 | PASS, 1 min | the cave-mouth hop, Clivet's refusal chain, the side lock |
| 4 → 6 | PASS, 2 min | five valves in one leg, the raft, Alomone, the drop |
| 6 → 7 | PASS, 3 min | the ride out of the pocket, the stairs, the hand-over — `carnillean armour 1→0, coins 1000→1005` |
| 7 → 9 | PASS, 2 min | the cupboard, the accusation, `QUEST COMPLETE`, 1 quest point, `coins 1000→3000` |
| 0 → 9 | PASS, 4 min | the uncheated run: 8 steps, no parks, nothing seeded but coins and lobsters |

The full run reports one failed step, and it is the design: refusing Clivet ends below
ground, so the pass that climbs back out to reach the valves returns false and lets the
engine re-decide from the surface.

Two legs cost an extra engine pass each, both for the same reason: `Reach.locOp` walks or
acts, never both in one call. The valve tour and the cupboard each retry inside their own
leg rather than handing the retry back to the engine — see
[Hazeel Cult's pitfalls](../decisions/quest-pitfalls-12.md).

## Holy Grail — stage-scoped harness

[`e2e/holy-grail-246-live.ts`](../../e2e/holy-grail-246-live.ts) drives the quest from a
clean account or from any point inside it. `--stage N` takes the values
`quest_grail.constant` uses — 0, 2, 3, 4, 7, 8, 9 — writes `%grail`, and relogs, because
`update_questlist` only recolours the list at login.

```sh
HEADED=1 bun e2e/holy-grail-246-live.ts --stage 0 --until 10 --minutes 120 --tick 200 # end to end
HEADED=1 bun e2e/holy-grail-246-live.ts --stage 0 --until 3 --minutes 20 --tick 200   # Arthur and Merlin
HEADED=1 bun e2e/holy-grail-246-live.ts --stage 3 --until 4 --minutes 25 --tick 200   # the Entrana strip
HEADED=1 bun e2e/holy-grail-246-live.ts --stage 4 --until 8 --minutes 45 --tick 200   # napkin to Fisher King
HEADED=1 bun e2e/holy-grail-246-live.ts --stage 8 --until 10 --minutes 45 --tick 200  # Percival and the Grail
```

Three things govern this harness:

- **`%arthur` is written on every run.** Merlin's Crystal is the quest's only
  prerequisite, and King Arthur offers the Grail to nobody else. The harness fails loudly
  when the `setvar` does not read back.
- **The bank holds coins, food and a melee kit alone.** Excalibur is bought back from the
  Lady of the Lake for 500 gp, the napkin comes from Galahad and the whistles from Draynor
  Manor, so a pass proves the bot can source all three. Only `--stage 8` and up seed
  the napkin, because neither Galahad branch replaces one past stage 7.
- **`--stats` defaults to 70, not 99.** The Black Knight Titan is level 120 with 142
  hitpoints and 91 defence, and 70 across the board in rune with Lobsters takes him in five
  attacks for 12 damage.

Measured at `--tick 200`, no parks: **26 minutes** from a clean account to quest complete.
Per leg — stage 0 to 3 **5 min**, 3 to 4 **4 min**, 4 to 8 **14 min**, 8 to complete
**8 min**. The thirteen pitfalls the live runs paid for are in
[Holy Grail's pitfalls](../decisions/quest-pitfalls-16.md).

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (Big)](quest-harness-recipes-17.md)
- [Quest harness recipes (Dig)](quest-harness-recipes-15.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (Fre)](quest-harness-recipes-18.md)
- [Quest harness recipes (G)](quest-harness-recipes-11.md)
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
