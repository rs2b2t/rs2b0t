[Manual](../README.md) › [Clues](../CLUES.md) › Step mechanics

# Clue step mechanics

## Tool acquisition

A dig clue without a spade used to abandon the trail. It now **goes and gets one** —
[`AcquireTools.ts`](../../src/bot/api/ai/clues/AcquireTools.ts) walks to the nearer known spawn
and takes it, trying the next spawn if it is not there.

Coordinate clues need the full trio — sextant, watch, and chart — obtained through a
four-NPC chain, driven by [`data/toolAcquire.ts`](../../src/bot/api/ai/clues/data/toolAcquire.ts).
`hasAllTrio()` and `hasCoordClueHeld()` gate it, and the chain is deadlined
(`CHAIN_DEADLINE_MS`) so a broken link cannot hang a bot indefinitely.

### Crossing tolls

A toll the bot cannot pay does not read as "too poor" — A* prunes the crossing, so
the region behind it leaves the graph and the leg reports a bare `unreachable`.
The Kharidian desert is the sharp case: it has one baked entrance and it
eats a Shantay pass, so a bot without one is told the desert does not exist.

[`gateItems.ts`](../../src/bot/event/webwalk/gateItems.ts) tells the two apart. On an
`unreachable` verdict the walker re-probes the same route with every crossing item
virtualized; if the route appears, the blocker is a shopping list and
`WalkExecutor.lastMissingGateItems` names it. `walkLeg` in the executor then buys
the toll (`GATE_ITEM_SHOPS` — Shantay stocks his own pass for 5gp, north of his
own gate) and walks again, once per item per trail. A route that stays unreachable
with the full kit is a genuine nav-data gap and is reported as one.

The same lookup bug hid this from the bank planner: crossings are keyed at the
approach stand, but `itemsRequiredByWaypoints` matched on the loc tile alone. The
Shantay stand is (3304,3118) while its loc is (3302,3116), so the toll was
invisible and no pass was ever withdrawn. It now resolves through
`specialCrossingForTransport`, the same way the executor does.

## Challenges and keys

Some clues do not resolve to a location:

- **Challenge scrolls** ask a question. Answers live in
  [`data/challengeAnswers.ts`](../../src/bot/api/ai/clues/data/challengeAnswers.ts), and numeric
  ones are submitted through the count dialog.
- **Key-from-kill** clues (`keyFrom`) require killing a specific NPC for a key; the anchors are in [`data/killAnchors.ts`](../../src/bot/api/ai/clues/data/killAnchors.ts).
- **Talk anchors** in [`data/talkAnchors.ts`](../../src/bot/api/ai/clues/data/talkAnchors.ts)
  give a starting point for NPCs that move.

## Dig guardians

30 of the hard coordinate digs carry `param=trail_guardian`. The first dig at such
a coord does not yield the casket — it spawns a wizard beside you, and only a dig
*after* it dies produces the casket ([`spade.rs2`](https://github.com/LostCityRS/Content)):

| Guardian | Level | Style |
|---|---|---|
| Zamorak Wizard | 65 | magic |
| Saradomin Wizard | 108 | magic, plus a poisoning dragon dagger |

The flag the server sets on the kill (`%trail_status` bit 4) is **not transmitted**,
so the bot cannot ask whether it already killed one. It observes instead:
[`Guardian.ts`](../../src/bot/api/ai/clues/Guardian.ts) digs, waits out the spawn window, and
if a wizard appears it turns on Protect from Magic, fights, then digs again — all
inside one step attempt, so a level-108 fight does not consume the retry budget.

The solver does **not** withdraw combat gear; it assumes the account arrives
equipped and only takes food from the bank. A guardian the server refuses ("It's
not after you...") belongs to another player, so the fight skips it.

The fight waits on the tick through `sustainUntil`, which pumps `Sustain` on every
pass. This is load-bearing: the loop used to park in a single `delayUntil` for the
fight, so upkeep never ran and the bot traded blows with a level-108 mage
without ever eating — dying with a full pack of food. Any wait inside a fight has
to pump, not park.

## Puzzle boxes

Nine hard talk clues hand over a 5×5 sliding puzzle instead of the next scroll. The
board is the interactable inv component inside the `trail_puzzle` main modal; its 24
pieces are all named "Sliding piece", so they are identified by obj id through the
generated [`data/puzzlePieces.ts`](../../src/bot/api/ai/clues/data/puzzlePieces.ts).

[`puzzleLogic.ts`](../../src/bot/api/ai/clues/puzzleLogic.ts) is pure and does the thinking.
It solves in batches — row 0, column 0, row 1, column 1, then the final 3×3 —
running a small breadth-first search per batch over the positions of only that
batch's pieces plus the gap. Batching the awkward cases (a row's last two) lets the
search *discover* the rotation that frees them rather than hard-coding an escape
sequence, and every batch's state space stays in the thousands.

The engine shuffles by 101 legal moves from the solved state, so every board handed
to the bot is solvable; the solver is proven against 10,000 such shuffles.

[`PuzzleBox.ts`](../../src/bot/api/ai/clues/PuzzleBox.ts) drives it, and it re-reads and
re-plans after **every single move**. That is not caution for its own sake: the
engine silently drops a click whose slot no longer holds that obj, and a batched
plan wedges the moment one is dropped — the board visibly advanced from a 44-move
state to a 20-move state and then froze, replanning the same 20 moves forever. A
search is a few milliseconds and cannot desynchronise.

The piece's `Move` label may also never reach the client: `ObjType` blanks `op`/`iop`
for members objects when the client's `memServer` flag is false. The driver prefers
the label but falls back to sending op 5 directly, which the server validates against
its own definition rather than against anything the client rendered.

## Prayer between trails

Guardians are fought under Protect from Magic, so the pre-trail bank stop tops
prayer up: if it is below full, the solver walks to the nearest altar from
[`Altars.ts`](../../src/bot/api/altar/Altars.ts) and prays. Low prayer never blocks a trail —
the fight runs without the protection prayer.

## Teleports

Trails cross the map — Varrock to Feldip, Varrock to the level-50 Wilderness — so
clue legs route through the nav teleport catalog: the standard spellbook and the
rubbed jewellery (ring of dueling, games necklace, glory). A teleport is only
admitted once the route is longer than `TELEPORT_MIN_SPAN`, so a walk across a town
stays a walk.

The bank stop keeps the kit out of the deposit and tops the runes up.
[`teleportKit.ts`](../../src/bot/api/ai/clues/teleportKit.ts) derives both lists from the
catalog rather than restating them, so a new destination cannot leave its runes
being banked. Jewellery is kept if the account carries it but never withdrawn —
charges make the names inexact ("Amulet of glory(4)").

The kit is gated on what the account can reach: `teleportKitFor(state)`
keeps a destination only when everything in its `requires` except the runes
themselves is satisfied — magic level, members, quest unlocks. So a magic-1 bot
carries no runes at all instead of five dead slots, and the per-cast counts
narrow with the spellbook (Camelot's 5 air runes do not size the load until
Camelot is castable). The router already refused those spells; the bank stop was
provisioning for them anyway. Unusable runes are no longer kit, so the deposit
sweeps them, and the pack log names the destinations it can cast.

Missing runes are not an error: the router walks instead. The `useTeleports` setting
turns teleports off.

## See also

- [Clue database](clues-database.md)
- [Clue gates](clues-gates.md)
