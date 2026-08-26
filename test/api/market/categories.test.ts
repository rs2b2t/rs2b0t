import { describe, expect, test } from 'bun:test';

import { categoryOf, CATEGORIES, isPopular, shelves } from '#/bot/api/market/categories.js';
import { buildCatalog } from '#/bot/api/market/catalog.js';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';

function rec(id: number, name: string, over: Partial<ObjRecord> = {}): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, equippable: false, certlink: -1, certtemplate: -1, ...over };
}

const shelf = (name: string, slot?: string, consumable?: string): string =>
    categoryOf({ name, equippable: slot !== undefined }, { slot, consumable });

describe('categoryOf', () => {
    test('the obvious shelves read off the name', () => {
        expect(shelf('Nature rune')).toBe('Runes');
        expect(shelf('Iron ore')).toBe('Ores');
        expect(shelf('Steel bar')).toBe('Bars');
        expect(shelf('Yew logs')).toBe('Logs');
        expect(shelf('Logs')).toBe('Logs');
        expect(shelf('Maple longbow')).toBe('Bows');
        expect(shelf('Rune arrow')).toBe('Arrows');
        expect(shelf('Big bones')).toBe('Bones');
        expect(shelf('Ranarr seed')).toBe('Seeds');
        expect(shelf('Green dragonhide')).toBe('Hides');
    });

    // Why: "Rune scimitar" and "Nature rune" both carry the word, and only the ending tells them apart.
    test('a rune weapon is not a rune', () => {
        expect(shelf('Rune scimitar', 'righthand')).toBe('Weapons');
        expect(shelf('Rune platebody', 'torso')).toBe('Armour');
        expect(shelf('Nature rune')).toBe('Runes');
    });

    test('the one bar you eat is food', () => {
        expect(shelf('Chocolate bar')).toBe('Food');
        expect(shelf('Bronze bar')).toBe('Bars');
    });

    test('bow string and bowl are not bows', () => {
        expect(shelf('Bow string')).not.toBe('Bows');
        expect(shelf('Bowl')).not.toBe('Bows');
        expect(shelf('Shortbow')).toBe('Bows');
    });

    test('potions shelve on their dose suffix as well as the word', () => {
        expect(shelf('Attack potion(3)')).toBe('Potions');
        expect(shelf('Strength potion')).toBe('Potions');
    });

    test('herbs and their secondaries stay apart', () => {
        expect(shelf('Grimy ranarr')).toBe('Herbs');
        expect(shelf('Guam leaf')).toBe('Herbs');
        expect(shelf('Eye of newt')).toBe('Herblore');
        expect(shelf('Vial of water')).toBe('Herblore');
    });

    test('gems shelve cut or uncut', () => {
        expect(shelf('Uncut ruby')).toBe('Gems');
        expect(shelf('Diamond')).toBe('Gems');
    });

    // Why: the stone names the jewellery cut from it, and those belong with the other jewellery.
    test('what a gem is set into is jewellery, not a gem', () => {
        expect(shelf('Sapphire ring', 'ring')).toBe('Jewellery');
        expect(shelf('Diamond amulet', 'front')).toBe('Jewellery');
        expect(shelf('Ruby necklace', 'front')).toBe('Jewellery');
    });

    test('what you eat shelves as food, however it is named', () => {
        expect(shelf('Lobster', undefined, 'eat')).toBe('Food');
        expect(shelf('Raw shrimps')).toBe('Food');
        expect(shelf('Burnt fish')).toBe('Food');
    });

    test('fishing and farming gear is tools, not other', () => {
        expect(shelf('Lobster pot')).toBe('Tools');
        expect(shelf('Fly fishing rod')).toBe('Tools');
        expect(shelf('Tinderbox')).toBe('Tools');
    });

    test('a slot decides what the name cannot', () => {
        expect(shelf('Amulet of strength', 'front')).toBe('Jewellery');
        expect(shelf('Adamant kiteshield', 'lefthand')).toBe('Armour');
        expect(shelf('Mystery thing')).toBe('Other');
    });
});

describe('shelves', () => {
    test('every item lands on exactly one shelf, and notes are left off', () => {
        const cat = buildCatalog([
            rec(440, 'Iron ore'),
            rec(441, 'Iron ore', { stackable: true, certlink: 440, certtemplate: 799 }),
            rec(561, 'Nature rune', { stackable: true }),
            rec(1515, 'Yew logs'),
            rec(9999, 'Mystery thing')
        ]);

        const out = shelves(cat);
        expect(out.get('Ores')?.map(r => r.id)).toEqual([440]);
        expect(out.get('Runes')?.map(r => r.id)).toEqual([561]);
        expect(out.get('Logs')?.map(r => r.id)).toEqual([1515]);
        expect(out.get('Other')?.map(r => r.id)).toEqual([9999]);

        // Why: Popular overlays the others, so only the exclusive shelves add up to the catalogue.
        const exclusive = [...out].filter(([name]) => name !== 'Popular');
        const total = exclusive.reduce((n, [, list]) => n + list.length, 0);
        expect(total).toBe(cat.items.length);
    });

    test('a stackable shows once, not once per pile size', () => {
        const out = shelves(buildCatalog([
            rec(882, 'Bronze arrow', { stackable: true }),
            rec(883, 'Bronze arrow', { stackable: true, stackVariant: true }),
            rec(884, 'Bronze arrow', { stackable: true, stackVariant: true })
        ]));
        expect(out.get('Arrows')?.map(r => r.id)).toEqual([882]);
    });

    test('every shelf is present even when empty, so the list of them is stable', () => {
        const out = shelves(buildCatalog([rec(440, 'Iron ore')]));
        expect([...out.keys()]).toEqual([...CATEGORIES]);
    });
});


describe('the Popular shelf', () => {
    const pop = (name: string, slot?: string): boolean => isPopular({ name, equippable: slot !== undefined }, { slot });

    test('whole shelves people stock by the load are on it', () => {
        expect(pop('Nature rune')).toBe(true);
        expect(pop('Iron ore')).toBe(true);
        expect(pop('Steel bar')).toBe(true);
        expect(pop('Rune arrow')).toBe(true);
        expect(pop('Grimy ranarr')).toBe(true);
        expect(pop('Uncut ruby')).toBe(true);
    });

    test('the named stock is on it', () => {
        for (const name of ['Rune platebody', 'Rune scimitar', 'Lobster', 'Raw shark', 'Feather', 'Flax', 'Bow string', 'Rune essence', 'Crystal key', 'Half of a key', 'Amulet of glory(4)']) {
            expect(pop(name)).toBe(true);
        }
    });

    // Why: the 3-dose is the one that trades, so the others stay addable by hand instead of filling the shelf.
    test('potions are the 3-dose only', () => {
        expect(pop('Super attack(3)')).toBe(true);
        expect(pop('Prayer potion(3)')).toBe(true);
        expect(pop('Superantipoison(3)')).toBe(true);
        expect(pop('Super attack(4)')).toBe(false);
        expect(pop('Prayer potion(1)')).toBe(false);
    });

    // Why: "arrows" means the metal line people buy by the thousand, not everything the shelf holds.
    test('only the standard arrows ride in on the ammunition, not the rest of the shelf', () => {
        expect(pop('Rune arrow')).toBe(true);
        expect(pop('Bronze arrow')).toBe(true);
        expect(pop('Barbed bolts')).toBe(false);
        expect(pop('Black dart')).toBe(false);
        expect(pop('Rune javelin')).toBe(false);
        expect(pop('Rune arrowtips')).toBe(false);
        expect(pop('Arrow shaft')).toBe(false);
    });

    test('a gem is popular but a ring cut from one is not', () => {
        expect(pop('Uncut ruby')).toBe(true);
        expect(pop('Ruby ring', 'ring')).toBe(false);
    });

    test('everything else is left off', () => {
        expect(pop('Yew logs')).toBe(false);
        expect(pop('Adamant platebody', 'torso')).toBe(false);
        expect(pop('Swamp tar')).toBe(false);
    });

    test('an item on Popular keeps the shelf it belongs to', () => {
        const out = shelves(buildCatalog([rec(561, 'Nature rune', { stackable: true })]));
        expect(out.get('Runes')?.map(r => r.id)).toEqual([561]);
        expect(out.get('Popular')?.map(r => r.id)).toEqual([561]);
    });
});
