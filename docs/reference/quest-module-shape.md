[Manual](../README.md) › [Quests](../QUESTS.md) › Module shape

# The shape of a quest module

| Directory | Job |
|---|---|
| [`src/bot/api/ai/quests/engine/`](../../src/bot/api/ai/quests/engine/) | runs quests: queue, snapshot, provisioning, watchdog |
| [`src/bot/api/ai/quests/defs/`](../../src/bot/api/ai/quests/defs/) | one module per quest, the decisions |
| [`src/bot/api/ai/quests/exec/`](../../src/bot/api/ai/quests/exec/) | the primitives a step is built from |

A module declares what it needs and how to decide:

```ts
export interface QuestSustain {
    foods: readonly string[];
    eatBelowHp: number;
}

export interface QuestModule {
    record: QuestRecord;                       // id, name, QP, requirements, items
    hops?: LadderHop[];                        // level changes this quest needs
    bank?: Tile;
    grind?: string[];
    food?: number;
    gather?: Record<string, (snap, need) => QuestStep>;
    tools?: string[];
    ownsInventory?: boolean;                  // module manages every loadout itself
    recover?: (tile: WorldTile) => QuestStep | null;
    resumeAt?: (tile: WorldTile) => boolean;
    readStage?: () => number | undefined | Promise<number | undefined>;
    sustain?: QuestSustain;                   // quest-specific food and eat threshold
    warnReadiness?: () => string | null;      // soft: untested combat / power level
    decide(snap: QuestSnapshot): QuestStep;
}
```

`decide()` returns one of a closed set of steps, `talk`, `grabGround`, `pickLoc`,
`interactLoc`, `useOn`, `equip`, `withdraw`, `deposit`, `mineRock`, `buy`, `custom`,
`wait`, `done` (see [`engine/types.ts`](../../src/bot/api/ai/quests/engine/types.ts)), and
[`executeStep`](../../src/bot/api/ai/quests/exec/steps.ts) knows how to perform each kind.

Because `decide()` is a pure function of the snapshot, a quest is restartable from
any point. Kill the bot mid-quest, start it again, and it re-derives where it is.

`recover()` handles location-specific exits before queue selection, including
completed or unselected quests. `resumeAt()` identifies a quest's sealed areas:
the engine resumes that in-progress quest before the ordinary queue order and
leaves inventory preparation to its steps while inside. Generic preparation
resumes outside. If the area owner is blocked, skipped, or unselected, the engine
stops with that reason instead of attempting another quest's bank trip.

## See also

- [Quest engine](quest-engine.md)
- [Add a quest](../how-to/add-a-quest.md)

## Auto-retaliate

Before executing a quest step, the engine enables auto-retaliate unless the
module's `autoRetaliate` policy overrides it. The policy can be a boolean or a
function of the current snapshot. Safespot fights, stealth routes, mining under
attack, and escape routes declare their exceptions. Lost City enables retaliation
for zombie axe collection and disables it for the Tree Spirit; Watchtower restores
retaliation after its dragon-bone hunt so Gorad's dialogue-triggered fight works.

The engine waits up to five game ticks for a changed setting to be confirmed.
A rejected or unconfirmed change fails the step before its action runs. Custom
steps retain control of retaliation while they execute, including during sustain;
the policy is reapplied at the next step boundary.
