[Manual](README.md) › Clue scrolls

# Clue scrolls

A treasure trail is a chain of clues: each one identifies the next step from the item
in your inventory, and the last yields a reward casket. The solver reads the held
clue, performs the step, and repeats — while staying a good citizen of whatever bot
is hosting it.

Easy, medium and hard trails are implemented, 186 clues in total.

## Contents

- [The clue database](#the-clue-database)
- [Step kinds](#step-kinds)
- [Yielding to the host loop](#yielding-to-the-host-loop)
- [Tool acquisition](#tool-acquisition)
- [Challenges and keys](#challenges-and-keys)
- [Dig guardians](#dig-guardians)
- [Puzzle boxes](#puzzle-boxes)
- [Prayer between trails](#prayer-between-trails)
- [Teleports](#teleports)
- [Gated clues](#gated-clues)
- [Clues the pack cannot reach](#clues-the-pack-cannot-reach)
- [Tracing a failure](#tracing-a-failure)
- [The audit harness](#the-audit-harness)

## The clue database

[`data/cluedb.ts`](../src/bot/clues/data/cluedb.ts) is **generated** from the content
pack by [`tools/clues/gen-cluedb.ts`](../tools/clues/gen-cluedb.ts) — do not edit it
by hand:

```sh
bun run gen:cluedb                    # regenerate
bun tools/clues/gen-cluedb.ts --check # drift gate
```

Clues are keyed by **object id**, because that is what the solver can observe in the
inventory:

```ts
export interface ClueRow {
    obj: string;
    id: number;
    type: ClueType;                 // 'search' | 'dig' | 'talk'
    coord?: NavPoint;
    casketObj?: string;
    casketId?: number;
    npc?: string;
    needsSextant?: boolean;
    keyFrom?: { npc: string; keyObj: string; keyId: number };
    items?: string[];
    guardian?: string;
    puzzle?: { obj: string; id: number };
}
```

The extra fields are additive: a medium clue that needs a sextant, or a hard clue
whose dig is guarded, is the same row shape with more filled in. That is what let
medium and then hard trails land without disturbing easy ones.

One classification rule is worth stating, because the content pack invites the
wrong one: a `trail_casket` param alone does **not** make a dig. Hard `riddle004`
carries a casket and no coord and is answered by talking to Gerrant, so the
generator requires `casket && coord`.

Two hard clues keep their coordinate in the handler script rather than the obj
params, so the generator passes them in by hand: `map001` (the Gertrude crate at
3309,3503, from `quest_fluffs.rs2`) and `riddle022` (the bookcase at 2702,3409,1,
from `bookcases.rs2`).

## Step kinds

| Type | Count | What the solver does |
|---|---|---|
| `search` | 68 | walk to the coordinate and search the named object |
| `dig` | 71 | walk to the coordinate and dig — needs a spade |
| `talk` | 47 | find the named NPC and talk to them |

A trail step is either a `ClueRow` or the terminal `open-casket`:

```ts
export type ClueStep = ClueRow | { type: 'open-casket'; casketObj: string; casketId: number };
```

`identifyStep` derives the current step from the ids the player is holding, so — like
[a quest's `decide()`](QUESTS.md#quest-state) — the solver is restartable and holds
no hidden position.

**Talk steps must chase.** The NPC may patrol a whole building, so talk steps ride
[`Reach.npcDialog`](NAV.md#the-reach-primitive), which searches the scene and lets the
server walk the player. A leash-camped approach abandons the clue when the NPC laps
away.

## Yielding to the host loop

[`ClueExecutor`](../src/bot/clues/ClueExecutor.ts) usually runs *inside* another bot —
a fighter that solves clues it drops. It must therefore not monopolise the loop:

```ts
async solveHeldClue(log): Promise<'done' | 'abandon' | 'yield'>
```

The third outcome is the important one. Each pass checks whether the host needs
control back and returns `'yield'` rather than continuing:

```ts
if (EventSignal.pending()) {
    trace.note('yield — random event pending');
    return 'yield';
}
```

Without that, a random event fires mid-trail and the solver walks the bot away from
it, ignoring an interaction the server is waiting on. Long-running loops elsewhere
must poll `EventSignal` for the same reason.

`Sustain.run()` is called every pass, so eating and other upkeep continue during a
trail.

## Tool acquisition

A dig clue without a spade used to abandon the trail. It now **goes and gets one** —
[`AcquireTools.ts`](../src/bot/clues/AcquireTools.ts) walks to the nearer known spawn
and takes it, trying the next spawn if it is not there.

Coordinate clues need the full trio — sextant, watch, and chart — obtained through a
four-NPC chain, driven by [`data/toolAcquire.ts`](../src/bot/clues/data/toolAcquire.ts).
`hasAllTrio()` and `hasCoordClueHeld()` gate it, and the whole chain is deadlined
(`CHAIN_DEADLINE_MS`) so a broken link cannot hang a bot indefinitely.

## Challenges and keys

Some clues do not resolve to a location:

- **Challenge scrolls** ask a question. Answers live in
  [`data/challengeAnswers.ts`](../src/bot/clues/data/challengeAnswers.ts), and numeric
  ones are submitted through the count dialog.
- **Key-from-kill** clues (`keyFrom`) require killing a specific NPC for a key; the
  anchors are in [`data/killAnchors.ts`](../src/bot/clues/data/killAnchors.ts).
- **Talk anchors** in [`data/talkAnchors.ts`](../src/bot/clues/data/talkAnchors.ts)
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
[`Guardian.ts`](../src/bot/clues/Guardian.ts) digs, waits out the spawn window, and
if a wizard appears it turns on Protect from Magic, fights, then digs again — all
inside one step attempt, so a level-108 fight does not consume the retry budget.

The solver does **not** withdraw combat gear; it assumes the account arrives
equipped and only takes food from the bank. A guardian the server refuses ("It's
not after you...") belongs to another player, so the fight skips it.

## Puzzle boxes

Nine hard talk clues hand over a 5×5 sliding puzzle instead of the next scroll. The
board is the interactable inv component inside the `trail_puzzle` main modal; its 24
pieces are all named "Sliding piece", so they are identified by obj id through the
generated [`data/puzzlePieces.ts`](../src/bot/clues/data/puzzlePieces.ts).

[`puzzleLogic.ts`](../src/bot/clues/puzzleLogic.ts) is pure and does the thinking.
It solves in batches — row 0, column 0, row 1, column 1, then the final 3×3 —
running a small breadth-first search per batch over the positions of just that
batch's pieces plus the gap. Batching the awkward cases (a row's last two) lets the
search *discover* the rotation that frees them rather than hard-coding an escape
sequence, and every batch's state space stays in the thousands.

The engine shuffles by 101 legal moves from the solved state, so every board handed
to the bot is solvable; the solver is proven against 10,000 such shuffles.

[`PuzzleBox.ts`](../src/bot/clues/PuzzleBox.ts) drives it, and it re-reads and
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
[`Altars.ts`](../src/bot/api/Altars.ts) and prays. Low prayer never blocks a trail —
the fight simply runs without the protection prayer.

## Teleports

Trails cross the map — Varrock to Feldip, Varrock to the level-50 Wilderness — so
clue legs route through the nav-v2 teleport catalog: the standard spellbook and the
rubbed jewellery (ring of dueling, games necklace, glory). A teleport is only
admitted once the route is longer than `TELEPORT_MIN_SPAN`, so a walk across a town
stays a walk.

The bank stop keeps the kit out of the deposit and tops the runes up.
[`teleportKit.ts`](../src/bot/clues/teleportKit.ts) derives both lists from the
catalog rather than restating them, so a new destination cannot leave its runes
being banked. Jewellery is kept if the account carries it but never withdrawn —
charges make the names inexact ("Amulet of glory(4)").

Missing runes are not an error: the router simply walks instead. Turn the whole
thing off with the `useTeleports` setting.

## Gated clues

[`data/clueGates.ts`](../src/bot/clues/data/clueGates.ts) lists clues behind a quest
or region the bot has no route through. The solver reports the reason and abandons
immediately rather than walking until the navigator gives up. Only permanent locks
belong here; a clue that is merely awkward to walk to does not.

## Clues the pack cannot reach

Twenty-two clue destinations sit in components the baked nav graph cannot route to.
These are gaps in the **nav data**, not the clue database: the solver abandons
cleanly, and fixing one is a `transports.json`/`doors.json` change that makes the
clue start working with no solver edit. Each is listed with its diagnosis in
`KNOWN_UNREACHABLE` in [`audit-clues.ts`](../tools/clues/audit-clues.ts), so the
audit stays at zero findings while the list stays honest about what is missing.

The recurring causes are worth knowing, because they affect more than clues:

- **Underground is entered one-way.** Several cellars had a climb-*out* edge and no
  climb-*in*, so the whole area was unreachable. Fixed for the Lumbridge cellar and
  the Varrock manhole; other cellars likely have the same gap.
- **Double doors and gates are not derived.** `derive-doors` emits single
  `WALL_STRAIGHT` doors, so paired gates — the Varrock sewer gates, the West
  Ardougne wall — leave whole regions islanded.
- **Item-gated crossings.** Entering the Kharidian desert southbound consumes a
  Shantay pass (edge is baked; `SolveClue.bankFirst` keeps/withdraws one — #371).
  Offline pack audit still treats desert as closed without virtual WorldState.

## Tracing a failure

[`ClueTrace`](../src/bot/clues/ClueTrace.ts) records every leg of an attempt and dumps
it when a trail is abandoned, so a failure is diagnosable after the fact:

```
[rs2b0t] clue solve failed {"clueId":2713,"name":"easy map001","reason":"no Spade held",
  "lines":[{"m":"acquiring a spade — walking to (2574,3331)"},
           {"m":"no spade at (2574,3331) — trying the next spawn"}, …]}
```

The trace is persisted under `TRACE_STORAGE_KEY`, so it survives the bot that
produced it.

## The audit harness

[`tools/clues/`](../tools/clues/) holds a static auditor that checks every clue in the
database is reachable and well-formed — coordinates on walkable ground, named objects
present, NPCs that exist. It is gated by a test, so a content change that orphans a
clue fails rather than being discovered live at the dig site.

It audits the baked graph, not the server, so it cannot see a barrier that is baked
open and refused in play — McGrubor's Wood audited clean for as long as its locked
gate was an edge. A clue that walks all the way to a door and never gets through is
that failure, and the fix belongs in the pack, not the solver.

## See also

- [Manual index](README.md)
- [World-walking](NAV.md) — how the solver gets to a coordinate
- [Quests](QUESTS.md) — the same snapshot-driven pattern
- [Scripting API](API.md)
