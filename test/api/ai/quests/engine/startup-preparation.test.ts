import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import type { InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { QuestEngine, type QuestHost } from '#/bot/api/ai/quests/engine/QuestEngine.js';
import type { QuestStep } from '#/bot/api/ai/quests/engine/types.js';
import { runemysteries } from '#/bot/api/ai/quests/defs/runemysteries.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests, type QuestStatus } from '#/bot/api/ui/questlog/Quests.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { Input } from '#/bot/input/Input.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import Tile from '#/bot/geometry/Tile.js';

let owned = runemysteries.ownsInventory;
afterEach(() => { mock.restore(); runemysteries.ownsInventory = owned; });
const item = (id: number, name: string, slot: number): InvItemSnapshot => ({
    id, name, slot, count: 1, comId: 5064, ops: ['Deposit-1', 'Deposit-5', 'Deposit-10', 'Deposit-All', 'Deposit-X']
});
const essencePack = () => [item(1438, 'Air talisman', 0), ...Array.from({ length: 27 }, (_, i) => item(1436, 'Rune essence', i + 1))];
function fixture(pack = essencePack()) {
    owned = runemysteries.ownsInventory;
    runemysteries.ownsInventory = true;
    const state = {
        pack, bank: false, accept: true, status: 'inProgress' as QuestStatus, attempts: 0,
        tile: new Tile(3093, 3243, 0), banks: [] as unknown[], food: null as string | null,
        next: null as QuestStep | null, deposits: [] as number[]
    };
    const host: QuestHost = {
        log: () => {}, verbose: () => false, foodItem: () => state.food, pickedIds: () => new Set(['runemysteries']),
        skipPending: () => false, consumeSkip: () => false, consumeDeath: () => false,
        noteState: () => {}, finish: () => {}
    };
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(reader, 'bankComId').mockImplementation(() => state.bank ? 5382 : -1);
    spyOn(reader, 'bankSideSnapshotReady').mockReturnValue(true);
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.pack);
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'bankItems').mockReturnValue([]);
    spyOn(reader, 'modals').mockImplementation(() => ({main: state.bank ? 5292 : -1, side: state.bank ? 5063 : -1, chat: -1}));
    spyOn(Inventory, 'used').mockImplementation(() => state.pack.length);
    spyOn(Inventory, 'free').mockImplementation(() => 28 - state.pack.length);
    spyOn(Bank, 'loaded').mockReturnValue(true);
    spyOn(Bank, 'ready').mockReturnValue(true);
    spyOn(Banking, 'open').mockImplementation(async options => { state.banks.push(options); state.bank = true; return true; });
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(Navigator, 'findPath').mockImplementation(async (from, to) => ({ok: true, cost: new Tile(from.x, from.z, from.level).distanceTo(to), waypoints: [], hops: [], expanded: 1}));
    spyOn(Modals, 'close').mockImplementation(async () => { state.bank = false; return true; });
    spyOn(Modals, 'closeIfOpen').mockImplementation(async () => { state.bank = false; });
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
    spyOn(Input, 'invButton').mockImplementation((id, slot, _com, op) => {
        state.deposits.push(id);
        if (!state.accept) return false;
        state.pack = state.pack.filter(i => op === 4 ? i.id !== id : i.slot !== slot);
        return true;
    });
    return {state, engine: new QuestEngine(host)};
}

test('a resumed inventory-owning quest clears a full junk pack at the nearby bank before its first action', async () => {
    const {engine, state} = fixture();
    await engine.execute();
    expect(state.attempts).toBe(0);
    expect(state.pack.map(i => i.id)).toEqual([1438]);
    await engine.execute();
    expect(state.attempts).toBe(1);
    expect(state.banks).toHaveLength(1);
});

test('a resumed full food pack is trimmed to its food float before quest actions', async () => {
    const {engine, state} = fixture(Array.from({length: 28}, (_, i) => item(379, 'Lobster', i)));
    state.food = 'Lobster';
    await engine.execute();
    expect(state.attempts).toBe(0);
    expect(state.pack).toHaveLength(8);
    await engine.execute();
    expect(state.attempts).toBe(1);
});

test('a resumed quest can prepare at the bank it already requested', async () => {
    const {engine, state} = fixture();
    state.tile = new Tile(3000, 3300, 0);
    state.next = {kind: 'scanBank', bank: new Tile(3013, 3355, 0)};
    await engine.execute();
    expect(state.pack.map(i => i.id)).toEqual([1438]);
    expect(state.banks).toHaveLength(1);
});

test('a full mainland pack is prepared before a quest action without teleporting', async () => {
    const {engine, state} = fixture();
    state.tile = new Tile(3222, 3218, 0);
    await engine.execute();
    expect(state.attempts).toBe(0);
    expect(state.pack.map(i => i.id)).toEqual([1438]);
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
    expect(state.pack.map(i => i.id)).toEqual([1438]);
});

test('food caps deposit the exact item even when names collide', async () => {
    const {engine, state} = fixture([
        ...Array.from({length: 8}, (_, i) => item(333, 'Trout', i)),
        ...Array.from({length: 20}, (_, i) => item(379, 'Trout', i + 8))
    ]);
    await engine.execute();
    expect(state.pack.map(i => i.id)).toEqual(Array(8).fill(333));
});

test('food caps accept the live bank Deposit 1 action label', async () => {
    const {engine, state} = fixture(Array.from({length: 28}, (_, i) => ({
        ...item(379, 'Lobster', i), ops: ['Deposit 1', 'Deposit 5', 'Deposit 10', 'Deposit All', 'Deposit X']
    })));
    await engine.execute();
    expect(state.pack).toHaveLength(8);
});

test('a rum delivery does not take an unsolicited mainland bank trip', async () => {
    const {engine, state} = fixture([item(431, 'Karamjan rum', 0), ...essencePack().slice(1)]);
    state.tile = new Tile(3027, 3217, 0);
    await engine.execute();
    expect(state.banks).toHaveLength(0);
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
        expect(state.banks).toHaveLength(0);
        expect(state.pack).toHaveLength(28);
        expect(state.attempts).toBe(1);
    });
}

for (const status of ['notStarted', 'inProgress'] as const) {
    test(`a ${status} quest never starts on a pack its bank refused`, async () => {
        const {engine, state} = fixture();
        state.status = status;
        state.accept = false;
        for (let i = 0; i < 8; i++) await engine.execute();
        expect(state.attempts).toBe(0);
        expect(engine['blocked'].get('runemysteries')?.join(' ')).toContain('inventory');
        expect(state.pack).toHaveLength(28);
    });
}

test('refused generic spillover deposits have a bounded retry count', async () => {
    const {engine, state} = fixture([item(1436, 'Rune essence', 0)]);
    runemysteries.ownsInventory = false;
    state.accept = false;
    for (let i = 0; i < 8; i++) await engine.execute();
    expect(state.attempts).toBe(0);
    expect(engine['blocked'].get('runemysteries')?.join(' ')).toContain('inventory');
    expect(state.banks).toHaveLength(3);
});
