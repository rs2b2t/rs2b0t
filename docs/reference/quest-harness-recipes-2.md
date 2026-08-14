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
to be killed for it, and seeding one hides whether the farm works. The harness
also gives and equips a Rune scimitar and an Amulet of glory; both are kill
speed, since an imp is level 2 with 8 hitpoints and a -42 attack bonus.

Measured at the default `--tick 300`, on the `--stage 1 --beads 3` recipe:

| Build | Kills/min | One bead |
|---|---|---|
| 40-tile search, ring walk only | 1.0 | not reached in 12 min |
| 50-tile search, 40s respawn hold | 2.65 | 20 min, 43 kills |

The passing run took no parks, held for a respawn 41 times against 5 ring walks,
and skipped 4 imps its reachability probe refused.

Six facts govern this harness:

- **Each bead is 5/128 per imp kill.** All four is a coupon-collector draw over
  four independent 5/128 rolls, so the expectation is ~53 kills with a long tail.
  Read a slow run as variance until the kill counter stops moving.
- **The farm is the Karamja volcano, and its eight spawns ring the crater.** They
  sit at (2832,3170), (2832,3177), (2837,3184), (2841,3163), (2849,3186),
  (2850,3165), (2857,3179) and (2859,3177), on a `respawnrate=100` timer. The
  volcano fills the middle, so no one tile stands within reach of all eight and
  the module walks the ring rather than holding a stand.
- **Two of those eight supply nearly every kill.** A live run logged 9 kills from
  two npc indices, and the census reports `0 in scene` at most ring stops,
  so the imps sit far from most of their spawn tiles. Walking on costs more than
  waiting, which is why the module holds 40 seconds for a respawn before it moves,
  and why the search radius is 50 rather than 40 — the pair together took the farm
  from 1.0 to 2.65 kills a minute.
- **The field stops at x 2810 because Brimhaven starts there.** A run that ranged
  west logged Cap'n Izzy No-Beard and Pirate Jackie the Fruit in the scene.
  Brimhaven is members-only and this quest is free-to-play, so the box must not
  grow westward however far the imps drift.
- **Reaching them crosses the Port Sarim ship, 30 coins each way.** The hop is a
  `specialCrossing` gated on holding the fare. The engine restores its coin float
  on every provisioning tick, so paying that fare made it sail the bot home for
  the 30 coins and repeat, killing nothing; the module sets `ownsInventory` and
  fetches a 200-coin reserve itself, only while standing on the mainland.
- **An imp teleports out of a fight.** `ai_queue2,imp` rolls a 1-in-10 teleport on
  every hit it survives, and `ai_timer,imp` moves it up to 20 tiles every 50–200
  ticks regardless. A fight that ends with the target 20 tiles away is the normal
  case; the module drops the target and re-acquires rather than chasing. Some of
  those landings are on the volcano itself, where every walk answers
  "unreachable" and costs the step its budget, so the module filters candidates
  through a scene reachability probe before it picks one.
- **Mizgog's third quest-start option ends with his first option verbatim.** The
  sarcastic line ends with the string "Give me a quest!" and `pickPreferred`
  matches by substring, so the polite line has to come first in the `prefer` list
  or the bot takes the branch that never sets `%imp`.

Karamja needs no food at 70 stats: the volcano's other residents are seven
scorpions, four snakes and four monkeys, none of which is aggressive to an
account that far above them.

## See also

- [Quest harness recipes (A–F)](quest-harness-recipes.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
