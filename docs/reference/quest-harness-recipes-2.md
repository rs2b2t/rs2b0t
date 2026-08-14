[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (G–Z)

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

## Imp Catcher — stage-scoped harness

[`e2e/imp-catcher-230-live.ts`](../../e2e/imp-catcher-230-live.ts) drives the
quest from a clean account, or one leg of it. `--stage N` sets `%imp` and relogs;
`--beads N` seeds the first N of black, red, white, yellow into the bank so the
withdraw and hand-in legs are reachable without the farm.

```sh
HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 1 --beads 4 --minutes 15   # hand-in only
HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 0 --beads 4 --minutes 15   # start + hand-in
HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 1 --beads 3 --minutes 30   # one bead, farmed
HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 0 --beads 0 --minutes 120  # end to end
```

The bank holds coins, food and the seeded beads. Every unseeded bead has an imp
to be killed for it, and seeding one hides whether the farm works.

Measured at the default `--tick 300`:

| Recipe | Wall clock | Imps killed |
|---|---|---|
| `--stage 1 --beads 4` | 2 min | 0 |
| `--stage 0 --beads 4` | 2 min | 0 |
| `--stage 1 --beads 3` | 7 min, 14 min | 22, 52 |
| `--stage 0 --beads 0` | 16 min | 54 |

The one-bead recipe ran twice and its two kill counts are 22 and 52, against an
expectation of 26 — that spread is the drop rate, not a regression. Neither run
parked; the end-to-end run held for a respawn 33 times and lost four imps to a
mid-fight teleport.

Four facts govern this harness:

- **Each bead is 5/128 per imp kill.** All four is a coupon-collector draw over
  four independent 5/128 rolls, so the expectation is ~53 kills with a long tail.
  Read a slow run as variance until the kill counter stops moving.
- **The Falador south gate has three imp spawns**, at (3009,3307), (3011,3314)
  and (3015,3314), on a `respawnrate=100` timer. The farm is respawn-bound, so
  `--tick` moves the wall clock almost linearly.
- **An imp teleports out of a fight.** `ai_queue2,imp` rolls a 1-in-10 teleport on
  every hit it survives, and `ai_timer,imp` moves it up to 20 tiles every 50–200
  ticks regardless. A fight that ends with the target 20 tiles away is the normal
  case; the module drops the target and re-acquires rather than chasing. Some of
  those landings are inside the Falador wall, where every walk answers
  "unreachable" and costs the step 18 seconds, so the module filters candidates
  through a scene reachability probe before it picks one.
- **Mizgog's third quest-start option ends with his first option verbatim.** The
  sarcastic line ends with the string "Give me a quest!" and `pickPreferred`
  matches by substring, so the polite line has to come first in the `prefer` list
  or the bot takes the branch that never sets `%imp`.

Combat is not worth a floor probe: an imp is level 2 with 8 hitpoints and a -42
attack bonus, so an unarmed account kills one in two hits and takes no damage
worth eating for.

## See also

- [Quest harness recipes (A–F)](quest-harness-recipes.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
