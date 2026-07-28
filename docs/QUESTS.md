[Manual](README.md) › Quests

# Quests

A quest is **data**, not a script. Each one is a `QuestModule` whose `decide()`
inspects a snapshot of the world and returns the single next step; a shared engine
executes that step and asks again. Adding a quest means adding a module, not writing
another bot.

## Contents

- [The shape of a quest](#the-shape-of-a-quest)
- [Quest state](#quest-state)
- [Exec primitives](#exec-primitives)
- [Provisioning](#provisioning)
- [The queue and the watchdog](#the-queue-and-the-watchdog)
- [Eligibility](#eligibility)
- [Adding a quest](#adding-a-quest)

## The shape of a quest

Three directories, three jobs:

| Directory | Job |
|---|---|
| [`src/bot/quests/engine/`](../src/bot/quests/engine/) | runs quests: queue, snapshot, provisioning, watchdog |
| [`src/bot/quests/defs/`](../src/bot/quests/defs/) | one module per quest — the decisions |
| [`src/bot/quests/exec/`](../src/bot/quests/exec/) | the primitives a step is built from |

A module declares what it needs and how to decide:

```ts
export interface QuestModule {
    record: QuestRecord;                       // id, name, QP, requirements, items
    hops?: LadderHop[];                        // level changes this quest needs
    bank?: Tile;
    grind?: string[];
    food?: number;
    gather?: Record<string, (snap, need) => QuestStep>;
    tools?: string[];
    decide(snap: QuestSnapshot): QuestStep;
}
```

`decide()` returns one of a closed set of steps — `talk`, `grabGround`, `pickLoc`,
`interactLoc`, `useOn`, `equip`, `withdraw`, `deposit`, `mineRock`, `buy`, `custom`,
`wait`, `done` (see [`engine/types.ts`](../src/bot/quests/engine/types.ts)) — and
[`executeStep`](../src/bot/quests/exec/steps.ts) knows how to perform each kind.

Because `decide()` is a pure function of the snapshot, a quest is restartable from
any point. Kill the bot mid-quest, start it again, and it re-derives where it is.

## Quest state

**State is read from the quest journal and from held items. Never from varps.**

```ts
export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete')    { return { kind: 'done' }; }
    if (snap.journal === 'unknown')     { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted')  { return { kind: 'talk', stop: COOK }; }
    if (!snap.inv.has('egg'))           { return gatherEgg(); }
    if (!snap.inv.has('bucket of milk')) { return gatherMilk(snap); }
    if (!snap.inv.has('pot of flour'))  { return gatherFlour(snap); }
    return { kind: 'talk', stop: COOK };
}
```

That is the whole of Cook's Assistant. The snapshot the engine hands it:

```ts
export interface QuestSnapshot {
    journal: QuestStatus;        // notStarted | started | complete | unknown
    inv: Map<string, number>;
    worn: Set<string>;
    noProgress: number;
    bankCoins: number;
}
```

Two consequences worth stating plainly:

- **`'unknown'` is not `'notStarted'`.** The journal is not loaded for the first
  moments after login, and treating that as "not started" restarts a finished quest.
  Every module returns `wait` for it.
- Progress *within* a started quest is inferred from what the player is carrying.
  A held quest item is the state machine's memory, which is why a step that hands an
  item over and a step that acquires it must never both be reachable from the same
  snapshot.

A held item can also route the bot into a wedge: carrying an item whose delivery is
gated behind something else loops forever at the gate. When an oracle refuses, the
holding must be *undone* — bank it — not retried.

## Exec primitives

[`exec/primitives.ts`](../src/bot/quests/exec/primitives.ts) is the shared vocabulary
that quest steps are built from:

| Primitive | What it handles |
|---|---|
| `walkWithHops(dest, radius, hops, log)` | walking that may need to change level |
| `gotoNpc(stop, hops, log)` | walking to an NPC's anchor within its leash |
| `driveDialog(prefer, log)` | driving a dialogue, choosing by preference list |
| `talkThrough(npc, prefer, log)` | the two combined |
| `talkOp(actions)` / `pickPreferred(options, prefer)` | choosing an op or an option |
| `isUnderground(t)` / `needsHop(here, anchor)` | whether a level change is required |

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
[`Reach.npcDialog`](NAV.md#the-reach-primitive), which searches the whole scene and
lets the server chase.

## Provisioning

[`engine/provisioning.ts`](../src/bot/quests/engine/provisioning.ts) assembles what a
quest needs **before** it starts, bank-first:

| Function | Job |
|---|---|
| `planProvisioning(...)` | what to withdraw, given the record's items and what is held |
| `depositPlan(inv, keep)` | what to drop before starting |
| `gpShort(snap, estGp)` | how much coin is missing for a purchase |
| `floatWithdraw(...)`, `coinFloatWithdraw(...)` | withdrawing with headroom |

Two rules that are easy to get wrong:

- **A quest that buys anything must keep `coins` in its `tools`.** Omit it and the
  provisioner does not carry coin, so every purchase step parks with "need gp".
- Quest-internal consumables are not `record.items`. The record lists what the quest
  *requires*; things consumed along the way are the module's own business.

The engine carries a coin float (`COIN_FLOAT`) and provisions from a fixed bank
(`PROVISION_BANK`) — both in [`QuestEngine.ts`](../src/bot/quests/engine/QuestEngine.ts).

## The queue and the watchdog

[`QuestEngine`](../src/bot/quests/engine/QuestEngine.ts) runs quests in order,
tracking `parked`, `parkCounts`, and `parkedReasons`. A quest that stops making
progress is **parked with a reason** and the queue moves on, rather than looping on a
step that cannot advance. `ProgressWatchdog` ([`engine/watchdog.ts`](../src/bot/quests/engine/watchdog.ts))
is what notices.

A step that keeps failing must eventually park. A failing step that never parks is
the worst outcome available: the bot looks busy forever.

## Eligibility

[`EligibilityEvaluator`](../src/bot/quests/EligibilityEvaluator.ts) reports each quest
as `DONE`, `READY`, or `BLOCKED` **with reasons**, combining
[`RequirementChecker`](../src/bot/quests/RequirementChecker.ts) (quest points, skill
levels, prerequisite quests) and [`ItemChecker`](../src/bot/quests/ItemChecker.ts)
(inventory and bank).

Items are `mustHave` or `acquirable` — the difference between "you cannot start this"
and "the bot will go and get it". `QuestDashboard` renders the result; `AIOQuester`
consumes it to choose what to run.

## Adding a quest

1. Add the record to [`data/quests.ts`](../src/bot/quests/data/quests.ts) — id, name,
   quest points, requirements, items.
2. Write `defs/<quest>.ts`: anchors as `Tile` constants, `NpcStop`s with `prefer`
   lists, `gather` functions for anything the bot must fetch, and a `decide()` that
   reads only the snapshot.
3. Register it in [`defs/index.ts`](../src/bot/quests/defs/index.ts).
4. Add a unit test for `decide()` — it is a pure function, so every branch is
   testable without a client. See [`test/quests/`](../test/quests/).

Start from [`defs/cooksassistant.ts`](../src/bot/quests/defs/cooksassistant.ts) for
the simple shape, or [`defs/priestperil.ts`](../src/bot/quests/defs/priestperil.ts)
for one with level changes, gated doors, and a long item chain.

## See also

- [Manual index](README.md)
- [World-walking](NAV.md) — how quest steps get anywhere
- [Clue scrolls](CLUES.md) — the same snapshot-driven pattern, applied to trails
- [Scripting API](API.md) — the surface quest modules are written against
