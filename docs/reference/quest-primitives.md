[Manual](../README.md) › [Quests](../QUESTS.md) › Primitives

# Quest exec primitives

[`exec/primitives.ts`](../../src/bot/api/ai/quests/exec/primitives.ts) is the shared vocabulary
that quest steps are built from:

| Primitive | What it handles |
|---|---|
| `walkWithHops(dest, radius, hops, log)` | walking that may need to change level |
| `gotoNpc(stop, hops, log)` | walking to an NPC's anchor within its leash |
| `driveDialog(prefer, log)` | driving a dialogue, choosing by preference list |
| `talkThrough(npc, prefer, log)` | the two combined |
| `talkOp(actions)` / `pickPreferred(options, prefer)` | choosing an op or an option |
| `isUnderground(t)` / `needsHop(here, anchor)` | whether a level change is required |

[`exec/prompts.ts`](../../src/bot/api/ai/quests/exec/prompts.ts) covers the other half — the
world, rather than a conversation:

| Primitive | What it handles |
|---|---|
| `promptLoc(step, log)` | walk to a stand, act on a loc, answer the prompt it raised |
| `useOnLoc(itemId, loc, prefer, expect, log)` | the same for `oplocu`, which no op-based step can express; pass `loc.id` where same-named locs stand together |
| `driveChoice(prefer, log)` | `driveDialog` that abandons rather than guessing |
| `locNear(name, op, within)` / `heldId(id)` / `settleScene()` | the small repeated lookups |

`driveChoice` exists because loc prompts routinely put the refusal first — the
gallows offers *"I don't think so, it might animate and attack me!"* as option one.
Falling through to an unmatched option is worse than stopping.

Dialogue is driven by **preference lists** rather than indices, so option reordering
does not break a quest:

```ts
const COOK: NpcStop = {
    npc: 'Cook',
    anchor: new Tile(3209, 3215, 0),
    leash: 6,
    prefer: ["What's wrong?", "Yes, I'll help you."]
};
```

Server-driven dialogue chains must be *driven to completion* — stopping at the first
continue leaves the conversation half-finished and the quest un-advanced.

`gotoNpc` is leash-limited by design. For an NPC that patrols, that is the wrong
tool: it wanders out of leash and the step is abandoned. Use
[`Reach.npcDialog`](../reference/nav-walker.md#the-reach-primitive), which searches the scene and
lets the server chase.

Opening the dialogue itself goes through [`Reach`](../reference/nav-walker.md#the-reach-primitive), so an
NPC who has wandered behind a shut door is reached rather than abandoned. Being inside
the leash does not mean being reachable: Fred the Farmer paces into his bedroom, the
one interior door re-shuts, and every talk from the anchor is silently dropped.

## See also

- [Quest engine](quest-engine.md)
- [Add a quest](../how-to/add-a-quest.md)
