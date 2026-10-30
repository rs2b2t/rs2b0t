import { afterEach, expect, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { QuestEngine, type QuestHost } from '#/bot/api/ai/quests/engine/QuestEngine.js';
import type { QueueRow } from '#/bot/api/ai/quests/engine/queue.js';
import { runemysteries } from '#/bot/api/ai/quests/defs/runemysteries.js';
import { doric } from '#/bot/api/ai/quests/defs/doric.js';
import { goblinMailGatherStep } from '#/bot/api/ai/quests/defs/goblindiplomacy.js';
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
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Input } from '#/bot/input/Input.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';

const restores: (() => void)[] = [];
afterEach(() => { for (const restore of restores.splice(0).reverse()) restore(); });

function fixture() {
    const originalStage = runemysteries.readStage;
    restores.push(() => { runemysteries.readStage = originalStage; });
    runemysteries.readStage = undefined;
    const state: {
        ore: number; ok: boolean; gain: boolean; skip: boolean; death: boolean;
        combat: boolean; xp: number; now: number;
        bankOpen: boolean; bankGain: boolean; wait: boolean;
        coins: number; bankCoins: number; bankActions: string[]; picked: Set<string>;
        rows: QueueRow[]; running: string | null; attempts: number;
    } = { ore: 0, ok: false, gain: false, skip: false, death: false, bankOpen: false, bankGain: false, wait: false, rows: [], running: null, attempts: 0,
        coins: 0, bankCoins: 0, bankActions: [], picked: new Set(['runemysteries', 'doric']), combat: false, xp: 0, now: 100_000 };
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
        spyOn(Date, 'now').mockImplementation(() => state.now),
        spyOn(Game, 'inCombat').mockImplementation(() => state.combat),
        spyOn(Skills, 'xp').mockImplementation(() => state.xp),
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
    return { engine, state, host };
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
    expect(state.rows.find(row => row.id === 'runemysteries')?.reasons.join(' ')).toContain('gather ore');
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

test('keeps a cooperative fight active through misses while combat XP advances', async () => {
    const { engine, state } = fixture();
    state.combat = true;
    for (let i = 0; i < 80; i++) {
        state.now += 1200;
        if (i % 10 === 0) state.xp++;
        await engine.execute();
    }
    expect(state.attempts).toBe(80);
    expect(engine['runningId']).toBe('runemysteries');
});

test('recognizes combat XP progress without the local health-bar combat flag', async () => {
    const {engine, state} = fixture();
    const decide = spyOn(runemysteries, 'decide').mockReturnValue({kind: 'custom', name: 'kill a goblin', run: async () => {
        state.attempts++;
        state.xp += 16;
        return false;
    }});
    restores.push(() => decide.mockRestore());
    await execute(engine, 30);
    expect(state.attempts).toBe(30);
    expect(engine['runningId']).toBe('runemysteries');
    expect(engine['noProgressCount']).toBe(0);
});

test('goblin mail gathering keeps fighting when its step yields before the drop', async () => {
    const { engine, state } = fixture();
    engine['bankKnown'] = true;
    state.coins = 500;
    state.combat = true;
    let hp = 30;
    const tile = { x: 2958, z: 3507, level: 0 };
    const spies = [
        spyOn(Game, 'tile').mockReturnValue(tile),
        spyOn(Game, 'myName').mockReturnValue('quest-combat-fixture'),
        spyOn(Reachability, 'probeable').mockReturnValue(true),
        spyOn(Reachability, 'canReach').mockReturnValue(true),
        spyOn(reader, 'worldTile').mockReturnValue(tile),
        spyOn(reader, 'selfSlot').mockReturnValue(0),
        spyOn(Input, 'interactNpc').mockReturnValue(true),
        spyOn(reader, 'groundItems').mockReturnValue([]),
        spyOn(reader, 'npcs').mockImplementation(() => [{ id: 100, index: 1, name: 'Goblin', level: 2, size: 1,
            tile: { ...tile, z: tile.z + 1 }, distance: 1, ops: ['Attack'], inCombat: true,
            health: hp, totalHealth: 30, faceEntity: 32768, anim: -1 }]),
        spyOn(Sustain, 'run').mockImplementation(async () => { hp--; state.xp += 4; }),
        spyOn(runemysteries, 'decide').mockImplementation(snap => goblinMailGatherStep(snap))
    ];
    restores.push(...spies.map(spy => () => spy.mockRestore()));
    await execute(engine, 1);
    expect(hp).toBeLessThan(22);
    expect(engine['runningId']).toBe('runemysteries');
    expect(engine['noProgressCount']).toBe(0);
});

test('checks the bank before gathering acquirable supplies even with the coin float held', async () => {
    const {engine, state} = fixture();
    const items = runemysteries.record.items;
    restores.push(() => { runemysteries.record.items = items; });
    runemysteries.record.items = [{name: 'Copper ore', qty: 1, kind: 'acquirable'}];
    state.picked = new Set(['runemysteries']);
    state.coins = 1000;
    engine['provisioned'].delete('runemysteries');
    await engine.execute();
    expect(state.bankActions).toEqual(['open']);
    expect(engine['bankKnown']).toBe(true);
});

test('still parks a fight that makes no combat progress for over a minute', async () => {
    const { engine, state } = fixture();
    state.combat = true;
    for (let i = 0; i < 45; i++) {
        state.now += 1200;
        await engine.execute();
    }
    expect(engine['runningId']).toBe('runemysteries');
    for (let i = 0; i < 20; i++) {
        state.now += 1200;
        await engine.execute();
    }
    expect(state.rows.find(row => row.id === 'runemysteries')?.status).toBe('PARKED');
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
    await engine.execute();
    expect(state.bankActions).toEqual(['open']);
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

test('an empty pack checks an unknown bank for the coin float before starting a quest', async () => {
    const { engine, state } = fixture();
    const { items } = runemysteries.record;
    const { coinFloat } = runemysteries;
    restores.push(() => { runemysteries.record.items = items; runemysteries.coinFloat = coinFloat; });
    runemysteries.record.items = [];
    runemysteries.coinFloat = 1000;
    state.picked = new Set(['runemysteries']);
    state.bankCoins = 6_204_130;
    engine['provisioned'].delete('runemysteries');
    engine['freshened'].delete('runemysteries');
    const used = spyOn(Inventory, 'used').mockImplementation(() => state.coins > 0 ? 1 : 0);
    restores.push(() => used.mockRestore());
    const status = spyOn(Quests, 'status').mockReturnValue('notStarted');
    restores.push(() => status.mockRestore());
    await execute(engine, 3);
    expect(state.bankActions).toEqual(['open', 'open', 'withdraw:Coins:1000']);
    expect(state.coins).toBe(1000);
    expect(state.attempts).toBe(1);
});

for (const supply of ['food', 'prayer'] as const) {
    test(`checks an unknown bank for ${supply} even when the quest needs no coins`, async () => {
        const { engine, state, host } = fixture();
        const { items } = runemysteries.record;
        const { coinFloat, food, pray } = runemysteries;
        restores.push(() => { runemysteries.record.items = items; runemysteries.coinFloat = coinFloat; runemysteries.food = food; runemysteries.pray = pray; });
        runemysteries.record.items = [];
        runemysteries.coinFloat = 0;
        runemysteries.food = supply === 'food' ? 8 : 0;
        runemysteries.pray = supply === 'prayer' ? { protect: 'melee', potions: 2 } : undefined;
        host.foodItem = () => 'Lobster';
        state.picked = new Set(['runemysteries']);
        engine['provisioned'].delete('runemysteries');
        await engine.execute();
        expect(state.bankActions).toEqual(['open']);
        expect(state.attempts).toBe(0);
    });
}

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

test('keeps the actionable wait reason after exhausting retries', async () => {
    const { engine, state } = fixture();
    state.wait = true;
    state.picked = new Set(['runemysteries']);
    await execute(engine, 50);
    const row = state.rows.find(row => row.id === 'runemysteries');
    expect(row?.status).toBe('BLOCKED');
    expect(row?.reasons).toContain('waiting: fixture wait');
});

test('worn Excalibur passes the shared supply check and reaches the quest step', async () => {
    const { engine, state } = fixture();
    const items = runemysteries.record.items;
    restores.push(() => { runemysteries.record.items = items; });
    runemysteries.record.items = [{ name: 'Excalibur', qty: 1, kind: 'acquirable' }];
    const equipment = spyOn(Equipment, 'items').mockReturnValue([
        new InvItem({ id: 35, name: 'Excalibur', count: 1, slot: 3, comId: 1688, ops: [] })
    ]);
    restores.push(() => equipment.mockRestore());
    state.picked = new Set(['runemysteries']);
    state.coins = 1000;
    engine['bankKnown'] = true;
    engine['provisioned'].delete('runemysteries');
    expect(engine['readItemSnapshot']().counts.get('excalibur')).toBe(1);
    await engine.execute();
    expect(state.attempts).toBe(1);
    expect(state.bankActions).toEqual([]);
    expect(engine['provisioned'].has('runemysteries')).toBe(true);
});

test('escapes a completed unselected quest area before preparing the next quest', async () => {
    const { engine, state } = fixture();
    const original = doric.recover;
    restores.push(() => { doric.recover = original; });
    let inside = true;
    doric.recover = () => inside ? { kind: 'custom', name: 'leave trapped area', run: async () => { inside = false; return true; } } : null;
    state.picked = new Set(['runemysteries']);
    const status = spyOn(Quests, 'status').mockImplementation(name => name === doric.record.name ? 'complete' : 'inProgress');
    restores.push(() => status.mockRestore());
    await engine.execute();
    expect(inside).toBe(false);
    expect(state.attempts).toBe(0);
    expect(state.bankActions).toEqual([]);
    await engine.execute();
    expect(state.attempts).toBe(1);
});

test('failed escape stops with its cause instead of parking unrelated quests', async () => {
    const { engine, state, host } = fixture();
    const original = doric.recover;
    restores.push(() => { doric.recover = original; });
    doric.recover = () => ({ kind: 'custom', name: 'leave trapped area', run: async () => false });
    const messages: string[] = [];
    host.finish = reason => { messages.push(reason); };
    await execute(engine, 4);
    expect(messages).toEqual(['could not recover from Doric\'s Quest: leave trapped area after 4 attempts']);
    expect(state.attempts).toBe(0);
    expect(state.bankActions).toEqual([]);
    expect(engine['parked'].size).toBe(0);
});

test('failed completion retreat does not discard its exit and advance the queue', async () => {
    const { engine, host } = fixture();
    const original = doric.exit;
    restores.push(() => { doric.exit = original; });
    doric.exit = async () => false;
    const messages: string[] = [];
    host.finish = reason => { messages.push(reason); };
    for (let i = 0; i < 5; i++) expect(await engine['retreatToBank'](doric, 'doric', [])).toBe(false);
    expect(engine['retreated'].has('doric')).toBe(false);
    expect(messages).toEqual(['could not leave Doric\'s Quest after 4 attempts']);
});

for (const parked of [false, true]) {
    test(`resumes the quest owning the current area before queue order, parked=${parked}`, async () => {
        const { engine, state } = fixture();
        const original = doric.resumeAt;
        restores.push(() => { doric.resumeAt = original; });
        doric.resumeAt = tile => tile.x === 3093;
        if (parked) {
            engine['parked'].add('doric');
            engine['parkCounts'].set('doric', 1);
        }
        await engine.execute();
        expect(state.running).toBe('doric');
        expect(state.attempts).toBe(0);
        if (parked) expect(engine['parkCounts'].get('doric')).toBe(1);
    });
}

test('bankless quest areas bypass generic preparation without marking supplies stocked', async () => {
    const { engine, state } = fixture();
    const original = runemysteries.resumeAt;
    restores.push(() => { runemysteries.resumeAt = original; });
    runemysteries.resumeAt = () => true;
    engine['deposited'].delete('runemysteries');
    engine['provisioned'].delete('runemysteries');
    engine['freshened'].delete('runemysteries');
    const items = spyOn(Inventory, 'items').mockReturnValue([
        new InvItem({ id: 373, name: 'Swordfish', count: 1, slot: 0, comId: 3214, ops: [] })
    ]);
    restores.push(() => items.mockRestore());
    await engine.execute();
    expect(state.attempts).toBe(1);
    expect(state.bankActions).toEqual([]);
    expect(engine['provisioned'].has('runemysteries')).toBe(false);
    expect(engine['deposited'].has('runemysteries')).toBe(false);
});

for (const reason of ['blocked', 'skipped', 'unselected'] as const) {
    test(`does not attempt unrelated banking when the area owner is ${reason}`, async () => {
        const { engine, state, host } = fixture();
        const original = doric.resumeAt;
        restores.push(() => { doric.resumeAt = original; });
        doric.resumeAt = () => true;
        if (reason === 'blocked') engine['blocked'].set('doric', ['no progress after three parks']);
        if (reason === 'skipped') {
            engine['runningId'] = 'doric';
            state.skip = true;
        }
        if (reason === 'unselected') state.picked.delete('doric');
        const messages: string[] = [];
        host.finish = message => { messages.push(message); };
        await engine.execute();
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain('Doric\'s Quest');
        expect(messages[0]).toContain('cannot switch quests from this area');
        expect(state.attempts).toBe(0);
        expect(state.bankActions).toEqual([]);
    });
}

test('normal queue order is preserved outside quest-owned areas', async () => {
    const { engine, state } = fixture();
    const original = doric.resumeAt;
    restores.push(() => { doric.resumeAt = original; });
    doric.resumeAt = tile => tile.x === 7777;
    await engine.execute();
    expect(state.running).toBe('runemysteries');
    expect(state.attempts).toBe(1);
});
