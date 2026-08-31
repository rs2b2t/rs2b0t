// Why: kept free of client imports so scripts and tests pull it in without loading the adapter graph.

import type { BankCategory, SortableItem } from './bankSortRules.js';

export const UNRANKED = 9999;

const METALS = ['dragon', 'rune', 'adamant', 'mithril', 'black', 'steel', 'iron', 'bronze'];
const family = (suffix: string): string[] => METALS.map(metal => `${metal} ${suffix}`);

const ORES = [
    'copper ore', 'tin ore', 'iron ore', 'silver ore', 'coal',
    'gold ore', 'mithril ore', 'adamantite ore', 'runite ore'
];

const BARS = [
    'bronze bar', 'iron bar', 'silver bar', 'steel bar',
    'gold bar', 'mithril bar', 'adamantite bar', 'runite bar'
];

const KEYS = ['half of a key', 'crystal key'];
const GEMS = ['dragonstone', 'diamond', 'ruby', 'emerald', 'sapphire'];

const BOW_WOODS = ['magic ', 'yew ', 'maple ', 'willow ', 'oak ', ''];
const BOWS = BOW_WOODS.flatMap(wood => [`${wood}longbow`, `${wood}shortbow`]);

const AMMUNITION = [
    ...family('arrow'),
    ...family('arrowtips'),
    'headless arrow',
    'barbed bolts', 'pearl bolts', 'opal bolts', 'bolts',
    'barb bolttips', 'pearl bolttips', 'opal bolttips',
    ...family('dart'),
    ...family('dart tip'),
    ...family('javelin'),
    ...family('knife'),
    ...family('thrownaxe'),
    'cannonball'
];

const STAVES = [
    'mystic lava staff', 'mystic fire staff', 'mystic water staff',
    'mystic earth staff', 'mystic air staff',
    'lava battlestaff', 'fire battlestaff', 'water battlestaff',
    'earth battlestaff', 'air battlestaff', 'battlestaff',
    'staff of saradomin', 'staff of guthix', 'staff of zamorak', 'staff of iban',
    'staff of fire', 'staff of water', 'staff of earth', 'staff of air',
    'magic staff', 'dramen staff', 'staff'
];

const RUNES = [
    'blood rune', 'death rune', 'soul rune', 'chaos rune', 'mind rune', 'body rune',
    'nature rune', 'cosmic rune', 'law rune',
    'air rune', 'earth rune', 'water rune', 'fire rune',
    'rune essence'
];

const LOGS = ['logs', 'achey tree logs', 'oak logs', 'willow logs', 'maple logs', 'yew logs', 'magic logs'];

const HERBS = [
    'guam leaf', 'snake weed', 'ardrigal', 'sito foil', 'volencia moss', 'rogues purse',
    'marrentill', 'tarromin', 'harralander', 'ranarr weed', 'toadflax', 'irit leaf',
    'avantoe', 'kwuarm', 'snapdragon', 'cadantine', 'lantadyme', 'dwarf weed', 'torstol'
];

// Why: every unidentified herb is named "Herb", so only the id says which. Karamja's five have no noted form.
const UNID_HERB_IDS: readonly (readonly [string, ...number[]])[] = [
    ['guam leaf', 199, 200], ['snake weed', 1525], ['ardrigal', 1527], ['sito foil', 1529],
    ['volencia moss', 1531], ['rogues purse', 1533], ['marrentill', 201, 202], ['tarromin', 203, 204],
    ['harralander', 205, 206], ['ranarr weed', 207, 208], ['toadflax', 3049, 3050], ['irit leaf', 209, 210],
    ['avantoe', 211, 212], ['kwuarm', 213, 214], ['snapdragon', 3051, 3052], ['cadantine', 215, 216],
    ['lantadyme', 2485, 2486], ['dwarf weed', 217, 218], ['torstol', 219, 220]
];

const UNID_HERB_RANK = new Map<number, number>(
    UNID_HERB_IDS.flatMap(([herb, ...ids]) => ids.map(id => [id, HERBS.length + HERBS.indexOf(herb)] as const))
);

// Why: green, blue, red and black hide armour all read back as one name, so the colour is only in the id.
const DHIDE_IDS: readonly (readonly number[])[] = [
    [2503, 2501, 2499, 1135],
    [2497, 2495, 2493, 1099],
    [2491, 2489, 2487, 1065]
];

const DHIDE_RANK = new Map<number, number>(
    DHIDE_IDS.flatMap((piece, slot) => piece.flatMap((id, colour) =>
        [[id, slot * piece.length + colour], [id + 1, slot * piece.length + colour]] as const))
);

const DHIDE_RANKS = DHIDE_IDS.length * DHIDE_IDS[0].length;

const RANGED_ARMOUR = [
    'dragonhide body', 'dragonhide chaps', 'dragon vambraces',
    'studded body', 'studded chaps', 'hardleather body',
    'leather body', 'leather chaps', 'leather vambraces', 'leather gloves', 'leather boots',
    'coif', 'leather cowl'
];

const FOOD = [
    'manta ray', 'shark', 'swordfish', 'bass', 'lobster', 'tuna', 'salmon', 'pike',
    'cod', 'trout', 'mackerel', 'herring', 'sardine', 'anchovies', 'shrimps',
    'chocolate cake', 'cake', 'meat pie', 'apple pie', 'redberry pie', 'stew',
    'pitta bread', 'bread', 'chicken', 'meat', 'ugthanki kebab', 'kebab', 'jug of wine', 'beer'
];

const POTIONS = [
    'super attack', 'super strength', 'super defence',
    'attack potion', 'strength potion', 'defence potion',
    'ranging potion', 'magic potion', 'zamorak potion', 'prayer potion',
    'super restore', 'restore potion', 'superantipoison', 'antipoison', 'antifire potion',
    'super energy', 'energy potion', 'agility potion', 'fishing potion'
];

const DOSES = 4;
const COOKING_STATES = [['', 0], ['raw ', 1], ['burnt ', 2], ['cooked ', 0]] as const;

/** Each list is the category's layout top to bottom. */
const NAME_ORDER: Partial<Record<BankCategory, readonly string[]>> = {
    oresBarsGems: [...ORES, ...BARS, ...KEYS, ...GEMS, ...GEMS.map(gem => `uncut ${gem}`)],
    staves: STAVES,
    ammunition: AMMUNITION,
    weapons: [...METALS, ...BOWS],
    armour: METALS,
    rangedArmour: RANGED_ARMOUR,
    runes: RUNES,
    logs: LOGS,
    herbs: HERBS
};

/** Exact name first, then a prefix that ends on a word boundary, so "Bronze arrowtips" never picks up the "bronze arrow" rank. */
function tableRank(order: readonly string[], name: string): number {
    const exact = order.indexOf(name);
    if (exact >= 0) {
        return exact;
    }

    const prefixed = order.findIndex(entry => name.startsWith(`${entry} `) || name.startsWith(`${entry}(`));
    return prefixed < 0 ? UNRANKED : prefixed;
}

function foodRank(name: string): number {
    const [prefix, block] = COOKING_STATES.find(([state]) => state !== '' && name.startsWith(state)) ?? ['', 0];
    const rank = tableRank(FOOD, name.slice(prefix.length));
    return rank === UNRANKED ? UNRANKED : rank + block * FOOD.length;
}

function potionRank(name: string): number {
    const dosed = /^(.*)\((\d)\)$/.exec(name);
    const potion = dosed ? POTIONS.indexOf(dosed[1]) : -1;
    return potion < 0 ? UNRANKED : potion * DOSES + (DOSES - Number(dosed![2]));
}

/** Position within a category, lower first. Anything the tables miss sorts behind everything they name. */
export function rankWithin(category: BankCategory, item: SortableItem): number {
    const byId = category === 'herbs' ? UNID_HERB_RANK.get(item.id)
        : category === 'rangedArmour' ? DHIDE_RANK.get(item.id)
            : undefined;
    if (byId !== undefined) {
        return byId;
    }

    const name = (item.name ?? '').toLowerCase();
    if (name.length === 0) {
        return UNRANKED;
    }
    if (category === 'food') {
        return foodRank(name);
    }
    if (category === 'potions') {
        return potionRank(name);
    }

    const order = NAME_ORDER[category];
    if (!order) {
        return UNRANKED;
    }

    const rank = tableRank(order, name);
    // Why: hide armour ranks by id above, so the name table has to start past that block.
    return category === 'rangedArmour' && rank !== UNRANKED ? rank + DHIDE_RANKS : rank;
}
