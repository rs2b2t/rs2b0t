[Manual](../README.md) › [Quests](../QUESTS.md) › Engine

# Quest engine

## Quest state

**State is read from the quest list colour, the opened journal text, and held
items. Never from untransmitted quest varps.**

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

Cook's Assistant is that one function. The snapshot the engine hands it:

```ts
export interface QuestSnapshot {
    journal: QuestStatus;        // notStarted | inProgress | complete | unknown
    inv: Map<string, number>;
    invIds?: ReadonlyMap<number, number>;
    worn: Set<string>;
    wornIds?: ReadonlySet<number>;
    noProgress: number;
    bankCoins: number;
    stage?: number;              // exact journal stage from module.readStage()
    progress?: QuestProgress;    // stage + flags from readProgress()
    bank?: ReadonlyMap<string, number>;
    bankIds?: ReadonlyMap<number, number>;
    bankKnown?: boolean;
    tile?: WorldTile | null;
    freeSlots?: number;
}
```

### What the client can see

The era protocol does **not** stream mid-quest stage numbers or bitfields to
the client for almost every quest. What lands in the bot process:

| Signal | API | On the wire | Granularity |
|---|---|---|---|
| List colour | `Quests.status(name)` | `IF_SETCOLOUR` on the quest-tab name (red / yellow / green) | **three-way only**: not started / in progress / complete |
| Quest points | `Quests.points()` | transmitted varp `qp` (index 101) | total QP |
| Journal body | `Quests.journal(name)` | server builds text and **`if_openmain`** the scroll when you click the name | full stage narrative — **opens the log (the flash)** |
| Inventory / worn | snapshot `inv` / `worn` | normal inv sync | item oracles |
| Game messages | `GameMessages` | chat lines | last-action confirmation (ephemeral) |
| Scene | locs / npcs | usual scene | doors, levers, rocks, NPCs |

Server-side, `send_quest_progress` only recolours the quest-list entry and may
focus the tab. `update_questlist` (login) recomputes colours from **server**
`%varp`s. Neither pushes stage integers or journal lines into a persistent
client field.

Journal text is built only when the player opens a quest: the engine runs
`if_button,questlist:…`, fills `questjournal_scroll` with `if_settext`, and
opens that main modal. There is no side-tab mirror of that body. That is why
`readStage` / `readProgress` flash the log — they are reading the only durable
client view of mid-progress.

### How modules should read progress

Prefer oracles that do not open the log:

1. **Held / worn / bank items** (ids when names collide).
2. **Game messages** after an action (“water wheel starting up”, “already fixed”).
3. **Scene behaviour** (valve locked ⇒ water already running; do not re-pull).
4. **`Quests.status`** for coarse gates (started vs done).
5. **`Quests.journal` via `readStage` / `readProgress`** only when nothing else distinguishes the branch.

When the stage number alone cannot say where a quest is — which of three tribes
are satisfied, which words have been learned, how many monsters remain — a module
implements `readProgress()` instead of `readStage()` and returns named flags
alongside the stage. They arrive on the snapshot as `snap.progress`, so
`decide()` stays a pure function; `hasFlag` and `flagValue` in
[`engine/types.ts`](../../src/bot/api/ai/quests/engine/types.ts) read them.
[`defs/watchtower/journal.ts`](../../src/bot/api/ai/quests/defs/watchtower/journal.ts) is
the worked example. Opening the journal every decide tick is correct but
expensive; cache or re-read only when inventory / coarse status / a confirmed
message changes if you need fewer flashes.

The name maps remain convenient for ordinary items. Use the ID maps for objects
whose display names collide. A `withdraw` item can include `id`, and a `deposit`
step can include `keepIds`; ID keeps are combined with, rather than replacing,
the step's name-based `keep` list.

Two consequences worth stating plainly:

- **`'unknown'` is not `'notStarted'`.** The quest list is not loaded for the
  first moments after login, and treating that as "not started" restarts a
  finished quest. Every module returns `wait` for it.
- Progress *within* a started quest is inferred from its rendered journal stage
  and what the player is carrying. A held quest item is part of the state
  machine's memory, which is why a step that hands an item over and a step that
  acquires it must never both be reachable from the same snapshot.

A held item can also route the bot into a wedge: carrying an item whose delivery is
gated behind something else loops forever at the gate. When an oracle refuses, the
holding must be *undone* — bank it — not retried.

## Provisioning

[`engine/provisioning.ts`](../../src/bot/api/ai/quests/engine/provisioning.ts) assembles what a
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
(`PROVISION_BANK`) — both in [`QuestEngine.ts`](../../src/bot/api/ai/quests/engine/QuestEngine.ts).

## The queue and the watchdog

[`QuestEngine`](../../src/bot/api/ai/quests/engine/QuestEngine.ts) runs quests in order,
tracking `parked`, `parkCounts`, and `parkedReasons`. A quest that stops making
progress is **parked with a reason** and the queue moves on, rather than looping on a
step that cannot advance. `ProgressWatchdog` ([`engine/watchdog.ts`](../../src/bot/api/ai/quests/engine/watchdog.ts))
is what notices.

A step that keeps failing must eventually park. A failing step that never parks is
the worst outcome available: the bot looks busy forever.

## See also

- [Exec primitives](quest-primitives.md)
- [Eligibility](quest-eligibility.md)
- [Why not varps](../decisions/quest-state-not-varps.md)
- [Add a quest](../how-to/add-a-quest.md)
