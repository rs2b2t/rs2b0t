[Manual](../README.md) › [Quests](../QUESTS.md) › Module shape

# The shape of a quest module

| Directory | Job |
|---|---|
| [`src/bot/api/ai/quests/engine/`](../../src/bot/api/ai/quests/engine/) | runs quests: queue, snapshot, provisioning, watchdog |
| [`src/bot/api/ai/quests/defs/`](../../src/bot/api/ai/quests/defs/) | one module per quest — the decisions |
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
    readStage?: () => number | undefined | Promise<number | undefined>;
    sustain?: QuestSustain;                   // quest-specific food and eat threshold
    warnReadiness?: () => string | null;      // soft: untested combat / power level
    decide(snap: QuestSnapshot): QuestStep;
}
```

`decide()` returns one of a closed set of steps — `talk`, `grabGround`, `pickLoc`,
`interactLoc`, `useOn`, `equip`, `withdraw`, `deposit`, `mineRock`, `buy`, `custom`,
`wait`, `done` (see [`engine/types.ts`](../../src/bot/api/ai/quests/engine/types.ts)) — and
[`executeStep`](../../src/bot/api/ai/quests/exec/steps.ts) knows how to perform each kind.

Because `decide()` is a pure function of the snapshot, a quest is restartable from
any point. Kill the bot mid-quest, start it again, and it re-derives where it is.

## See also

- [Quest engine](quest-engine.md)
- [Add a quest](../how-to/add-a-quest.md)
