import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { QuestEngine, type QuestHost } from '#/bot/api/ai/quests/engine/QuestEngine.js';
import type { QuestStep } from '#/bot/api/ai/quests/engine/types.js';
import { fightarena } from '#/bot/api/ai/quests/defs/fightarena/index.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests, type QuestStatus } from '#/bot/api/ui/questlog/Quests.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';
import Tile from '#/bot/geometry/Tile.js';
import { essencePack, mockStartupBank } from '../startup-bank.fixture.js';

afterEach(() => mock.restore());

function fixture(pack = essencePack()) {
    const state = {
        bank: mockStartupBank(pack), status: 'inProgress' as QuestStatus, attempts: 0,
        tile: new Tile(2598, 3169, 0), food: null as string | null,
        next: null as QuestStep | null, retaliate: true
    };
    const host: QuestHost = {
        log: () => {}, verbose: () => false, foodItem: () => state.food, pickedIds: () => new Set(['arena']),
        skipPending: () => false, consumeSkip: () => false, consumeDeath: () => false,
        noteState: () => {}, finish: () => {}
    };
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Game, 'autoRetaliateOn').mockImplementation(() => state.retaliate);
    spyOn(Game, 'setAutoRetaliate').mockImplementation(on => { state.retaliate = on; return true; });
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(Navigator, 'findPath').mockImplementation(async (from, to) => ({ok: true, cost: new Tile(from.x, from.z, from.level).distanceTo(to), waypoints: [], hops: [], expanded: 1}));
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
    return {state, engine: new QuestEngine(host)};
}

test('a resumed Fight Arena keeps a sealed arena pack and reaches the fight without banking', async () => {
    const {engine, state} = fixture();
    await engine.execute();
    expect(state.bank.openCalls).toHaveLength(0);
    expect(state.bank.pack).toHaveLength(28);
    expect(state.attempts).toBe(1);
    expect(state.retaliate).toBe(false);
});
