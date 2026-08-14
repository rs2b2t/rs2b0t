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
withdraw and hand-in legs are reachable without the farm; `--start ardougne`
drops the bot at the bank beside the imps instead of walking the 512 from
Draynor.

```sh
HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 1 --beads 4 --minutes 15                  # hand-in only
HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 1 --beads 3 --start ardougne --minutes 30 # one bead, farmed
HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 0 --beads 0 --minutes 90                  # end to end
```

The bank holds coins, food and the seeded beads. Every unseeded bead has an imp
to be killed for it, and seeding one hides whether the farm works. The harness
also gives and equips a Rune scimitar and an Amulet of glory; both are kill
speed, since an imp is level 2 with 8 hitpoints and a -42 attack bonus.

Measured at the default `--tick 300`:

| Recipe | Wall clock | Kills | Kills/min |
|---|---|---|---|
| `--stage 1 --beads 3 --start ardougne` | 14 min | 65 | 6.4 |
| `--stage 0 --beads 0` | 15 min | 70 | 6.2 |

Both runs took no parks, and both drew a long tail on the 5/128 roll — 65 kills
against a mean of 26 for one bead, 70 against 53 for four. The end-to-end run
made one `withdraw Coins×200`, killed imps from all nine spawns, and visited the
Wizards' Tower once.

Six facts govern this harness:

- **Each bead is 5/128 per imp kill.** All four is a coupon-collector draw over
  four independent 5/128 rolls, so the expectation is ~53 kills with a long tail.
  Read a slow run as variance until the kill counter stops moving.
- **The farm is the scrub south of Ardougne, and its nine spawns fit a 14x41
  strip.** They sit at (2632,3202), (2625,3203), (2639,3206), (2630,3210),
  (2625,3217), (2633,3222), (2639,3230), (2629,3233) and (2633,3243). One stand
  at (2632,3222) is within 21 tiles of every one of them, inside the 50-tile
  search, so the bot camps respawns rather than walking a circuit. The two
  clusters tried before it were worse for shape rather than for count: three
  Falador spawns managed ~3 kills a minute and eight Karamja spawns ringing a
  volcano managed 2.65, because the crater in the middle meant no tile saw more
  than an arc of them and only two of the eight were ever in range.
- **The floor at z 3180 keeps the next cluster out.** Nine more imps sit south
  at z 3116–3134, close enough to pull the bot 70 tiles off this strip.
- **The hand-in is 625 of walking away, across two ship fares.** The bot farms
  before it ever speaks to Mizgog — the imp drop table is unconditional — so the
  tower is one trip rather than one out and one back.
- **The engine restores its coin float on every provisioning tick.** Paying a
  30-coin fare made it walk the bot back for the 30 coins it had spent, and
  repeat, killing nothing. The module sets `ownsInventory` and fetches a
  200-coin reserve itself, never while standing on the Karamja leg of the
  crossing, which has no bank.
- **Mizgog's third quest-start option ends with his first option verbatim.** The
  sarcastic line ends with the string "Give me a quest!" and `pickPreferred`
  matches by substring, so the polite line has to come first in the `prefer` list
  or the bot takes the branch that never sets `%imp`.

South Ardougne is members ground, which costs nothing here: the world runs
`members: true` with `autoSubscribeMembers`, and the quest itself is
free-to-play wherever it is farmed.

## See also

- [Quest harness recipes (A–F)](quest-harness-recipes.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
