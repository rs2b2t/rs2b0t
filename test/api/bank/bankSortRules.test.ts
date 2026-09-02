import { describe, expect, test } from 'bun:test';

import { CATEGORY_ORDER, categoryOf, isUnmatched, type SortableItem } from '#/bot/api/bank/bankSortRules.js';

function item(id: number, name: string, cost = 1): SortableItem {
    return { slot: 0, id, name, cost };
}

describe('categoryOf', () => {
    test('coins are matched by id, never by name', () => {
        expect(categoryOf(item(995, 'Coins'))).toBe('coins');
        expect(categoryOf(item(617, 'Coins'))).not.toBe('coins');
    });

    test('runes are matched by id', () => {
        for (const id of [554, 555, 556, 557, 558, 559, 560, 561, 562, 563, 564, 565, 566, 1436]) {
            expect(categoryOf(item(id, 'whatever'))).toBe('runes');
        }
    });

    test('ammunition beats the weapon rule for arrows', () => {
        expect(categoryOf(item(892, 'Rune arrow'))).toBe('ammunition');
        expect(categoryOf(item(9143, 'Mithril bolts'))).toBe('ammunition');
        expect(categoryOf(item(811, 'Rune dart'))).toBe('ammunition');
        expect(categoryOf(item(868, 'Rune knife'))).toBe('ammunition');
    });

    test('weapons and armour split', () => {
        expect(categoryOf(item(1333, 'Rune scimitar'))).toBe('weapons');
        expect(categoryOf(item(861, 'Magic shortbow'))).toBe('weapons');
        expect(categoryOf(item(1127, 'Rune platebody'))).toBe('armour');
        expect(categoryOf(item(1201, 'Rune kiteshield'))).toBe('armour');
        expect(categoryOf(item(1163, 'Rune full helm'))).toBe('armour');
    });

    test('an unidentified herb is a herb, even though every one of them is named Herb', () => {
        expect(categoryOf(item(199, 'Herb'))).toBe('herbs');
        expect(isUnmatched(item(199, 'Herb'))).toBe(false);
        expect(categoryOf(item(3049, 'Herb'))).toBe('herbs');
    });

    test('the herbs the table used to miss', () => {
        for (const name of ['Lantadyme', 'Snapdragon', 'Snake weed', 'Ardrigal', 'Sito foil', 'Volencia moss', 'Rogues purse']) {
            expect({ name, category: categoryOf(item(1, name)) }).toEqual({ name, category: 'herbs' });
        }
    });

    test('keys that open a dragonstone chest file with the gems', () => {
        expect(categoryOf(item(985, 'Half of a key'))).toBe('oresBarsGems');
        expect(categoryOf(item(989, 'Crystal key'))).toBe('oresBarsGems');
        expect(isUnmatched(item(989, 'Crystal key'))).toBe(false);
    });

    test('a quest key is still junk, not a gem', () => {
        expect(categoryOf(item(432, 'Chest key'))).toBe('junk');
        expect(categoryOf(item(1590, 'Dusty key'))).toBe('junk');
    });

    test('food, potions and herbs', () => {
        expect(categoryOf(item(385, 'Shark'))).toBe('food');
        expect(categoryOf(item(379, 'Lobster'))).toBe('food');
        expect(categoryOf(item(2434, 'Prayer potion(4)'))).toBe('potions');
        expect(categoryOf(item(229, 'Vial'))).toBe('potions');
        expect(categoryOf(item(207, 'Grimy ranarr weed'))).toBe('herbs');
        expect(categoryOf(item(261, 'Clean ranarr weed'))).toBe('herbs');
    });

    test('a swordfish is food, not a sword', () => {
        expect(categoryOf(item(371, 'Swordfish'))).toBe('food');
        expect(categoryOf(item(373, 'Raw swordfish'))).toBe('food');
        expect(categoryOf(item(1289, 'Rune longsword'))).toBe('weapons');
        expect(categoryOf(item(1319, 'Rune 2h sword'))).toBe('weapons');
    });

    test('every dosed potion in the game files as a potion', () => {
        const bases = [
            'Super attack', 'Super strength', 'Super defence', 'Super energy', 'Super restore',
            'Attack potion', 'Strength potion', 'Defence potion', 'Ranging potion', 'Magic potion',
            'Prayer potion', 'Restore potion', 'Zamorak potion', 'Antipoison', 'Superantipoison',
            'Antifire potion', 'Energy potion', 'Agility potion', 'Fishing potion'
        ];
        const strays = bases.flatMap(base => [4, 3, 2, 1]
            .map(dose => `${base}(${dose})`)
            .filter(name => categoryOf(item(1, name)) !== 'potions'));
        expect(strays).toEqual([]);
    });

    test('every cooked fish files as food', () => {
        const fish = [
            'Manta ray', 'Shark', 'Swordfish', 'Bass', 'Lobster', 'Tuna', 'Salmon',
            'Pike', 'Cod', 'Trout', 'Mackerel', 'Herring', 'Sardine', 'Anchovies', 'Shrimps'
        ];
        const strays = fish.filter(name => categoryOf(item(1, name)) !== 'food');
        expect(strays).toEqual([]);
    });

    test('staves file apart from weapons', () => {
        for (const name of ['Staff', 'Magic staff', 'Staff of air', 'Battlestaff', 'Fire battlestaff', 'Mystic fire staff', 'Staff of iban']) {
            expect({ name, category: categoryOf(item(1, name)) }).toEqual({ name, category: 'staves' });
        }
        expect(categoryOf(item(1333, 'Rune scimitar'))).toBe('weapons');
    });

    test('dragonhide files apart from melee armour, raw hide stays a supply', () => {
        for (const name of ['Dragonhide body', 'Dragonhide chaps', 'Dragon vambraces', 'Studded body', 'Leather body', 'Coif']) {
            expect({ name, category: categoryOf(item(1, name)) }).toEqual({ name, category: 'rangedArmour' });
        }
        expect(categoryOf(item(1127, 'Rune platebody'))).toBe('armour');
        expect(categoryOf(item(1747, 'Dragonhide'))).toBe('supplies');
        expect(categoryOf(item(1741, 'Leather'))).toBe('supplies');
        expect(categoryOf(item(1743, 'Hard leather'))).toBe('supplies');
    });

    test('materials, logs, supplies and tools', () => {
        expect(categoryOf(item(447, 'Mithril ore'))).toBe('oresBarsGems');
        expect(categoryOf(item(2361, 'Adamantite bar'))).toBe('oresBarsGems');
        expect(categoryOf(item(1615, 'Uncut dragonstone'))).toBe('oresBarsGems');
        expect(categoryOf(item(1513, 'Magic logs'))).toBe('logs');
        expect(categoryOf(item(314, 'Feather'))).toBe('supplies');
        expect(categoryOf(item(1747, 'Black dragonhide'))).toBe('supplies');
        expect(categoryOf(item(1359, 'Rune axe'))).toBe('tools');
        expect(categoryOf(item(1275, 'Rune pickaxe'))).toBe('tools');
        expect(categoryOf(item(590, 'Tinderbox'))).toBe('tools');
    });

    test('a bowstring is a supply, not a bow', () => {
        expect(categoryOf(item(1777, 'Bow string'))).toBe('supplies');
        expect(categoryOf(item(1779, 'Bowstring'))).toBe('supplies');
        expect(categoryOf(item(841, 'Shortbow'))).toBe('weapons');
    });

    test('a topaz is a gem, not a top', () => {
        expect(categoryOf(item(1613, 'Uncut topaz'))).toBe('oresBarsGems');
    });

    test('hide armour is armour, raw hide is a supply', () => {
        expect(categoryOf(item(1129, 'Leather body'))).toBe('rangedArmour');
        expect(categoryOf(item(1095, 'Leather chaps'))).toBe('rangedArmour');
        expect(categoryOf(item(1741, 'Cowhide'))).toBe('supplies');
    });

    test('short material words do not match inside longer ones', () => {
        expect(categoryOf(item(440, 'Iron ore'))).toBe('oresBarsGems');
        expect(categoryOf(item(2349, 'Bronze bar'))).toBe('oresBarsGems');
        expect(categoryOf(item(453, 'Coal'))).toBe('oresBarsGems');
        expect(categoryOf(item(1, 'Storeroom key'))).toBe('junk');
        expect(categoryOf(item(2, 'Barrel'))).toBe('junk');
        expect(categoryOf(item(3, 'Barcrawl card'))).toBe('junk');
    });

    test('a bowl is not a bow', () => {
        expect(categoryOf(item(4, 'Golden bowl'))).toBe('junk');
        expect(categoryOf(item(841, 'Shortbow'))).toBe('weapons');
        expect(categoryOf(item(837, 'Crossbow'))).toBe('weapons');
    });

    test('cannonballs are ammunition', () => {
        expect(categoryOf(item(2, 'Cannonball'))).toBe('ammunition');
    });

    test('a lobster pot is a tool, a lobster is food', () => {
        expect(categoryOf(item(301, 'Lobster pot'))).toBe('tools');
        expect(categoryOf(item(379, 'Lobster'))).toBe('food');
    });

    test('jewellery', () => {
        expect(categoryOf(item(1712, 'Amulet of glory'))).toBe('jewellery');
        expect(categoryOf(item(2552, 'Ring of dueling(8)'))).toBe('jewellery');
    });

    test('anything no rule matches falls to junk and is flagged', () => {
        const stray = item(31337, 'Some unheard of thing');
        expect(categoryOf(stray)).toBe('junk');
        expect(isUnmatched(stray)).toBe(true);
    });

    test('an explicit junk entry is junk but is not unmatched', () => {
        const bones = item(526, 'Bones');
        expect(categoryOf(bones)).toBe('junk');
        expect(isUnmatched(bones)).toBe(false);
    });

    test('a null name never throws', () => {
        expect(categoryOf({ slot: 0, id: 4242, name: null, cost: 0 })).toBe('junk');
    });

    test('CATEGORY_ORDER lists every category exactly once, coins first and junk last', () => {
        expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length);
        expect(CATEGORY_ORDER.length).toBe(19);
        expect(CATEGORY_ORDER[0]).toBe('coins');
        expect(CATEGORY_ORDER[CATEGORY_ORDER.length - 1]).toBe('junk');
    });
});
