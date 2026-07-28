[Manual](README.md) › Clue scrolls

# Clue scrolls

A treasure trail is a chain of clues: each one identifies the next step from the item
in your inventory, and the last yields a reward casket. The solver reads the held
clue, performs the step, and repeats — while staying a good citizen of whatever bot
is hosting it.

Easy and medium trails are implemented, 122 clues in total.

## Contents

- [The clue database](#the-clue-database)
- [Step kinds](#step-kinds)
- [Yielding to the host loop](#yielding-to-the-host-loop)
- [Tool acquisition](#tool-acquisition)
- [Challenges and keys](#challenges-and-keys)
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
}
```

The extra fields are additive: a medium clue that needs a sextant, or a key from a
killed NPC, is the same row shape with more filled in. That is what let medium trails
land without disturbing easy ones.

## Step kinds

| Type | Count | What the solver does |
|---|---|---|
| `search` | 58 | walk to the coordinate and search the named object |
| `dig` | 30 | walk to the coordinate and dig — needs a spade |
| `talk` | 34 | find the named NPC and talk to them |

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

## See also

- [Manual index](README.md)
- [World-walking](NAV.md) — how the solver gets to a coordinate
- [Quests](QUESTS.md) — the same snapshot-driven pattern
- [Scripting API](API.md)
