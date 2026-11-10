import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { SM_ID, SM_LOC_ID, SM_STAGE, SM_TILE } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import { decide } from '#/bot/api/ai/quests/defs/mortton/index.js';
import { loadedPyre, stackPyre, layRemains, lightPyre } from '#/bot/api/ai/quests/defs/mortton/pyre.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Loc } from '#/bot/api/locs/Locs.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';

afterEach(() => {
    spyOn(reader, 'locs').mockReturnValue([]);
    loadedPyre();
    mock.restore();
});

function fixture() {
    const state = {
        own: Number(SM_LOC_ID.PYRE_EMPTY), other: 0, xp: 0, burn: true,
        uses: [] as number[], lights: [] as number[],
        items: new Map<number, number>([[SM_ID.PYRE_LOGS, 1], [SM_ID.REMAINS, 1], [SM_ID.TINDERBOX, 1]])
    };
    spyOn(reader, 'locs').mockImplementation(() => [
        { id: state.own, x: 3506, distance: 2 },
        { id: state.other, x: 3508, distance: 1 }
    ].filter(loc => loc.id > 0).map(loc => ({
        id: loc.id, typecode: 0, name: 'Funeral Pyre',
        tile: { x: loc.x, z: SM_TILE.PYRE.z, level: 0 }, distance: loc.distance, ops: ['Light']
    })));
    spyOn(Inventory, 'items').mockImplementation(() => [...state.items]
        .filter(([, count]) => count > 0)
        .map(([id, count], slot) => new InvItem({ id, count, slot, name: 'item', ops: [], comId: 3214 })));
    spyOn(Inventory, 'countById').mockImplementation(id => state.items.get(id) ?? 0);
    spyOn(InvItem.prototype, 'useOn').mockImplementation(async function (this: InvItem, target) {
        if (!(target instanceof Loc) || target.tile().x !== 3506) return false;
        state.uses.push(this.id);
        state.items.set(this.id, (state.items.get(this.id) ?? 0) - 1);
        state.own = this.id === SM_ID.PYRE_LOGS ? SM_LOC_ID.PYRE_LOGS : SM_LOC_ID.PYRE_BONES;
        return true;
    });
    spyOn(Loc.prototype, 'interact').mockImplementation(async function (this: Loc) {
        state.lights.push(this.tile().x);
        if (this.tile().x !== 3506) return false;
        state.own = SM_LOC_ID.PYRE_EMPTY;
        if (state.burn) state.xp += 50;
        return true;
    });
    spyOn(Skills, 'xp').mockImplementation(() => state.xp);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(Modals, 'closeIfOpen').mockResolvedValue();
    return state;
}

test('a nearby player pyre does not stand in for our own logs', async () => {
    const state = fixture();
    state.other = SM_LOC_ID.PYRE_LOGS;
    expect(await stackPyre(() => {})).toBe(true);
    expect(state.items.get(SM_ID.PYRE_LOGS)).toBe(0);
    expect(state.own).toBe(SM_LOC_ID.PYRE_LOGS);
});

test('remains and lighting stay on the pyre where we placed the logs', async () => {
    const state = fixture();
    expect(await stackPyre(() => {})).toBe(true);
    state.other = SM_LOC_ID.PYRE_BONES;
    expect(await layRemains(() => {})).toBe(true);
    expect(state.items.get(SM_ID.REMAINS)).toBe(0);
    expect(await lightPyre(() => {})).toBe(true);
    expect(state.lights).toEqual([3506]);
});

test('an expired pyre is not reported as a successful cremation', async () => {
    const state = fixture();
    await stackPyre(() => {});
    await layRemains(() => {});
    state.burn = false;
    expect(await lightPyre(() => {})).toBe(false);
});

test('the quest stacks, adds remains and lights without yielding to another preparation cycle', async () => {
    const state = fixture();
    const step = decide({
        journal: 'inProgress', stage: SM_STAGE.CREATED_PYRE_LOGS,
        inv: new Map([[(QuestFood.name ?? 'Trout').toLowerCase(), 6]]),
        invIds: new Map([...state.items, [SM_ID.COINS, 30000], [SM_ID.SERUM3, 1]]),
        worn: new Set(), bankKnown: true, bank: new Map(), bankIds: new Map(),
        noProgress: 0, bankCoins: 0, freeSlots: 20, tile: SM_TILE.PYRE
    });
    expect(step.kind).toBe('custom');
    if (step.kind !== 'custom') return;
    expect(await step.run(() => {})).toBe(true);
    expect(state.items.get(SM_ID.PYRE_LOGS)).toBe(0);
    expect(state.items.get(SM_ID.REMAINS)).toBe(0);
    expect(state.xp).toBe(50);
});

test('a pending interruption stops the cremation before consuming supplies', async () => {
    const state = fixture();
    spyOn(EventSignal, 'pending').mockReturnValue(true);
    const step = decide({
        journal: 'inProgress', stage: SM_STAGE.CREATED_PYRE_LOGS,
        inv: new Map([[(QuestFood.name ?? 'Trout').toLowerCase(), 6]]),
        invIds: new Map([...state.items, [SM_ID.COINS, 30000], [SM_ID.SERUM3, 1]]),
        worn: new Set(), bankKnown: true, bank: new Map(), bankIds: new Map(),
        noProgress: 0, bankCoins: 0, freeSlots: 20, tile: SM_TILE.PYRE
    });
    expect(step.kind).toBe('custom');
    if (step.kind !== 'custom') return;
    expect(await step.run(() => {})).toBe(false);
    expect(state.items.get(SM_ID.PYRE_LOGS)).toBe(1);
    expect(state.items.get(SM_ID.REMAINS)).toBe(1);
});
