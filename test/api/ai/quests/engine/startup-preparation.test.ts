import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { QuestEngine, type QuestHost } from '#/bot/api/ai/quests/engine/QuestEngine.js';
import type { QuestStep } from '#/bot/api/ai/quests/engine/types.js';
import { runemysteries } from '#/bot/api/ai/quests/defs/runemysteries.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests, type QuestStatus } from '#/bot/api/ui/questlog/Quests.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import Tile from '#/bot/geometry/Tile.js';
import { essencePack, item, mockStartupBank } from '../startup-bank.fixture.js';

let owned = runemysteries.ownsInventory;
afterEach(() => { mock.restore(); runemysteries.ownsInventory = owned; });

function fixture(pack = essencePack()) {
    owned = runemysteries.ownsInventory;
    runemysteries.ownsInventory = true;
    const state = {
        bank: mockStartupBank(pack), status: 'inProgress' as QuestStatus, attempts: 0,
        tile: new Tile(3093, 3243, 0), food: null as string | null,
        next: null as QuestStep | null
    };
    const host: QuestHost = {
        log: () => {}, verbose: () => false, foodItem: () => state.food, pickedIds: () => new Set(['runemysteries']),
        skipPending: () => false, consumeSkip: () => false, consumeDeath: () => false,
        noteState: () => {}, finish: () => {}
    };
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(Navigator, 'findPath').mockImplementation(async (from, to) => ({ok: true, cost: new Tile(from.x, from.z, from.level).distanceTo(to), waypoints: [], hops: [], expanded: 1}));
    spyOn(Equipment, 'items').mockReturnValue([]);
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(Skills, 'effective').mockReturnValue(60);
    spyOn(Skills, 'xp').mockReturnValue(10000);
    spyOn(Quests, 'status').mockImplementation(() => state.status);
    spyOn(Quests, 'points').mockReturnValue(100);
    spyOn(runemysteries, 'readStage').mockImplementation(async () => 1);
    spyOn(runemysteries, 'decide').mockImplementation(() => state.next ?? ({kind: 'custom', name: 'quest action', run: async () => { state.attempts++; return true; }}));
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    return {state, engine: new QuestEngine(host)};
}

test('a resumed inventory-owning quest clears a full junk pack at the nearby bank before its first action', async () => {
    const {engine, state} = fixture();
    await engine.execute();
    expect(state.attempts).toBe(0);
    expect(state.bank.pack.map(i => i.id)).toEqual([1438]);
    await engine.execute();
    expect(state.attempts).toBe(1);
    expect(state.bank.openCalls).toHaveLength(1);
});

test('a resumed full food pack is trimmed to its food float before quest actions', async () => {
    const {engine, state} = fixture(Array.from({length: 28}, (_, i) => item(379, 'Lobster', i)));
    state.food = 'Lobster';
    await engine.execute();
    expect(state.attempts).toBe(0);
    expect(state.bank.pack).toHaveLength(8);
    await engine.execute();
    expect(state.attempts).toBe(1);
});

test('a resumed quest can prepare at the bank it already requested', async () => {
    const {engine, state} = fixture();
    state.tile = new Tile(3000, 3300, 0);
    state.next = {kind: 'scanBank', bank: new Tile(3013, 3355, 0)};
    await engine.execute();
    expect(state.bank.pack.map(i => i.id)).toEqual([1438]);
    expect(state.bank.openCalls).toHaveLength(1);
});

test('a full mainland pack is prepared before a quest action without teleporting', async () => {
    const {engine, state} = fixture();
    state.tile = new Tile(3222, 3218, 0);
    await engine.execute();
    expect(state.attempts).toBe(0);
    expect(state.bank.pack.map(i => i.id)).toEqual([1438]);
    expect(Traversal.walkResilient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({policy: {useTeleports: false}}));
});

test('mainland preparation selects a reachable bank when the closest is toll-gated', async () => {
    const {engine, state} = fixture();
    state.tile = new Tile(3222, 3218, 0);
    const bank = BANK_LOCATIONS.find(bank => bank.name === 'Draynor')!;
    spyOn(Navigator, 'findPath').mockImplementation(async (_from, to) => to.x === bank.tile.x && to.z === bank.tile.z
        ? {ok: true, cost: 180, waypoints: [], hops: [], expanded: 1}
        : {ok: false, reason: 'unreachable', expanded: 1});
    await engine.execute();
    expect(state.attempts).toBe(0);
    expect(Traversal.walkResilient).toHaveBeenCalledWith(bank.tile, expect.objectContaining({policy: {useTeleports: false}}));
    expect(Navigator.findPath).toHaveBeenCalledWith(state.tile, bank.tile, expect.objectContaining({useTeleportCatalog: false, policy: {useTeleports: false}}));
    expect(state.bank.pack.map(i => i.id)).toEqual([1438]);
});

test('food caps deposit the exact item even when names collide', async () => {
    const {engine, state} = fixture([
        ...Array.from({length: 8}, (_, i) => item(333, 'Trout', i)),
        ...Array.from({length: 20}, (_, i) => item(379, 'Trout', i + 8))
    ]);
    await engine.execute();
    expect(state.bank.pack.map(i => i.id)).toEqual(Array(8).fill(333));
});

test('food caps accept the live bank Deposit 1 action label', async () => {
    const {engine, state} = fixture(Array.from({length: 28}, (_, i) => ({
        ...item(379, 'Lobster', i), ops: ['Deposit 1', 'Deposit 5', 'Deposit 10', 'Deposit All', 'Deposit X']
    })));
    await engine.execute();
    expect(state.bank.pack).toHaveLength(8);
});

test('a rum delivery does not take an unsolicited mainland bank trip', async () => {
    const {engine, state} = fixture([item(431, 'Karamjan rum', 0), ...essencePack().slice(1)]);
    state.tile = new Tile(3027, 3217, 0);
    await engine.execute();
    expect(state.bank.openCalls).toHaveLength(0);
    expect(state.attempts).toBe(1);
});

for (const tile of [
    new Tile(2821, 2920, 0), new Tile(2853, 3335, 0), new Tile(2800, 9300, 0),
    new Tile(2513, 3460, 0), new Tile(2540, 3300, 0), new Tile(2200, 3200, 0), new Tile(3280, 3020, 0)
]) {
    test(`bankless resume at ${tile.x},${tile.z} leaves the pack to the quest's own recovery step`, async () => {
        const {engine, state} = fixture();
        state.tile = tile;
        await engine.execute();
        expect(state.bank.openCalls).toHaveLength(0);
        expect(state.bank.pack).toHaveLength(28);
        expect(state.attempts).toBe(1);
    });
}

for (const status of ['notStarted', 'inProgress'] as const) {
    test(`a ${status} quest never starts on a pack its bank refused`, async () => {
        const {engine, state} = fixture();
        state.status = status;
        state.bank.accept = false;
        for (let i = 0; i < 8; i++) await engine.execute();
        expect(state.attempts).toBe(0);
        expect(engine['blocked'].get('runemysteries')?.join(' ')).toContain('inventory');
        expect(state.bank.pack).toHaveLength(28);
    });
}

test('refused generic spillover deposits have a bounded retry count', async () => {
    const {engine, state} = fixture([item(1436, 'Rune essence', 0)]);
    runemysteries.ownsInventory = false;
    state.bank.accept = false;
    for (let i = 0; i < 8; i++) await engine.execute();
    expect(state.attempts).toBe(0);
    expect(engine['blocked'].get('runemysteries')?.join(' ')).toContain('inventory');
    expect(state.bank.openCalls).toHaveLength(3);
});
