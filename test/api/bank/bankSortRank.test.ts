import { describe, expect, test } from 'bun:test';

import { rankWithin, UNRANKED } from '#/bot/api/bank/bankSortRank.js';
import type { BankCategory, SortableItem } from '#/bot/api/bank/bankSortRules.js';

function item(name: string | null, id = 1): SortableItem {
    return { slot: 0, id, name, cost: 1 };
}

/** Asserts the names rank strictly ascending in the order given, and that none of them fell through. */
function ascending(category: BankCategory, names: readonly string[]): void {
    const ranks = names.map(name => rankWithin(category, item(name)));
    const gaps = names.flatMap((name, i) =>
        i > 0 && ranks[i - 1] >= ranks[i] ? [`${names[i - 1]} (${ranks[i - 1]}) >= ${name} (${ranks[i]})`] : []);
    expect({ category, gaps, fellThrough: names.filter((_, i) => ranks[i] === UNRANKED) })
        .toEqual({ category, gaps: [], fellThrough: [] });
}

describe('rankWithin', () => {
    test('ores run copper to rune, with coal at its mining level', () => {
        ascending('oresBarsGems', [
            'Copper ore', 'Tin ore', 'Iron ore', 'Silver ore', 'Coal',
            'Gold ore', 'Mithril ore', 'Adamantite ore', 'Runite ore'
        ]);
    });

    test('bars run bronze to rune, with silver at its smithing level', () => {
        ascending('oresBarsGems', [
            'Bronze bar', 'Iron bar', 'Silver bar', 'Steel bar',
            'Gold bar', 'Mithril bar', 'Adamantite bar', 'Runite bar'
        ]);
    });

    test('every ore outranks every bar', () => {
        expect(rankWithin('oresBarsGems', item('Runite ore')))
            .toBeLessThan(rankWithin('oresBarsGems', item('Bronze bar')));
    });

    test('keys head the gem block, cut gems follow, uncut gems last', () => {
        ascending('oresBarsGems', [
            'Half of a key', 'Crystal key',
            'Dragonstone', 'Diamond', 'Ruby', 'Emerald', 'Sapphire',
            'Uncut dragonstone', 'Uncut diamond', 'Uncut ruby', 'Uncut emerald', 'Uncut sapphire'
        ]);
    });

    test('bars come before the keys and gems', () => {
        expect(rankWithin('oresBarsGems', item('Runite bar')))
            .toBeLessThan(rankWithin('oresBarsGems', item('Half of a key')));
    });

    test('a gem the table does not name is unranked', () => {
        expect(rankWithin('oresBarsGems', item('Uncut opal'))).toBe(UNRANKED);
        expect(rankWithin('oresBarsGems', item('Jade'))).toBe(UNRANKED);
    });

    test('weapons run dragon down to bronze', () => {
        ascending('weapons', [
            'Dragon dagger', 'Rune scimitar', 'Adamant scimitar', 'Mithril scimitar',
            'Black scimitar', 'Steel scimitar', 'Iron scimitar', 'Bronze scimitar'
        ]);
    });

    test('bows run magic down to plain, longbow before shortbow', () => {
        ascending('weapons', [
            'Magic longbow', 'Magic shortbow', 'Yew longbow', 'Yew shortbow',
            'Maple longbow', 'Maple shortbow', 'Willow longbow', 'Willow shortbow',
            'Oak longbow', 'Oak shortbow', 'Longbow', 'Shortbow'
        ]);
    });

    test('every metal weapon outranks every bow', () => {
        expect(rankWithin('weapons', item('Bronze scimitar')))
            .toBeLessThan(rankWithin('weapons', item('Magic longbow')));
    });

    test('a weapon with no tier in its name is unranked', () => {
        expect(rankWithin('weapons', item('Abyssal whip'))).toBe(UNRANKED);
        expect(rankWithin('weapons', item('Staff of air'))).toBe(UNRANKED);
    });

    test('arrows run rune down to bronze', () => {
        ascending('ammunition', [
            'Rune arrow', 'Adamant arrow', 'Mithril arrow',
            'Steel arrow', 'Iron arrow', 'Bronze arrow'
        ]);
    });

    test('ammunition the table does not name is unranked', () => {
        expect(rankWithin('ammunition', item('Ice arrow'))).toBe(UNRANKED);
        expect(rankWithin('ammunition', item('Ogre arrow'))).toBe(UNRANKED);
    });

    test('runes run combat, then utility, then elemental', () => {
        ascending('runes', [
            'Blood rune', 'Death rune', 'Soul rune', 'Chaos rune', 'Mind rune', 'Body rune',
            'Nature rune', 'Cosmic rune', 'Law rune',
            'Air rune', 'Earth rune', 'Water rune', 'Fire rune',
            'Rune essence'
        ]);
    });

    test('logs run in woodcutting order', () => {
        ascending('logs', [
            'Logs', 'Achey tree logs', 'Oak logs', 'Willow logs',
            'Maple logs', 'Yew logs', 'Magic logs'
        ]);
    });

    test('a plank is not a log the table names', () => {
        expect(rankWithin('logs', item('Plank'))).toBe(UNRANKED);
    });

    test('clean herbs run in identify order', () => {
        ascending('herbs', [
            'Guam leaf', 'Snake weed', 'Ardrigal', 'Sito foil', 'Volencia moss', 'Rogues purse',
            'Marrentill', 'Tarromin', 'Harralander', 'Ranarr weed', 'Toadflax', 'Irit leaf',
            'Avantoe', 'Kwuarm', 'Snapdragon', 'Cadantine', 'Lantadyme', 'Dwarf weed', 'Torstol'
        ]);
    });

    test('unidentified herbs are ranked by id, because every one of them is named Herb', () => {
        const unids: [string, number][] = [
            ['guam', 199], ['snake weed', 1525], ['marrentill', 201], ['ranarr', 207],
            ['toadflax', 3049], ['irit', 209], ['snapdragon', 3051], ['cadantine', 215],
            ['lantadyme', 2485], ['torstol', 219]
        ];
        const ranks = unids.map(([, id]) => rankWithin('herbs', item('Herb', id)));
        for (let i = 1; i < ranks.length; i++) {
            if (ranks[i - 1] >= ranks[i]) {
                throw new Error(`unid ${unids[i - 1][0]} (${ranks[i - 1]}) should rank before ${unids[i][0]} (${ranks[i]})`);
            }
        }
    });

    test('a noted unidentified herb ranks with its unnoted twin', () => {
        expect(rankWithin('herbs', item('Herb', 200))).toBe(rankWithin('herbs', item('Herb', 199)));
        expect(rankWithin('herbs', item('Herb', 2486))).toBe(rankWithin('herbs', item('Herb', 2485)));
    });

    test('every clean herb outranks every unidentified one', () => {
        expect(rankWithin('herbs', item('Torstol')))
            .toBeLessThan(rankWithin('herbs', item('Herb', 199)));
    });

    test('a category with no table ranks everything the same', () => {
        expect(rankWithin('supplies', item('Feather'))).toBe(UNRANKED);
        expect(rankWithin('tools', item('Rune pickaxe'))).toBe(UNRANKED);
        expect(rankWithin('junk', item('Bones'))).toBe(UNRANKED);
    });

    test('a null name never throws', () => {
        expect(rankWithin('runes', item(null, 4242))).toBe(UNRANKED);
        expect(rankWithin('food', item(null, 4242))).toBe(UNRANKED);
        expect(rankWithin('potions', item(null, 4242))).toBe(UNRANKED);
        expect(rankWithin('rangedArmour', item(null, 4242))).toBe(UNRANKED);
    });

    test('a noted item ranks with its unnoted twin, because they share a name', () => {
        expect(rankWithin('oresBarsGems', item('Copper ore', 437)))
            .toBe(rankWithin('oresBarsGems', item('Copper ore', 436)));
    });
});
describe('rankWithin, tiers added for the second pass', () => {
    test('arrows and arrowtips form separate blocks instead of sharing ranks', () => {
        ascending('ammunition', [
            'Rune arrow', 'Adamant arrow', 'Mithril arrow', 'Steel arrow', 'Iron arrow', 'Bronze arrow',
            'Rune arrowtips', 'Adamant arrowtips', 'Mithril arrowtips',
            'Steel arrowtips', 'Iron arrowtips', 'Bronze arrowtips'
        ]);
    });

    test('a poisoned arrow ranks with its plain twin, an arrowtip does not', () => {
        expect(rankWithin('ammunition', item('Bronze arrow(p)')))
            .toBe(rankWithin('ammunition', item('Bronze arrow')));
        expect(rankWithin('ammunition', item('Bronze arrowtips')))
            .not.toBe(rankWithin('ammunition', item('Bronze arrow')));
    });

    test('bolts, darts, dart tips, javelins, knives and thrownaxes each get their own block', () => {
        ascending('ammunition', [
            'Rune arrow', 'Rune arrowtips', 'Headless arrow',
            'Barbed bolts', 'Bolts', 'Opal bolttips',
            'Rune dart', 'Bronze dart', 'Rune dart tip', 'Bronze dart tip',
            'Rune javelin', 'Rune knife', 'Rune thrownaxe', 'Cannonball'
        ]);
    });

    test('a dart tip does not steal the dart rank', () => {
        expect(rankWithin('ammunition', item('Rune dart')))
            .toBeLessThan(rankWithin('ammunition', item('Bronze dart')));
        expect(rankWithin('ammunition', item('Bronze dart')))
            .toBeLessThan(rankWithin('ammunition', item('Rune dart tip')));
    });

    test('food runs best first by cooking level, raw behind cooked, burnt last', () => {
        ascending('food', [
            'Manta ray', 'Shark', 'Swordfish', 'Bass', 'Lobster', 'Tuna', 'Salmon', 'Pike',
            'Cod', 'Trout', 'Mackerel', 'Herring', 'Sardine', 'Anchovies', 'Shrimps',
            'Cake', 'Meat pie', 'Stew', 'Bread', 'Cooked chicken', 'Cooked meat',
            'Raw shark', 'Raw lobster', 'Burnt shark'
        ]);
    });

    test('a meat pie is not filed as meat', () => {
        expect(rankWithin('food', item('Meat pie')))
            .toBeLessThan(rankWithin('food', item('Cooked meat')));
    });

    test('potions keep their doses together, strongest dose first', () => {
        ascending('potions', [
            'Super attack(4)', 'Super attack(3)', 'Super attack(2)', 'Super attack(1)',
            'Super strength(4)', 'Super defence(4)',
            'Attack potion(4)', 'Attack potion(1)', 'Strength potion(4)', 'Defence potion(3)',
            'Ranging potion(4)', 'Magic potion(4)', 'Zamorak potion(4)', 'Prayer potion(4)',
            'Super restore(4)', 'Restore potion(4)', 'Superantipoison(4)', 'Antipoison(4)',
            'Antifire potion(4)', 'Super energy(4)', 'Energy potion(4)',
            'Agility potion(4)', 'Fishing potion(4)'
        ]);
    });

    test('an undosed potion item is unranked rather than mis-dosed', () => {
        expect(rankWithin('potions', item('Vial'))).toBe(UNRANKED);
        expect(rankWithin('potions', item('Vial of water'))).toBe(UNRANKED);
    });

    test('melee armour runs dragon to bronze', () => {
        ascending('armour', [
            'Dragon platebody', 'Rune platebody', 'Adamant platebody', 'Mithril platebody',
            'Black platebody', 'Steel platebody', 'Iron platebody', 'Bronze platebody'
        ]);
    });

    test('dragonhide runs black to green by id, because all four colours share one name', () => {
        const body: [string, number][] = [['black', 2503], ['red', 2501], ['blue', 2499], ['green', 1135]];
        const ranks = body.map(([, id]) => rankWithin('rangedArmour', item('Dragonhide body', id)));
        const gaps = body.flatMap(([colour], i) =>
            i > 0 && ranks[i - 1] >= ranks[i] ? [`${body[i - 1][0]} >= ${colour}`] : []);
        expect(gaps).toEqual([]);
    });

    test('a noted dragonhide body ranks with its unnoted twin', () => {
        expect(rankWithin('rangedArmour', item('Dragonhide body', 2504)))
            .toBe(rankWithin('rangedArmour', item('Dragonhide body', 2503)));
    });

    test('dragonhide outranks studded, which outranks leather', () => {
        expect(rankWithin('rangedArmour', item('Dragonhide chaps', 2497)))
            .toBeLessThan(rankWithin('rangedArmour', item('Studded body')));
        expect(rankWithin('rangedArmour', item('Studded body')))
            .toBeLessThan(rankWithin('rangedArmour', item('Leather body')));
    });

    test('staves run mystic, battlestaff, god, elemental, then plain', () => {
        ascending('staves', [
            'Mystic lava staff', 'Mystic fire staff', 'Mystic air staff',
            'Lava battlestaff', 'Fire battlestaff', 'Air battlestaff', 'Battlestaff',
            'Staff of saradomin', 'Staff of iban',
            'Staff of fire', 'Staff of air', 'Magic staff', 'Dramen staff', 'Staff'
        ]);
    });
});
