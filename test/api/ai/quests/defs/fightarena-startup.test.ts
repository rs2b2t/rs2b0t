import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import type { InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { QuestEngine, type QuestHost } from '#/bot/api/ai/quests/engine/QuestEngine.js';
import type { QuestStep } from '#/bot/api/ai/quests/engine/types.js';
import { fightarena } from '#/bot/api/ai/quests/defs/fightarena/index.js';
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
import Tile from '#/bot/geometry/Tile.js';

afterEach(() => mock.restore());
const item = (id: number, name: string, slot: number): InvItemSnapshot => ({
    id, name, slot, count: 1, comId: 5064, ops: ['Deposit-1', 'Deposit-5', 'Deposit-10', 'Deposit-All', 'Deposit-X']
});
const essencePack = () => [item(1438, 'Air talisman', 0), ...Array.from({ length: 27 }, (_, i) => item(1436, 'Rune essence', i + 1))];
function fixture(pack = essencePack()) {
    const state = {
        pack, bank: false, accept: true, status: 'inProgress' as QuestStatus, attempts: 0,
        tile: new Tile(2598, 3169, 0), banks: [] as unknown[], food: null as string | null,
        next: null as QuestStep | null, deposits: [] as number[]
    };
    const host: QuestHost = {
        log: () => {}, verbose: () => false, foodItem: () => state.food, pickedIds: () => new Set(['arena']),
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
    spyOn(fightarena, 'readStage').mockImplementation(async () => 6);
    spyOn(fightarena, 'decide').mockImplementation(() => state.next ?? ({kind: 'custom', name: 'quest action', run: async () => { state.attempts++; return true; }}));
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

test('a resumed Fight Arena keeps a sealed arena pack and reaches the fight without banking', async () => {
    const {engine, state} = fixture();
    await engine.execute();
    expect(state.banks).toHaveLength(0);
    expect(state.pack).toHaveLength(28);
    expect(state.attempts).toBe(1);
});
