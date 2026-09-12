import { afterEach, expect, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { QuestEngine, type QuestHost } from '#/bot/api/ai/quests/engine/QuestEngine.js';
import type { QueueRow } from '#/bot/api/ai/quests/engine/queue.js';
import { runemysteries } from '#/bot/api/ai/quests/defs/runemysteries.js';
import { doric } from '#/bot/api/ai/quests/defs/doric.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';

const restores: (() => void)[] = [];
afterEach(() => { for (const restore of restores.splice(0).reverse()) restore(); });

function fixture() {
    const state: {
        ore: number; ok: boolean; gain: boolean; skip: boolean; death: boolean;
        bankOpen: boolean; bankGain: boolean; wait: boolean;
        coins: number; bankCoins: number; bankActions: string[]; picked: Set<string>;
        rows: QueueRow[]; running: string | null; attempts: number;
    } = { ore: 0, ok: false, gain: false, skip: false, death: false, bankOpen: false, bankGain: false, wait: false, rows: [], running: null, attempts: 0,
        coins: 0, bankCoins: 0, bankActions: [], picked: new Set(['runemysteries', 'doric']) };
    const host: QuestHost = {
        log: () => {}, verbose: () => false, foodItem: () => null,
        pickedIds: () => state.picked,
        skipPending: () => state.skip,
        consumeSkip: () => { const skip = state.skip; state.skip = false; return skip; },
        consumeDeath: () => { const death = state.death; state.death = false; return death; },
        noteState: (rows, running) => { state.rows = rows; state.running = running; },
        finish: () => {}
    };
    const spies = [
        spyOn(EventSignal, 'pending').mockReturnValue(false),
        spyOn(reader, 'modals').mockReturnValue({ main: -1, side: -1, chat: -1 }),
        spyOn(Bank, 'isOpen').mockImplementation(() => state.bankOpen),
        spyOn(Bank, 'loaded').mockReturnValue(true),
        spyOn(Bank, 'ready').mockReturnValue(true),
        spyOn(Bank, 'items').mockImplementation(() => state.bankCoins ? [{ id: 995, name: 'Coins', count: state.bankCoins, slot: 0, comId: 5382, ops: [] }] : []),
        spyOn(Banking, 'open').mockImplementation(async () => { state.bankActions.push('open'); state.bankOpen = true; return true; }),
        spyOn(Bank, 'withdrawX').mockImplementation(async (name, qty) => {
            state.bankActions.push(`withdraw:${name}:${qty}`);
            state.bankCoins -= qty;
            state.coins += qty;
            return true;
        }),
        spyOn(Modals, 'close').mockImplementation(async () => {
            state.bankOpen = false;
            if (state.bankGain) state.ore++;
            return true;
        }),
        spyOn(GameMessages, 'recent').mockReturnValue([]),
        spyOn(Equipment, 'items').mockReturnValue([]),
        spyOn(Game, 'tile').mockReturnValue({ x: 3093, z: 3243, level: 0 }),
        spyOn(Inventory, 'used').mockReturnValue(0),
        spyOn(Inventory, 'free').mockReturnValue(28),
        spyOn(Inventory, 'items').mockImplementation(() => [
            ...(state.ore ? [new InvItem({ id: 436, name: 'Copper ore', count: state.ore, slot: 0, comId: 3214, ops: [] })] : []),
            ...(state.coins ? [new InvItem({ id: 995, name: 'Coins', count: state.coins, slot: 1, comId: 3214, ops: [] })] : [])
        ]),
        spyOn(Skills, 'level').mockReturnValue(99),
        spyOn(Skills, 'effective').mockReturnValue(99),
        spyOn(Quests, 'status').mockReturnValue('inProgress'),
        spyOn(Quests, 'points').mockReturnValue(100),
        spyOn(Execution, 'delayTicks').mockResolvedValue(undefined),
        spyOn(Execution, 'delayUntil').mockResolvedValue(true),
        spyOn(doric, 'readStage').mockReturnValue(0),
        spyOn(runemysteries, 'decide').mockImplementation(() => state.wait ? { kind: 'wait', reason: 'fixture wait' } : ({ kind: 'custom', name: 'gather ore', run: async () => {
            state.attempts++;
            if (state.gain) state.ore++;
            state.bankOpen = state.bankGain;
            return state.ok;
        } })),
        spyOn(doric, 'decide').mockReturnValue({ kind: 'custom', name: 'next quest', run: async () => false })
    ];
    restores.push(...spies.map(spy => () => spy.mockRestore()));
    const engine = new QuestEngine(host);
    for (const id of ['runemysteries', 'doric']) {
        engine['provisioned'].add(id);
        engine['deposited'].add(id);
        engine['freshened'].add(id);
    }
    return { engine, state };
}

async function execute(engine: QuestEngine, count: number): Promise<void> {
    for (let i = 0; i < count; i++) await engine.execute();
}

for (const oracle of ['flags', 'stage'] as const) {
    test(`does not park when the eighth false step advances only ${oracle}`, async () => {
        const { engine, state } = fixture();
        let reads = 0;
        const originalProgress = runemysteries.readProgress;
        const originalStage = runemysteries.readStage;
        restores.push(() => {
            runemysteries.readProgress = originalProgress;
            runemysteries.readStage = originalStage;
        });
        if (oracle === 'flags') {
            runemysteries.readProgress = async () => {
                reads++;
                return { stage: 1, flags: new Set(state.attempts >= 8 ? ['scroll-read'] : []) };
            };
        } else {
            runemysteries.readStage = async () => {
                reads++;
                return state.attempts >= 8 ? 2 : 1;
            };
        }
        await execute(engine, 8);
        expect(engine['runningId']).toBe('runemysteries');
        expect(reads).toBe(8);
        await engine.execute();
        expect(state.attempts).toBe(9);
        expect(engine['runningId']).toBe('runemysteries');
        expect(engine['noProgressCount']).toBe(1);
        expect(reads).toBe(9);
    });
}

test('parks eight unchanged failures and runs the next quest', async () => {
    const { engine, state } = fixture();
    await execute(engine, 9);
    expect(state.attempts).toBe(8);
    expect(state.running).toBe('doric');
    expect(state.rows.find(row => row.id === 'runemysteries')?.status).toBe('PARKED');
});

test('confirms an unchanged oracle without executing a ninth failed step', async () => {
    const { engine, state } = fixture();
    const original = runemysteries.readStage;
    restores.push(() => { runemysteries.readStage = original; });
    runemysteries.readStage = async () => 1;
    await execute(engine, 9);
    expect(state.attempts).toBe(8);
    expect(engine['runningId']).toBeNull();
    await engine.execute();
    expect(state.running).toBe('doric');
    expect(state.rows.find(row => row.id === 'runemysteries')?.status).toBe('PARKED');
});

for (const interruption of ['skip', 'death'] as const) {
    test(`${interruption} clears a pending threshold confirmation`, async () => {
        const { engine, state } = fixture();
        const original = runemysteries.readStage;
        restores.push(() => { runemysteries.readStage = original; });
        runemysteries.readStage = async () => 1;
        await execute(engine, 8);
        state[interruption] = true;
        await execute(engine, 7);
        expect(engine['runningId']).toBe(interruption === 'skip' ? 'doric' : 'runemysteries');
    });
}

test('preserves false-returning retries that gain ore', async () => {
    const { engine, state } = fixture();
    state.gain = true;
    await execute(engine, 20);
    expect(state.ore).toBe(20);
    expect(state.running).toBe('runemysteries');
    expect(engine['noProgressCount']).toBe(0);
});

test('success resets the failed-attempt budget', async () => {
    const { engine, state } = fixture();
    await execute(engine, 7);
    state.ok = true;
    await engine.execute();
    state.ok = false;
    await execute(engine, 7);
    expect(engine['runningId']).toBe('runemysteries');
    await execute(engine, 2);
    expect(state.running).toBe('doric');
});

test('switching quests clears the failed-attempt budget', async () => {
    const { engine, state } = fixture();
    await execute(engine, 7);
    state.skip = true;
    await execute(engine, 7);
    expect(engine['runningId']).toBe('doric');
    await execute(engine, 2);
    expect(engine['runningId']).toBeNull();
});

test('observes partial progress after the bank settles and closes', async () => {
    const { engine, state } = fixture();
    state.bankGain = true;
    await execute(engine, 20);
    expect(state.ore).toBe(20);
    expect(engine['noProgressCount']).toBe(0);
    expect(state.running).toBe('runemysteries');
});

test('death recovery clears the failed-attempt budget', async () => {
    const { engine, state } = fixture();
    await execute(engine, 7);
    state.death = true;
    await engine.execute();
    await execute(engine, 7);
    expect(engine['runningId']).toBe('runemysteries');
    await execute(engine, 2);
    expect(state.running).toBe('doric');
});

test('successful unchanged steps retain their original watchdog budget', async () => {
    const { engine, state } = fixture();
    state.ok = true;
    await execute(engine, 8);
    expect(engine['runningId']).toBe('runemysteries');
    await execute(engine, 2);
    expect(state.attempts).toBe(9);
    expect(state.running).toBe('doric');
});

test('wait steps retain their separate fifteen-step budget', async () => {
    const { engine, state } = fixture();
    state.wait = true;
    await execute(engine, 14);
    expect(engine['runningId']).toBe('runemysteries');
    await execute(engine, 2);
    expect(state.running).toBe('doric');
});

for (const scenario of [
    { name: 'unknown bank scans then withdraws banked mustHave supplies', bankKnown: false, bankCoins: 20000, coins: 0, ownsInventory: false, ticks: 3, actions: ['open', 'open', 'withdraw:Coins:1'], attempts: 1, blocked: false, held: 1 },
    { name: 'known empty bank gives up after three parks', bankKnown: true, bankCoins: 0, coins: 0, ownsInventory: false, ticks: 3, actions: [], attempts: 0, blocked: true, held: 0 },
    { name: 'carried supplies need no bank scan', bankKnown: false, bankCoins: 20000, coins: 1, ownsInventory: false, ticks: 1, actions: [], attempts: 1, blocked: false, held: 1 },
    { name: 'ownsInventory keeps control without an unknown-bank scan', bankKnown: false, bankCoins: 20000, coins: 0, ownsInventory: true, ticks: 1, actions: [], attempts: 1, blocked: false, held: 0 }
]) {
    test(scenario.name, async () => {
        const { engine, state } = fixture();
        const { items } = runemysteries.record;
        const { coinFloat, ownsInventory } = runemysteries;
        restores.push(() => { runemysteries.record.items = items; runemysteries.coinFloat = coinFloat; runemysteries.ownsInventory = ownsInventory; });
        runemysteries.record.items = [{ name: 'Coins', qty: 1, kind: 'mustHave' }];
        runemysteries.coinFloat = 0;
        runemysteries.ownsInventory = scenario.ownsInventory;
        state.picked = new Set(['runemysteries']);
        state.bankCoins = scenario.bankCoins;
        state.coins = scenario.coins;
        engine['bankKnown'] = scenario.bankKnown;
        engine['provisioned'].delete('runemysteries');
        await execute(engine, scenario.ticks);
        expect(state.bankActions).toEqual(scenario.actions);
        expect(state.coins).toBe(scenario.held);
        expect(state.attempts).toBe(scenario.attempts);
        expect(engine['blocked'].has('runemysteries')).toBe(scenario.blocked);
    });
}
