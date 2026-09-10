// Why: kept free of client imports so scripts and tests pull it in without loading the adapter graph.

export type BankCategory =
    | 'coins' | 'runes' | 'staves' | 'ammunition' | 'weapons' | 'armour' | 'rangedArmour'
    | 'food' | 'potions' | 'jewellery' | 'herbs' | 'oresBarsGems' | 'logs' | 'supplies'
    | 'tools' | 'teleports' | 'questLive' | 'questObsolete' | 'junk';

export const CATEGORY_ORDER: readonly BankCategory[] = [
    'coins', 'runes', 'staves', 'ammunition', 'weapons', 'armour', 'rangedArmour',
    'food', 'potions', 'jewellery', 'herbs', 'oresBarsGems', 'logs', 'supplies',
    'tools', 'teleports', 'questLive', 'questObsolete', 'junk'
];

export interface SortableItem {
    slot: number;
    id: number;
    name: string | null;
    cost: number;
}

interface CategoryRule {
    category: BankCategory;
    ids?: readonly number[];
    match?: (name: string) => boolean;
}

const COINS = 995;
const RUNE_IDS = [554, 555, 556, 557, 558, 559, 560, 561, 562, 563, 564, 565, 566, 1436] as const;

const any = (...parts: string[]) => (name: string): boolean => parts.some(p => name.includes(p));

// Why: "ring" sits inside "bow string" and "herring", so the short words need a boundary.
const word = (...parts: string[]) => (name: string): boolean =>
    parts.some(p => new RegExp(`\\b${p}\\b`).test(name));

const RULES: readonly CategoryRule[] = [
    { category: 'coins', ids: [COINS] },
    { category: 'runes', ids: RUNE_IDS },
    { category: 'ammunition', match: any('arrow', 'bolt', 'dart', 'javelin', 'knife', 'knives', 'cannonball') },
    { category: 'teleports', match: any('teleport') },
    { category: 'potions', match: any(
        'potion', 'vial', 'brew', 'antipoison', 'restore', 'antifire',
        'super attack', 'super strength', 'super defence', 'super energy'
    ) },
    { category: 'jewellery', match: any('amulet', 'necklace', 'bracelet') },
    { category: 'jewellery', match: word('ring') },
    { category: 'tools', match: any(
        'pickaxe', 'hatchet', 'hammer', 'chisel', 'tinderbox', 'needle', 'spade', 'rope',
        'harpoon', 'lobster pot', 'fishing rod', 'fishing net', 'bucket', 'jug', 'tiara'
    ) },
    { category: 'tools', match: name => /\baxe$/.test(name) && !name.includes('battleaxe') },
    { category: 'supplies', match: any('bowstring', 'bow string') },
    { category: 'staves', match: any('staff') },
    { category: 'weapons', match: any(
        'scimitar', 'mace', 'dagger', 'battleaxe', 'warhammer',
        'halberd', 'spear', 'crossbow', 'wand', 'claws', 'whip'
    ) },
    // Why: a bare 'sword' also sits inside "Swordfish", which belongs with the rest of the food.
    { category: 'weapons', match: name => /sword(?!fish)/.test(name) },
    // Why: a bare "bow" also sits inside "bowl", so it needs a trailing boundary.
    { category: 'weapons', match: name => /bow\b/.test(name) },
    // Why: worn hide is ranged kit; the raw "Dragonhide", "Leather" and "Hard leather" stay materials.
    { category: 'rangedArmour', match: any(
        'dragonhide body', 'dragonhide chaps', 'dragon vambraces',
        'studded ', 'hardleather', 'leather ', 'coif'
    ) },
    { category: 'armour', match: any(
        'platebody', 'plateskirt', 'platelegs', 'chainbody', 'helm', 'shield', 'boots',
        'gloves', 'gauntlets', 'vambraces', 'chaps', 'cape', 'cloak', 'robe', 'hat',
        'body', 'legs', 'skirt'
    ) },
    { category: 'food', match: any(
        'shark', 'lobster', 'swordfish', 'tuna', 'trout', 'salmon', 'bass', 'pike',
        'shrimps', 'anchovies', 'herring', 'sardine', 'mackerel', 'manta ray',
        'bread', 'cake', 'stew', 'meat', 'chicken', 'kebab', 'wine', 'beer'
    ) },
    { category: 'food', match: word('cod', 'pie') },
    { category: 'herbs', match: any(
        'grimy', 'clean ', 'guam', 'marrentill', 'tarromin', 'harralander', 'ranarr',
        'irit', 'avantoe', 'kwuarm', 'cadantine', 'dwarf weed', 'torstol',
        'lantadyme', 'snapdragon', 'snake weed', 'ardrigal', 'sito foil',
        'volencia moss', 'rogues purse',
        'eye of newt', 'unicorn horn', 'limpwurt', 'snape grass', 'white berries',
        'red spiders', 'chocolate dust', 'toadflax'
    ) },
    // Why: an unidentified herb of any kind is named "Herb", so only bankSortRank's id table tells them apart.
    { category: 'herbs', match: name => name === 'herb' },
    { category: 'oresBarsGems', match: name => name === 'half of a key' || name === 'crystal key' },
    { category: 'oresBarsGems', match: any(
        'sapphire', 'emerald', 'ruby', 'diamond', 'dragonstone',
        'opal', 'jade', 'topaz'
    ) },
    { category: 'oresBarsGems', match: word('ore', 'bar', 'bars', 'coal', 'gem') },
    { category: 'logs', match: any('logs', 'plank') },
    { category: 'supplies', match: any(
        'feather', 'leather', 'hide', 'thread', 'bowstring', 'bow string', 'seed',
        'bait', 'shaft', 'wool', 'flax', 'molten glass', 'soda ash'
    ) },
    // Why: an explicit junk entry is filed junk rather than counted as a rule the table is missing.
    { category: 'junk', ids: [526, 532] }
];

function ruleFor(item: SortableItem): CategoryRule | null {
    const name = (item.name ?? '').toLowerCase();
    for (const rule of RULES) {
        if (rule.ids?.includes(item.id)) {
            return rule;
        }
        if (name.length > 0 && rule.match?.(name)) {
            return rule;
        }
    }

    return null;
}

export function categoryOf(item: SortableItem): BankCategory {
    return ruleFor(item)?.category ?? 'junk';
}

export function isUnmatched(item: SortableItem): boolean {
    return ruleFor(item) === null;
}
