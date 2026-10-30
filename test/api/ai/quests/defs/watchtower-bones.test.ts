import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { decide } from '#/bot/api/ai/quests/defs/watchtower/index.js';
import { Fight, Retreat } from '#/bot/api/combat/hunting/combat.js';
import * as supply from '#/bot/api/combat/hunting/supply.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { GroundItem } from '#/bot/api/grounditems/GroundItems.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';

afterEach(() => mock.restore());

function fixture() {
    const state = { bones: 0, food: 12, shield: true, key: true, drop: false, kills: 0, left: false, cancelled: false,
        tile: new Tile(2946, 3369, 0), prepared: false, bankOpen: false };
    spyOn(Banking, 'open').mockImplementation(async () => { state.bankOpen = true; return true; });
    spyOn(Inventory, 'items').mockImplementation(() => [
        new InvItem({ id: 379, name: 'Lobster', slot: 0, count: state.food, ops: ['Eat'], comId: 3214 }),
        new InvItem({ id: 536, name: 'Dragon bones', slot: 1, count: state.bones, ops: ['Bury'], comId: 3214 }),
        new InvItem({ id: 1590, name: 'Dusty key', slot: 2, count: state.key ? 1 : 0, ops: [], comId: 3214 })
    ].filter(item => item.count > 0));
    spyOn(Bank, 'depositAllMatching').mockImplementation(async matches => {
        if (matches('Lobster', 379)) state.food = 0;
        if (matches('Dragon bones', 536)) state.bones = 0;
        if (matches('Dusty key', 1590)) state.key = false;
    });
    spyOn(Inventory, 'countById').mockImplementation(id => id === 536 ? state.bones : id === 1590 && state.key ? 1 : 0);
    spyOn(Inventory, 'count').mockImplementation(name => name === 'Lobster' ? state.food : 0);
    spyOn(Inventory, 'isFull').mockReturnValue(false);
    spyOn(Equipment, 'contains').mockImplementation(name => name === 'Dragonfire shield' ? state.shield : name === 'Rune scimitar');
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(Skills, 'effective').mockReturnValue(60);
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(Game, 'setAutoRetaliate').mockReturnValue(true);
    spyOn(Game, 'setCombatStyle').mockReturnValue(true);
    spyOn(EventSignal, 'pending').mockImplementation(() => state.cancelled);
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Sustain, 'run').mockResolvedValue(undefined);
    spyOn(supply, 'bankRoutine').mockImplementation(async host => {
        state.prepared = true;
        host.pickWeapon?.(['Rune scimitar']);
    });
    spyOn(supply, 'acquireKey').mockImplementation(async () => state.key ? 'held' : 'fetch');
    spyOn(supply, 'enterLair').mockImplementation(async () => { state.tile = new Tile(2900, 9808, 0); return true; });
    spyOn(supply, 'leaveLair').mockImplementation(async () => {
        state.left = true;
        state.tile = new Tile(2884, 3398, 0);
        return true;
    });
    spyOn(supply, 'inCell').mockReturnValue(false);
    spyOn(Retreat.prototype, 'validate').mockReturnValue(false);
    spyOn(Fight.prototype, 'validate').mockReturnValue(true);
    spyOn(Fight.prototype, 'blocksLoot').mockReturnValue(false);
    spyOn(Fight.prototype, 'execute').mockImplementation(async () => { state.kills++; state.drop = true; });
    spyOn(reader, 'groundItems').mockImplementation(() => state.drop ? [{
        id: 536, name: 'Dragon bones', count: 1, tile: state.tile, distance: 1, ops: ['Take']
    }] : []);
    spyOn(GroundItem.prototype, 'interact').mockImplementation(async action => {
        if (action !== 'Take') return false;
        state.bones++;
        state.drop = false;
        return true;
    });
    spyOn(Traversal, 'walkResilient').mockImplementation(async tile => { state.tile = Tile.from(tile); return true; });
    return state;
}

async function hunt(): Promise<boolean> {
    const step = decide({
        journal: 'inProgress', stage: 2, progress: { stage: 2, flags: new Set(['helped-og', 'spoken-toban']) },
        inv: new Map(), invIds: new Map(), worn: new Set(), noProgress: 0, bankCoins: 0,
        bankKnown: true, bank: new Map([['lobster', 20]]), bankIds: new Map(), tile: new Tile(2612, 3092, 0)
    });
    return step.kind === 'custom' && await step.run(() => {});
}

test('kills one adult dragon, takes its bones and leaves the lair', async () => {
    const state = fixture();
    expect(await hunt()).toBe(true);
    expect(state).toMatchObject({ prepared: true, kills: 1, bones: 1, left: true, bankOpen: true });
});

test('takes existing dragon bones before attacking another dragon', async () => {
    const state = fixture();
    state.drop = true;
    expect(await hunt()).toBe(true);
    expect(state).toMatchObject({ kills: 0, bones: 1, left: true });
});

test.each(['shield', 'key'] as const)('does not attack without its %s', async missing => {
    const state = fixture();
    state[missing] = false;
    expect(await hunt()).toBe(false);
    expect(state.kills).toBe(0);
    expect(state.bankOpen).toBe(true);
});

test('does not enter combat when banking cannot supply food', async () => {
    const state = fixture();
    state.food = 0;
    expect(await hunt()).toBe(false);
    expect(state.kills).toBe(0);
});

test('cancellation stops the hunt before banking or attacking', async () => {
    const state = fixture();
    state.cancelled = true;
    expect(await hunt()).toBe(false);
    expect(state).toMatchObject({ prepared: false, kills: 0, bones: 0 });
});

test('refreshes the bank after an interrupted hunt before trusting cached quest supplies', async () => {
    const state = fixture();
    spyOn(supply, 'bankRoutine').mockImplementation(async () => { state.cancelled = true; });
    expect(await hunt()).toBe(false);
    state.cancelled = false;
    const step = decide({
        journal: 'inProgress', stage: 2, progress: { stage: 2, flags: new Set(['helped-og', 'spoken-toban']) },
        inv: new Map([['dragon bones', 1]]), invIds: new Map([[536, 1]]), worn: new Set(), noProgress: 0,
        bankCoins: 0, bankKnown: true, bank: new Map(), bankIds: new Map(), tile: new Tile(2946, 3369, 0)
    });
    expect(step.kind === 'custom' && step.name).toMatch(/refresh.*bank/i);
    if (step.kind !== 'custom') return;
    expect(await step.run(() => {})).toBe(true);
    expect(state.bankOpen).toBe(true);
});

test('clears hunt supplies at the return bank while keeping the bones for Toban', async () => {
    const state = fixture();
    expect(await hunt()).toBe(true);
    expect(state).toMatchObject({ food: 0, key: false, bones: 1, bankOpen: true });
});
