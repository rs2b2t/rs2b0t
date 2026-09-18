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

A `LadderHop` names `stand` for the loc find radius. Set `walk` when that stand is
behind a door the baked graph cannot pin: the long-walk dest is a reachable hall
tile, then `crossHops` still walks to `stand` before climbing.

[`exec/prompts.ts`](../../src/bot/api/ai/quests/exec/prompts.ts) covers the other half, the
world, rather than a conversation:

| Primitive | What it handles |
|---|---|
| `promptLoc(step, log)` | walk to a stand, act on a loc, answer the prompt it raised |
| `useOnLoc(itemId, loc, prefer, expect, log)` | the same for `oplocu`, which no op-based step can express; pass `loc.id` where same-named locs stand together |
| `driveChoice(prefer, log)` | `driveDialog` that abandons rather than guessing |
| `locNear(name, op, within)` / `heldId(id)` / `settleScene()` | the small repeated lookups |

`driveChoice` exists because loc prompts routinely put the refusal first, the
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

Server-driven dialogue chains must be *driven to completion*, stopping at the first
continue leaves the conversation half-finished and the quest un-advanced.

`gotoNpc` is leash-limited by design. For an NPC that patrols, that is the wrong
tool: it wanders out of leash and the step is abandoned. Use
[`Reach.npcDialog`](../reference/nav-walker.md#the-reach-primitive), which searches the scene and
lets the server chase.

Opening the dialogue itself goes through [`Reach`](../reference/nav-walker.md#the-reach-primitive), so an
NPC who has wandered behind a shut door is reached rather than abandoned. Being inside
the leash does not mean being reachable: Fred the Farmer paces into his bedroom, the
one interior door re-shuts, and every talk from the anchor is silently dropped.

## Driving an interface a quest opens

A quest that opens its own panel reads it through
[`reader.modalButtons(root)`](../../src/bot/adapter/ClientAdapter.ts), which reports every
button under a modal root with its caption, the word its menu offers, and whether a layer
above it is hiding it. `if_sethide` is how a script arms a button, so `hidden === false` is
the only honest answer to "will this press be seen". Two things go wrong otherwise, both
without a message:

- The engine drops an `if_button` on a component that carries no `buttontype`, and drops
  one that arrives while the script is still inside a `p_delay`.
- The client sends RESUME_PAUSEBUTTON once per interface open and refuses every later press,
  so a `buttontype=pause` button pressed early is the only press that round had.

Death Plateau's dice panel hit both. It pressed Continue on the first tick after rolling,
because *"Continue..."* is a static caption the panel carries from the moment it opens, and
every round then ended by force-closing the modal.

The root id in `pack/interface.pack` is the server's own and is what arrives in
`reader.modals().main`, but a root's children are not numbered from `root + 1` and counting
entries in the `.if` file gives the wrong number. Find a child by what it says and how it
answers, never by an id counted off the pack.

## See also

- [Quest engine](quest-engine.md)
- [Add a quest](../how-to/add-a-quest.md)
