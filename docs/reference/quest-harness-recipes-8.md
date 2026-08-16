[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (H)

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

## Horror from the Deep — stage-scoped harness

[`e2e/horror-deep-216-live.ts`](../../e2e/horror-deep-216-live.ts), same shape,
also members-only:

```sh
HEADED=1 bun e2e/horror-deep-216-live.ts --stage 0 --until 10 --minutes 210        # end to end
HEADED=1 bun e2e/horror-deep-216-live.ts --stage 4 --until 5 --seedkit --minutes 25 # the strange wall
HEADED=1 bun e2e/horror-deep-216-live.ts --stage 1 --barcrawl 0 \
  --bits horrorbridgeleft,horrorbridgeright --minutes 120                            # the barcrawl
HEADED=1 bun e2e/horror-deep-216-live.ts --stage 0 --until 10 --teleports          # end to end, hops on
```

Four things it does that the Family Crest one does not:

- **Deploys `navworker.js` as well as `botclient.js`.** The transport graph is
  compiled into the nav worker, which is its own entrypoint, so a run that
  deploys only the client walks on the old edges — and the symptom is a flat
  `no path to (…): unreachable` for a route the offline probe likes.
- **Seeds every `deephorror` sub-bit that the stage implies.** The bridge, the
  key and the three lamp repairs are separate bits of one varp, so a bare
  `setvar horrorquest 4` describes a state the quest cannot reach.
- **`--seedkit` hands over the dungeon load** so a run can iterate on the wall or
  the fight without the twenty-minute Varrock round trip. It is a debugging
  shortcut: leave it off for anything that claims the quest works, or the item
  sourcing is never exercised.
- **`--teleports` turns the Global `navTeleports` setting on *and banks law
  runes*.** Both halves are load-bearing. The nav layer only injects a hop the
  live inventory can pay for, and law is the one rune the module will not shop
  for — the Magic Guild and the Mage Arena are the only two shops that stock it
  — so flipping the toggle against a bank without law measures the walking run
  again under a different name.

Measured end to end at `--tick 200`: **68 minutes walking, 45 with `--teleports`**
(16 hops — Camelot ×11, Varrock ×3, Falador, Lumbridge — and no parks).

**Pin `--tick` when you are comparing two runs.** The default is 300ms and the
end-to-end baseline was measured at `--tick 200`; a run at the default is 1.5×
slower per tick, so any wall-clock comparison against it measures the flag. Two
runs at 300ms also wedged on the first step, with Larrissa one tile away
and every `Talk-to` refused in silence — the nav probe rules out geometry (all
the tiles around her are mutually reachable at cost 1) and the engine's own
recovery named a leftover **main** modal, which refuses dialogue like
this. The poll line now prints `MAIN-MODAL=<id>` whenever one is open, so the
next occurrence names the interface instead of having to be inferred.

Two more tools sit alongside it.
[`e2e/horror-journal-dump.ts`](../../e2e/horror-journal-dump.ts) prints the
quest journal verbatim at each stage — `~quest_journal` word-wraps the page and
re-emits the active colour tags on every line it produces, so needles have to be
written against what the client receives, not against the `.rs2`.
[`tools/nav/horror-probe.ts`](../../tools/nav/horror-probe.ts) checks every tile the
module names against a flood from the mainland, and lists the sealed pockets
deliberately so a map change fails loudly instead of quietly.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M–O)](quest-harness-recipes-6.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (S)](quest-harness-recipes-7.md)
- [Quest harness recipes (T)](quest-harness-recipes-9.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
