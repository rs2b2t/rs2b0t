import { describe, expect, test } from 'bun:test';
import {
    consumableOptions,
    searchItems,
    shieldDisabled,
    slotOptions,
    SLOT_LAYOUT,
    SUPPLY_ROWS,
    wearItem,
    wornFromEquipment
} from '#/bot/panel/loadoutPanelLogic.js';
import { SLOTS } from '#/bot/api/loadout/types.js';

describe('slotOptions', () => {
    test('offers only items for that slot', () => {
        expect(slotOptions('righthand').every(r => r.slot === 'righthand')).toBe(true);
    });

    test('offers the rune scimitar in the weapon slot', () => {
        expect(slotOptions('righthand').some(r => r.name === 'Rune scimitar')).toBe(true);
    });

    test('every slot offers something', () => {
        for (const slot of SLOTS) {
            expect(slotOptions(slot).length).toBeGreaterThan(0);
        }
    });
});

describe('consumableOptions', () => {
    test('offers edibles and drinkables only', () => {
        expect(consumableOptions().every(r => r.consumable !== undefined)).toBe(true);
    });

    test('offers lobster', () => {
        expect(consumableOptions().some(r => r.name === 'Lobster')).toBe(true);
    });
});

describe('searchItems', () => {
    const list = slotOptions('righthand');

    test('an empty query returns everything', () => {
        expect(searchItems(list, '')).toEqual(list);
    });

    test('matches case-insensitively on the display name', () => {
        expect(searchItems(list, 'rune scim').some(r => r.name === 'Rune scimitar')).toBe(true);
    });

    test('a query that matches nothing returns nothing', () => {
        expect(searchItems(list, 'zzzznope')).toEqual([]);
    });
});

describe('shieldDisabled', () => {
    test('a two-hander disables the shield slot', () => {
        expect(shieldDisabled({ righthand: 'Rune 2h sword' })).toBe(true);
    });

    test('a one-hander leaves it enabled', () => {
        expect(shieldDisabled({ righthand: 'Rune scimitar' })).toBe(false);
    });

    test('an empty weapon slot leaves it enabled', () => {
        expect(shieldDisabled({})).toBe(false);
    });
});

describe('wearItem', () => {
    test('sets the slot', () => {
        expect(wearItem({}, 'righthand', 'Rune scimitar')).toEqual({ righthand: 'Rune scimitar' });
    });

    test('a null name clears the slot', () => {
        expect(wearItem({ righthand: 'Rune scimitar' }, 'righthand', null)).toEqual({});
    });

    test('wearing a two-hander clears the shield', () => {
        const worn = { lefthand: 'Rune kiteshield' };
        expect(wearItem(worn, 'righthand', 'Rune 2h sword')).toEqual({ righthand: 'Rune 2h sword' });
    });

    test('does not mutate the input', () => {
        const worn = { righthand: 'Rune scimitar' };
        wearItem(worn, 'torso', 'Rune platebody');
        expect(worn).toEqual({ righthand: 'Rune scimitar' });
    });
});

describe('SLOT_LAYOUT', () => {
    test('is the equipment interface grid and covers every slot once', () => {
        const flat = SLOT_LAYOUT.flat().filter((s): s is NonNullable<typeof s> => s !== null);
        expect(new Set(flat).size).toBe(SLOTS.length);
        expect(flat.length).toBe(SLOTS.length);
    });
});

describe('SUPPLY_ROWS', () => {
    test('names the six the player asked for', () => {
        expect(SUPPLY_ROWS.map(r => r.label)).toEqual([
            'Food', 'Prayer potion', 'Antipoison', 'Super attack', 'Super strength', 'Super defence'
        ]);
    });
});

describe('wornFromEquipment', () => {
    test('maps each worn item onto the slot the catalog gives it', () => {
        const worn = wornFromEquipment([
            { name: 'Rune scimitar' },
            { name: 'Rune platebody' },
            { name: 'Rune full helm' }
        ]);
        expect(worn).toEqual({
            righthand: 'Rune scimitar',
            torso: 'Rune platebody',
            hat: 'Rune full helm'
        });
    });

    test('is case-insensitive and uses the catalog spelling', () => {
        expect(wornFromEquipment([{ name: 'rune scimitar' }]).righthand).toBe('Rune scimitar');
    });

    test('skips empty slots and anything the catalog does not know', () => {
        expect(wornFromEquipment([{ name: null }, { name: 'Nonsense item' }])).toEqual({});
    });

    test('nothing worn is an empty loadout, not a throw', () => {
        expect(wornFromEquipment([])).toEqual({});
    });
});
