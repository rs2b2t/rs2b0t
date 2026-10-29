import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Loadouts } from '#/bot/api/loadout/loadoutStore.js';
import type { Loadout } from '#/bot/api/loadout/loadouts.js';

const melee: Loadout = {
    name: 'melee',
    worn: { righthand: 'Rune scimitar' },
    carry: [{ item: 'Lobster', qty: 16 }]
};

beforeEach(() => {
    Loadouts.save([]);
});

afterEach(() => Loadouts.save([]));

describe('Loadouts', () => {
    test('starts empty', () => {
        expect(Loadouts.all()).toEqual([]);
        expect(Loadouts.names()).toEqual([]);
    });

    test('saved loadouts read back', () => {
        Loadouts.save([melee]);
        expect(Loadouts.all()).toEqual([melee]);
        expect(Loadouts.names()).toEqual(['melee']);
    });

    test('byName is case-insensitive and misses cleanly', () => {
        Loadouts.save([melee]);
        expect(Loadouts.byName('MELEE')).toEqual(melee);
        expect(Loadouts.byName('nothing')).toBeNull();
    });
});
