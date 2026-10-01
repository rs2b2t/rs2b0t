[Manual](../README.md) › [Clues](../CLUES.md) › Step mechanics

# Clue step mechanics

## Tool acquisition

A dig clue without a spade used to abandon the trail. It now **goes and gets one**,
[`AcquireTools.ts`](../../src/bot/api/ai/clues/AcquireTools.ts) walks to the nearer known spawn
and takes it, trying the next spawn if it is not there.

Coordinate clues need the full trio of sextant, watch and chart, obtained through a
four-NPC chain, driven by [`data/toolAcquire.ts`](../../src/bot/api/ai/clues/data/toolAcquire.ts).
`hasAllTrio()` and `hasCoordClueHeld()` gate it, and the chain is deadlined
(`CHAIN_DEADLINE_MS`) so a broken link cannot hang a bot indefinitely.

### Crossing tolls

Missing route tolls are acquired from known shops, including Shantay passes.
See [Crossing tolls](clue-crossing-tolls.md) for diagnosis and purchase recovery.

## Challenges and keys

Some clues do not resolve to a location:

- **Challenge scrolls** ask a question. Answers live in
  [`data/challengeAnswers.ts`](../../src/bot/api/ai/clues/data/challengeAnswers.ts), and numeric
  ones are submitted through the count dialog.
- **Key-from-kill** clues (`keyFrom`) require killing a specific NPC for a key; the anchors are in [`data/killAnchors.ts`](../../src/bot/api/ai/clues/data/killAnchors.ts).
- **Talk anchors** in [`data/talkAnchors.ts`](../../src/bot/api/ai/clues/data/talkAnchors.ts)
  give a starting point for NPCs that move.

## Hard trail preparation

Before starting a hard clue scroll, [`SolveClue.ts`](../../src/bot/api/ai/clues/SolveClue.ts) prepares at the host's initial bank when supplied, or the nearest known bank otherwise. The ready snapshot needs Attack 60, Lost City, an eligible dragon weapon (dagger ids 1231/1215 or longsword id 1305), at least one Superantipoison dose and the host's food target (15 Sharks by default, 12 for JiveDragons). It keeps an eligible equipped weapon or equips the configured eligible weapon when available, remembers the original weapon, takes the best available Superantipoison dose and stocks that many Sharks while reserving required tool and teleport slots. Puzzle clues reserve one free slot without reducing the initial food target and recover their exact banked puzzle box. A confirmed shortage stays blocked until the kit changes or the host explicitly retries.

The generic bank and Entrana rules remain in force: no reachable known bank blocks a hard trail, while an Entrana clue banks restricted gear and records it for restoration. A held casket without a clue scroll bypasses combat-kit preparation, but a hard casket still follows the reward bank flow before opening.

## Dig guardians

30 of the hard coordinate digs carry `param=trail_guardian`. The first dig at such
a coord does not yield the casket, it spawns a wizard beside you, and only a dig
*after* it dies produces the casket ([`spade.rs2`](https://github.com/LostCityRS/Content)):

| Guardian | Level | Style |
|---|---|---|
| Zamorak Wizard | 65 | magic |
| Saradomin Wizard | 108 | magic, plus a poisoning dragon dagger |

The flag the server sets on the kill (`%trail_status` bit 4) is **not transmitted**,
so the bot cannot ask whether it already killed one. It observes instead:
[`Guardian.ts`](../../src/bot/api/ai/clues/Guardian.ts) digs, waits out the spawn window, and
if a wizard appears it turns on Protect from Magic, fights, then digs again, all
inside one step attempt, so a level-108 fight does not consume the retry budget.

The bank prepares 15 Sharks. A guardian can start after food was used during travel, provided at least four Sharks remain. The fight returns `supplies-needed` at three Sharks, preserving food for the retreat. Hard upkeep uses Sharks regardless of the host's food setting and maintains Superantipoison protection. Attacks are reissued every eight ticks because eating cancels the outgoing attack while incoming hits can keep the combat marker active.

An event yield keeps the same `GuardianEncounter` and resumes without another spawn dig. Resume revalidates the original guardian by index, id, range and ownership. A missing, replaced, distant or other-player target returns `guardian-lost`, while a witnessed player death returns `dead`; neither starts a fresh guardian attempt.

The fight waits on the tick through `sustainUntil`, which pumps `Sustain` on every
pass. This is load-bearing: the loop used to park in a single `delayUntil` for the
fight, so upkeep never ran and the bot traded blows with a level-108 mage
without ever eating, dying with a full pack of food. Any wait inside a fight has
to pump, not park.

## Caskets and reward completion

A hard trail is four to six caskets deep and the count lives in a varp the client never receives, so the solver opens every casket where it stands. A scroll coming back is the next leg. No scroll means the trail is done: the server delivers the reward in the same tick, into the pack and onto the tile for whatever does not fit, so the solver closes the reward interface, drops Sharks for room and takes every non-Shark item off its own tile.

## Puzzle boxes

Nine hard talk clues hand over a 5×5 sliding puzzle instead of the next scroll. The
board is the interactable inv component inside the `trail_puzzle` main modal; its 24
pieces are all named "Sliding piece", so they are identified by obj id through the
generated [`data/puzzlePieces.ts`](../../src/bot/api/ai/clues/data/puzzlePieces.ts).

[`puzzleLogic.ts`](../../src/bot/api/ai/clues/puzzleLogic.ts) is pure and does the thinking.
It solves in batches: row 0, column 0, row 1, column 1, then the final 3×3. Each batch runs
a small breadth-first search over the positions of only that
batch's pieces plus the gap. Batching the awkward cases (a row's last two) lets the
search *discover* the rotation that frees them rather than hard-coding an escape
sequence, and every batch's state space stays in the thousands.

The engine shuffles by 101 legal moves from the solved state, so every board handed
to the bot is solvable; the solver is proven against 10,000 such shuffles.

[`PuzzleBox.ts`](../../src/bot/api/ai/clues/PuzzleBox.ts) drives it, and it re-reads and
re-plans after **every single move**. That is not caution for its own sake: the
engine silently drops a click whose slot no longer holds that obj, and a batched
plan wedges the moment one is dropped, the board visibly advanced from a 44-move
state to a 20-move state and then froze, replanning the same 20 moves forever. A
search is a few milliseconds and cannot desynchronise.

The piece's `Move` label may also never reach the client: `ObjType` blanks `op`/`iop`
for members objects when the client's `memServer` flag is false. The driver prefers
the label but falls back to sending op 5 directly, which the server validates against
its own definition rather than against anything the client rendered.

## Prayer between trails

Guardians are fought under Protect from Magic, so the pre-trail bank stop tops
prayer up: if it is below full, the solver picks the reachable altar with the
lowest walking cost from [`Altars.ts`](../../src/bot/api/altar/Altars.ts) and prays.
Lumbridge uses its own church, and unreachable altars are excluded. Low prayer never blocks a trail,
the fight runs without the protection prayer.

## Teleports

Trails cross the map, Varrock to Feldip and Varrock to the level-50 Wilderness, so
clue legs route through the nav teleport catalog: the standard spellbook and the
rubbed jewellery (ring of dueling, games necklace, glory). A teleport is only
admitted once the route is longer than `TELEPORT_MIN_SPAN`, so a walk across a town
stays a walk.

The bank stop keeps the kit out of the deposit and tops the runes up.
[`teleportKit.ts`](../../src/bot/api/ai/clues/teleportKit.ts) derives both lists from the
catalog rather than restating them, so a new destination cannot leave its runes
being banked. Jewellery is kept if the account carries it but never withdrawn,
charges make the names inexact ("Amulet of glory(4)").

The kit is gated on what the account can reach: `teleportKitFor(state)`
keeps a destination only when everything in its `requires` except the runes
themselves is satisfied, magic level, members, quest unlocks. So a magic-1 bot
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
