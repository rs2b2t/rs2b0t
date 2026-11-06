import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { runemysteries } from '#/bot/api/ai/quests/defs/runemysteries.js';
import { defById } from '#/bot/api/ai/quests/defs/index.js';
import { prepareQuestRetaliation } from '#/bot/api/ai/quests/engine/retaliation.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { QuestEngine, type QuestHost } from '#/bot/api/ai/quests/engine/QuestEngine.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';

afterEach(() => { mock.restore(); Sustain.set(null); });

function fixture() {
    const state = { retaliate: false, accepted: true, confirmed: true, actions: 0, toggles: [] as boolean[], seen: [] as boolean[] };
    const host: QuestHost = {
        log: () => {}, verbose: () => false, foodItem: () => null,
        pickedIds: () => new Set(['runemysteries']), skipPending: () => false,
        consumeSkip: () => false, consumeDeath: () => false,
        noteState: () => {}, finish: () => {}
    };
    spyOn(reader, 'modals').mockReturnValue({ main: -1, side: -1, chat: -1 });
    spyOn(Game, 'tile').mockReturnValue({ x: 3093, z: 3243, level: 0 });
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Game, 'autoRetaliateOn').mockImplementation(() => state.retaliate);
    spyOn(Game, 'setAutoRetaliate').mockImplementation(on => {
        state.toggles.push(on);
        if (state.accepted && state.confirmed) state.retaliate = on;
        return state.accepted;
    });
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(Skills, 'effective').mockReturnValue(99);
    spyOn(Skills, 'xp').mockReturnValue(10000);
    spyOn(Equipment, 'items').mockReturnValue([]);
    spyOn(Inventory, 'items').mockReturnValue([]);
    spyOn(Inventory, 'used').mockReturnValue(0);
    spyOn(Inventory, 'free').mockReturnValue(28);
    spyOn(Bank, 'isOpen').mockReturnValue(false);
    spyOn(Quests, 'status').mockReturnValue('inProgress');
    spyOn(Quests, 'points').mockReturnValue(200);
    spyOn(runemysteries, 'readStage').mockImplementation(() => 4);
    spyOn(runemysteries, 'decide').mockImplementation(() => ({ kind: 'custom', name: 'fight requiring retaliation', run: async () => {
        state.actions++;
        state.seen.push(state.retaliate);
        await Sustain.run();
        return true;
    } }));
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => condition());
    const engine = new QuestEngine(host);
    engine['runningId'] = 'runemysteries';
    for (const name of ['provisioned', 'coinsDrawn', 'foodDrawn', 'potionsDrawn', 'prepared', 'deposited', 'freshened'] as const) {
        engine[name].add('runemysteries');
    }
    return { engine, state };
}

test('enables inherited-off retaliation before a quest action', async () => {
    const { engine, state } = fixture();
    await engine.execute();
    expect(state.seen).toEqual([true]);
    expect(state.toggles).toEqual([true]);
});

test('an already enabled setting does not send another toggle', async () => {
    const { engine, state } = fixture();
    state.retaliate = true;
    await engine.execute();
    expect(state.actions).toBe(1);
    expect(state.toggles).toEqual([]);
});

for (const failure of ['accepted', 'confirmed'] as const) {
    test(`a toggle that is not ${failure} blocks the quest action and retries`, async () => {
        const { engine, state } = fixture();
        state[failure] = false;
        await engine.execute();
        expect(state.actions).toBe(0);
        state[failure] = true;
        await engine.execute();
        expect(state.seen).toEqual([true]);
    });
}

test('custom steps retain control during sustain, and the next step repairs their setting', async () => {
    const { engine, state } = fixture();
    spyOn(runemysteries, 'decide').mockReturnValue({ kind: 'custom', name: 'temporarily suppress retaliation', run: async () => {
        expect(state.retaliate).toBe(true);
        Game.setAutoRetaliate(false);
        await Sustain.run();
        expect(state.retaliate).toBe(false);
        return true;
    } });
    await engine.execute();
    await engine.execute();
    expect(state.toggles).toEqual([true, false, true, false]);
});

const snap = (x = 3093, z = 3243, inv: [string, number][] = []): QuestSnapshot => ({
    journal: 'inProgress', inv: new Map(inv), worn: new Set(), noProgress: 0, bankCoins: 0,
    stage: 2, tile: { x, z, level: 0 }
});

for (const id of ['blackknight', 'squire', 'arena', 'ball', 'horror']) {
    test(`${id} keeps retaliation off for deliberate non-retaliating routes and fights`, async () => {
        const { state } = fixture();
        state.retaliate = true;
        expect(await prepareQuestRetaliation(defById(id)!, snap())).toBe(true);
        expect(state.retaliate).toBe(false);
        expect(await prepareQuestRetaliation(defById(id)!, snap())).toBe(true);
        expect(state.toggles).toEqual([false]);
    });
}

for (const [id, safe] of [
    ['grandtree', snap(2472, 9865)],
    ['crest', snap(3086, 9958)],
    ['itwatchtower', snap(2901, 9809)],
    ['zanaris', snap(2855, 9736, [['iron axe', 1]])]
] as const) {
    test(`${id} preserves cover in its special area and restores retaliation outside`, async () => {
        const { state } = fixture();
        state.retaliate = true;
        const module = defById(id)!;
        expect(await prepareQuestRetaliation(module, safe)).toBe(true);
        expect(state.retaliate).toBe(false);
        expect(await prepareQuestRetaliation(module, snap())).toBe(true);
        expect(state.retaliate).toBe(true);
        expect(state.toggles).toEqual([false, true]);
    });
}

test('Lost City still retaliates against zombies while collecting its axe', async () => {
    const { state } = fixture();
    expect(await prepareQuestRetaliation(defById('zanaris')!, snap(2855, 9736))).toBe(true);
    expect(state.retaliate).toBe(true);
});

test('interruption during confirmation prevents the next quest action', async () => {
    const { engine, state } = fixture();
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async predicate => {
        spyOn(EventSignal, 'pending').mockReturnValue(true);
        return predicate();
    });
    await engine.execute();
    expect(state.actions).toBe(0);
});
