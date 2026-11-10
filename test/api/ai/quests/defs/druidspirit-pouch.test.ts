import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { NS_ID, NS_STAGE } from '#/bot/api/ai/quests/defs/druidspirit/areas.js';
import { decide } from '#/bot/api/ai/quests/defs/druidspirit/index.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { GroundItem } from '#/bot/api/model/GroundItem.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';

afterEach(() => mock.restore());

function fixture() {
    const state = { pack: [] as number[], ground: [NS_ID.POUCH, NS_ID.POUCH_EMPTY] as number[], takes: true };
    const tile = { x: 3443, z: 9741, level: 0 };
    spyOn(Game, 'tile').mockReturnValue(tile);
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(reader, 'groundItems').mockImplementation(() => state.ground.map(id => ({ id, name: 'Druid pouch', count: 1, ops: ['Take'], tile, distance: 0 })));
    spyOn(Inventory, 'items').mockImplementation(() => state.pack.map((id, slot) => new InvItem({ id, slot, count: 1, name: 'Druid pouch', ops: ['Fill'], comId: 3214 })));
    spyOn(GroundItem.prototype, 'interact').mockImplementation(async function (this: GroundItem, action) {
        if (action !== 'Take') return false;
        if (state.takes) state.pack.push(this.id);
        return true;
    });
    const snap: QuestSnapshot = {
        journal: 'inProgress', stage: NS_STAGE.ADDED_POUCH, tile, inv: new Map(), invIds: new Map([[NS_ID.SICKLE_BLESSED, 1]]),
        worn: new Set(), wornIds: new Set([NS_ID.GHOSTSPEAK]), bankKnown: true, bankIds: new Map(), noProgress: 0, bankCoins: 0
    };
    return { state, run: async () => {
        const step = decide(snap);
        expect(step.kind).toBe('custom');
        return step.kind === 'custom' && step.run(() => {});
    } };
}

test('replacement takes the empty pouch spawn rather than a charged pouch with the same name', async () => {
    const f = fixture();
    expect(await f.run()).toBe(true);
    expect(f.state.pack).toEqual([NS_ID.POUCH_EMPTY]);
});

test('a missing ground spawn leaves recovery pending', async () => {
    const f = fixture();
    f.state.ground = [];
    expect(await f.run()).toBe(false);
    expect(f.state.pack).toEqual([]);
});

test('a successful Take click does not complete recovery without the pouch in inventory', async () => {
    const f = fixture();
    f.state.takes = false;
    expect(await f.run()).toBe(false);
    expect(f.state.pack).toEqual([]);
});
