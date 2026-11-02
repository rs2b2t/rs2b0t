import { expect, test } from 'bun:test';
import { blackknight, decide } from '#/bot/api/ai/quests/defs/blackknight.js';
import { evaluate } from '#/bot/api/ai/quests/EligibilityEvaluator.js';
import { planProvisioning } from '#/bot/api/ai/quests/engine/provisioning.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Loc, Locs } from '#/bot/api/locs/Locs.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { reader, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

const snapshot = (over: Partial<QuestSnapshot> = {}): QuestSnapshot => ({
    journal: 'inProgress', stage: 1, inv: new Map(), worn: new Set(), bank: new Map(), bankKnown: true,
    bankCoins: 1000, noProgress: 0, freeSlots: 28, ...over
});

test('an account with 12 quest points can acquire its fortress disguise instead of being blocked', () => {
    expect(evaluate(blackknight.record, { questPoints: 12, skillLevels: new Map(), completedQuests: new Set() },
        { counts: new Map(), bankKnown: true }, 'notStarted')).toMatchObject({ status: 'READY', reasons: [] });
    const plan = planProvisioning(blackknight.record.items, new Map(), new Map());
    expect(plan.blocked).toEqual([]);
    for (const item of plan.gather) expect(blackknight.gather?.[item.name.toLowerCase()]).toBeFunction();
});

test('the quest point requirement still applies when supplies are acquirable', () => {
    expect(evaluate(blackknight.record, { questPoints: 11, skillLevels: new Map(), completedQuests: new Set() },
        { counts: new Map(), bankKnown: true }, 'notStarted').status).toBe('BLOCKED');
});

test('resuming without disguise checks the bank before shopping', () => {
    expect(decide(snapshot({ bankKnown: false }))).toEqual({ kind: 'scanBank' });
    expect(decide(snapshot({ bank: new Map([['iron chainbody', 1]]) }))).toEqual({ kind: 'withdraw', items: [{ name: 'Iron chainbody', qty: 1 }] });
});

test('missing disguise pieces are bought from stocked shops', () => {
    expect(decide(snapshot())).toMatchObject({ kind: 'buy', item: 'Iron chainbody', qty: 1, shop: { npc: 'Wayne' } });
    expect(decide(snapshot({ worn: new Set(['iron chainbody']) }))).toMatchObject({ kind: 'buy', item: 'Bronze med helm', qty: 1, shop: { npc: 'Peksa' } });
});

test('missing cabbage does not imply the potion was sabotaged', () => {
    const s = snapshot({ stage: 2, worn: new Set(['iron chainbody', 'bronze med helm']) });
    expect(decide(s)).toMatchObject({ kind: 'custom', name: 'pick cabbage' });
    expect(decide({ ...s, bank: new Map([['cabbage', 1]]) })).toEqual({ kind: 'withdraw', items: [{ name: 'Cabbage', id: 1965, qty: 1 }] });
});

test('confirmed sabotage claims the reward even with a spare cabbage and no disguise', () => {
    expect(decide(snapshot({ stage: 3, inv: new Map([['cabbage', 1]]) }))).toMatchObject({ kind: 'talk', stop: { npc: 'Sir Amik Varze' } });
});

test('Draynor Manor cabbage cannot satisfy the ordinary cabbage requirement', () => {
    const s = snapshot({ stage: 2, worn: new Set(['iron chainbody', 'bronze med helm']),
        inv: new Map([['cabbage', 1]]), invIds: new Map([[1967, 1]]), bank: new Map([['cabbage', 2]]), bankIds: new Map([[1967, 2]]) });
    expect(decide(s)).toMatchObject({ kind: 'custom', name: 'pick cabbage' });
    expect(decide({ ...s, bankIds: new Map([[1965, 1], [1967, 1]]) })).toMatchObject({ kind: 'withdraw', items: [{ name: 'Cabbage', id: 1965, qty: 1 }] });
});

test('cabbage gathering walks inside the farm fence before attempting a pick', async () => {
    const walks: WorldTile[] = [];
    const restore = [
        stubProps(Inventory, { items: () => [] }),
        stubProps(Game, { tile: () => new Tile(3053, 3306, 0) }),
        stubProps(reader, { locs: () => [] }),
        stubProps(Traversal, { walkResilient: async tile => { walks.push(tile); return false; } })
    ];
    try {
        const step = blackknight.gather!.cabbage(snapshot(), 1);
        expect(step.kind).toBe('custom');
        if (step.kind === 'custom') await step.run(() => {});
        expect(walks).toHaveLength(1);
        expect(walks[0].x).toBeGreaterThanOrEqual(3044);
        expect(walks[0].x).toBeLessThanOrEqual(3066);
        expect(walks[0].z).toBeLessThanOrEqual(3298);
    } finally { restore.reverse().forEach(fn => fn()); }
});

test('a successful cabbage pick reports progress to the quest watchdog', async () => {
    let picked = false;
    const query = Locs.query();
    const plant = new Loc({ typecode: 0, id: 1161, name: 'Cabbage', tile: new Tile(3053, 3295, 0), ops: ['Pick'], distance: 1 });
    const item = new InvItem({ slot: 0, id: 1965, name: 'Cabbage', count: 1, ops: ['Eat'], comId: 3214 });
    const restore = [
        stubProps(Inventory, { items: () => picked ? [item] : [] }),
        stubProps(Locs, { query: () => query }),
        stubProps(query, { name: () => query, action: () => query, within: () => query, nearest: () => plant }),
        stubProps(plant, { interact: async () => { picked = true; return true; } }),
        stubProps(Traversal, { walkResilient: async () => true }),
        stubProps(Execution, { delayUntil: async check => check() })
    ];
    try {
        const step = blackknight.gather!.cabbage(snapshot(), 1);
        if (step.kind !== 'custom') throw new Error('expected cabbage pickup');
        expect(await step.run(() => {})).toBe(true);
    } finally { restore.reverse().forEach(fn => fn()); }
});
