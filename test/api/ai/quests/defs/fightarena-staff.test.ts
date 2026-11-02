import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { decide, fightarena } from '#/bot/api/ai/quests/defs/fightarena/index.js';
import { FA_TILE } from '#/bot/api/ai/quests/defs/fightarena/areas.js';
import { FA_STAGE } from '#/bot/api/ai/quests/defs/fightarena/journal.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { Shop } from '#/bot/api/shop/Shop.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';

const mocks: { mockRestore(): void }[] = [];
afterEach(() => { mocks.splice(0).forEach(mock => mock.mockRestore()); });

const snapshot = (extra: Partial<QuestSnapshot> = {}): QuestSnapshot => ({
    journal: 'inProgress', stage: FA_STAGE.STARTED, tile: FA_TILE.YANILLE_BANK,
    inv: new Map([['mind rune', 150], ['air rune', 300], ['fire rune', 358], ['coins', 2000]]),
    worn: new Set(), magic: 42, attack: 61, bank: new Map(), bankKnown: true,
    bankCoins: 10000, freeSlots: 24, noProgress: 0, ...extra
});

describe('Fight Arena staff supplies', () => {
    test('recovers a banked fire staff and equips it before releasing food', () => {
        const state = snapshot({ bank: new Map([['staff of fire', 1]]) });
        expect(decide(state)).toMatchObject({ kind: 'withdraw', items: [{ name: 'Staff of fire', qty: 1 }] });
        expect(fightarena.foodReady?.(state)).toBe(false);
        state.bank = new Map();
        state.inv.set('staff of fire', 1);
        expect(decide(state)).toEqual({ kind: 'equip', item: 'Staff of fire' });
        expect(fightarena.foodReady?.(state)).toBe(false);
        state.inv.delete('staff of fire');
        state.inv.delete('fire rune');
        state.worn.add('staff of fire');
        expect(decide(state)).toMatchObject({ kind: 'custom', name: "search the guards' chest" });
        expect(fightarena.foodReady?.(state)).toBe(true);
    });

    test('shops for a staff instead of competing for the remaining fire runes', () => {
        expect(decide(snapshot())).toMatchObject({ kind: 'custom', name: 'buy a Strike staff from Zaff' });
    });

    test('tops up the coin float before buying the staff', () => {
        const state = snapshot();
        state.inv.set('coins', 1000);
        expect(decide(state)).toMatchObject({ kind: 'withdraw', items: [{ name: 'Coins', qty: 1000 }] });
    });

    test('equips a carried staff before a bank scan', () => {
        const state = snapshot({ bankKnown: false });
        state.inv.set('staff of fire', 1);
        expect(decide(state)).toEqual({ kind: 'equip', item: 'Staff of fire' });
    });

    test('scans an unknown bank before buying a staff', () => {
        expect(decide(snapshot({ bankKnown: false }))).toMatchObject({ kind: 'scanBank' });
    });

    test.each(['Fire battlestaff', 'Lava battlestaff', 'Mystic fire staff', 'Mystic lava staff'])('recovers a usable %s', staff => {
        expect(decide(snapshot({ bank: new Map([[staff.toLowerCase(), 1]]) })))
            .toMatchObject({ kind: 'withdraw', items: [{ name: staff, qty: 1 }] });
    });

    test('buys a basic staff when the banked battlestaff cannot be wielded', () => {
        expect(decide(snapshot({ attack: 1, bank: new Map([['fire battlestaff', 1]]) })))
            .toMatchObject({ kind: 'custom', name: 'buy a Strike staff from Zaff' });
    });

    test.each([
        { staff: 'Staff of air', casts: 600 }, { staff: 'Staff of water', casts: 300 }, { staff: 'Staff of earth', casts: 200 }
    ])('recovers an owned alternative without fire runes (%j)', ({ staff, casts }) => {
        const state = snapshot({ bank: new Map([[staff.toLowerCase(), 1]]) });
        expect(decide(state)).toMatchObject({ kind: 'withdraw', items: [{ name: staff, qty: 1 }] });
        state.bank = new Map();
        state.inv.set(staff.toLowerCase(), 1);
        expect(decide(state)).toEqual({ kind: 'equip', item: staff });
        state.inv.delete(staff.toLowerCase());
        state.inv.delete('fire rune');
        state.worn.add(staff.toLowerCase());
        expect(fightarena.foodReady?.(state)).toBe(false);
        expect(decide(state)).toMatchObject({ kind: 'buy', item: 'Mind rune', qty: casts - 150 });
        state.inv.set('mind rune', casts);
        expect(decide(state)).toMatchObject({ kind: 'custom', name: "search the guards' chest" });
        expect(fightarena.foodReady?.(state)).toBe(true);
    });

    test.each([
        { fireStock: 2, expected: 'Staff of fire' }, { fireStock: 0, expected: 'Staff of air' }
    ])('buys the strongest stocked staff (%j)', async ({ fireStock, expected }) => {
        const bought = new Map<string, number>();
        mocks.push(spyOn(Traversal, 'walkResilient').mockResolvedValue(true));
        mocks.push(spyOn(Shop, 'open').mockResolvedValue(true));
        mocks.push(spyOn(Shop, 'stock').mockReturnValue([
            { name: 'Staff of fire', count: fireStock, slot: 5 },
            { name: 'Staff of air', count: 2, slot: 2 }
        ]));
        mocks.push(spyOn(Shop, 'buy').mockImplementation(async (item, qty) => {
            if (item !== expected || qty !== 1) throw new Error(`unexpected purchase: ${item} ×${qty}`);
            bought.set(item, qty);
            return qty;
        }));
        mocks.push(spyOn(Shop, 'close').mockResolvedValue());
        const step = decide(snapshot());
        expect(step.kind).toBe('custom');
        if (step.kind !== 'custom') return;
        expect(await step.run(() => {})).toBe(true);
        expect(bought).toEqual(new Map([[expected, 1]]));
    });

    test('uses a full rune budget without a staff shopping trip', () => {
        const state = snapshot({ bankKnown: false });
        state.inv.set('fire rune', 450);
        expect(decide(state)).toMatchObject({ kind: 'custom' });
        expect(fightarena.foodReady?.(state)).toBe(true);
    });

    test('clears a full pack before withdrawing a staff without banking quest items', () => {
        const state = snapshot({ freeSlots: 0, bank: new Map([['staff of fire', 1]]) });
        state.inv.set('khazard cell keys', 1);
        state.inv.set('logs', 23);
        const step = decide(state);
        expect(step.kind).toBe('deposit');
        if (step.kind === 'deposit') expect(step.keep).toContain('khazard cell keys');
    });
});
