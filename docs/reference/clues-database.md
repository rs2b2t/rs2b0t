[Manual](../README.md) › [Clues](../CLUES.md) › Database

# Clue database

## The clue database

[`data/cluedb.ts`](../../src/bot/api/ai/clues/data/cluedb.ts) is **generated** from the content
pack by [`tools/clues/gen-cluedb.ts`](../../tools/clues/gen-cluedb.ts) — do not edit it
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
[a quest's `decide()`](../reference/quest-engine.md#quest-state) — the solver is restartable and holds
no hidden position.

**Talk steps must chase.** The NPC may patrol a building, so talk steps ride
[`Reach.npcDialog`](../reference/nav-walker.md#the-reach-primitive), which searches the scene and lets the
server walk the player. A leash-camped approach abandons the clue when the NPC laps
away.

## See also

- [Clue step mechanics](clues-mechanics.md)
- [Clue gates](clues-gates.md)
