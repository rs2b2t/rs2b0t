import { expect, test, describe } from 'bun:test';
import { GearLossTracker, handleLocation, pickSacrificial } from '#/bot/api/RandomEvents.js';

describe('handleLocation', () => {
    test('worn handle wins (the wielded-pick case the old scan missed)', () => {
        expect(handleLocation(['Iron ore'], ['Pickaxe handle'])).toBe('worn');
        expect(handleLocation(['Pickaxe handle'], ['Pickaxe handle'])).toBe('worn');
    });

    test('inventory handle (tool was carried, not wielded)', () => {
        expect(handleLocation(['Axe handle', 'Logs'], [])).toBe('inventory');
        expect(handleLocation(['Pickaxe handle'], ['Amulet of power'])).toBe('inventory');
    });

    test('null when no handle anywhere', () => {
        expect(handleLocation(['Iron ore', null], ['Rune pickaxe'])).toBeNull();
    });
});

describe('pickSacrificial', () => {
    test('most-duplicated non-protected item wins (the mined ore)', () => {
        expect(pickSacrificial(['Rune pickaxe', 'Iron ore', 'Iron ore', 'Uncut sapphire', 'Iron ore'])).toBe('Iron ore');
    });

    test('never drops tools or the event pieces', () => {
        expect(pickSacrificial(['Pickaxe head', 'Pickaxe handle', 'Rune pickaxe', 'Bronze axe', 'Hammer', 'Knife', 'Tinderbox'])).toBeNull();
        expect(pickSacrificial(['Fishing rod', 'Small net', 'Harpoon', 'Chisel'])).toBeNull();
    });

    test('null-safe and null on empty', () => {
        expect(pickSacrificial([null, null])).toBeNull();
        expect(pickSacrificial([])).toBeNull();
    });
});

describe('GearLossTracker', () => {
    test('gear vanishing from the pack records a recent loss', () => {
        const t = new GearLossTracker(90_000);
        t.update(['Harpoon', 'Big fishing net'], false, 1000);
        t.update(['Harpoon'], false, 2000);
        expect(t.recentlyLost('big fishing net', 2500)).toBe(true);
        expect(t.recentlyLost('harpoon', 2500)).toBe(false);
    });

    test('losses expire after the window (the ground drop despawns)', () => {
        const t = new GearLossTracker(90_000);
        t.update(['Harpoon'], false, 0);
        t.update([], false, 1000);
        expect(t.recentlyLost('harpoon', 91_001)).toBe(false);
    });

    test('bank/shop suppression covers the open AND the following update (deposits are noticed after the bank closes)', () => {
        const t = new GearLossTracker(90_000);
        t.update(['Lobster pot'], false, 0);
        t.update(['Lobster pot'], true, 1000); // bank open
        t.update([], false, 2000); // gear gone, bank just closed — still a deposit
        expect(t.recentlyLost('lobster pot', 2500)).toBe(false);
    });

    test('a knock-off never seen as held records nothing (guild ground spawns)', () => {
        const t = new GearLossTracker(90_000);
        t.update([], false, 0);
        t.update([], false, 1000);
        expect(t.recentlyLost('big fishing net', 1500)).toBe(false);
    });
});
