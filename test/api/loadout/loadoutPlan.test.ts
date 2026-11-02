import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { foodOf, gearOf, scriptFood, scriptFoods, suppliesOf, weaponOf } from '#/bot/api/loadout/loadoutPlan.js';
import { Loadouts } from '#/bot/api/loadout/loadoutStore.js';
import type { Loadout } from '#/bot/api/loadout/loadouts.js';

const melee: Loadout = {
    name: 'melee',
    worn: { righthand: 'Rune scimitar', torso: 'Rune chainbody' },
    carry: [{ item: 'Prayer potion(4)', qty: 2 }, { item: 'Lobster', qty: 16 }]
};

const empty: Loadout = { name: 'empty', worn: {}, carry: [] };

beforeEach(() => {
    Loadouts.save([]);
});

afterEach(() => Loadouts.save([]));

describe('foodOf', () => {
    test('is the first carried item the catalog calls edible', () => {
        expect(foodOf(melee, 'Trout')).toBe('Lobster');
    });

    test('ignores drinkables', () => {
        expect(foodOf({ name: 'a', worn: {}, carry: [{ item: 'Prayer potion(4)', qty: 2 }] }, 'Trout'))
            .toBe('Trout');
    });

    test('an empty loadout means unchosen, so the script keeps its own default', () => {
        expect(foodOf(empty, 'Trout')).toBe('Trout');
    });

    test('no loadout at all keeps the script default too', () => {
        expect(foodOf(null, 'Trout')).toBe('Trout');
    });

    test('a foodless script stays foodless rather than inheriting a house default', () => {
        expect(foodOf(null, '')).toBe('');
    });
});

describe('gearOf', () => {
    test('lists everything worn', () => {
        expect(gearOf(melee).sort()).toEqual(['Rune chainbody', 'Rune scimitar']);
    });

    test('no loadout is no gear, not a throw', () => {
        expect(gearOf(null)).toEqual([]);
    });
});

describe('weaponOf', () => {
    test('is the right hand', () => {
        expect(weaponOf(melee)).toBe('Rune scimitar');
    });

    test('falls back when no weapon is declared', () => {
        expect(weaponOf(empty, 'Rune scimitar')).toBe('Rune scimitar');
        expect(weaponOf(null, 'Rune scimitar')).toBe('Rune scimitar');
    });

    test('defaults to null so callers that have no fallback still compile', () => {
        expect(weaponOf(null)).toBeNull();
    });
});

describe('suppliesOf', () => {
    test('is the carry list', () => {
        expect(suppliesOf(melee)).toEqual(melee.carry);
    });

    test('no loadout is no supplies', () => {
        expect(suppliesOf(null)).toEqual([]);
    });
});

describe('scriptFood', () => {
    test('is the selected loadout food', () => {
        Loadouts.save([{ name: 'melee', worn: {}, carry: [{ item: 'Shark', qty: 10 }] }]);
        expect(scriptFood(new SettingsBag({ loadout: 'melee' }), 'Trout')).toBe('Shark');
    });

    test('with no loadout the script eats what it always ate', () => {
        expect(scriptFood(new SettingsBag({}), 'Trout')).toBe('Trout');
    });

    test('an empty saved loadout is not a choice', () => {
        Loadouts.save([{ name: 'loadout', worn: {}, carry: [] }]);
        expect(scriptFood(new SettingsBag({}), 'Trout')).toBe('Trout');
    });
});

describe('scriptFoods', () => {
    test('a declared food replaces the whole match list', () => {
        Loadouts.save([{ name: 'melee', worn: {}, carry: [{ item: 'Shark', qty: 10 }] }]);
        expect(scriptFoods(new SettingsBag({}), ['cake', 'bread'])).toEqual(['Shark']);
    });

    test('no loadout keeps the script list intact', () => {
        expect(scriptFoods(new SettingsBag({}), ['cake', 'bread'])).toEqual(['cake', 'bread']);
    });
});
