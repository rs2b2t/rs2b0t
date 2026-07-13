import { expect, test, describe } from 'bun:test';
import { handleLocation, pickSacrificial } from './RandomEvents.js';

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
