export interface PackItem {
    readonly name: string | null;
    readonly count: number;
}

export const PRODUCT_OPTIONS = [
    'Dagger',
    'Sword',
    'Scimitar',
    'Longsword',
    '2h sword',
    'Axe',
    'Mace',
    'Warhammer',
    'Battleaxe',
    'Chainbody',
    'Platelegs',
    'Plateskirt',
    'Platebody',
    'Med helm',
    'Full helm',
    'Sq shield',
    'Kiteshield',
    'Nails',
    'Dart tip',
    'Arrowtips',
    'Knife',
    'Wire',
    'Claws'
];

// Lost City 274 smithing.dbrow bar_amount — same for every metal. No 4-bar item.
const BAR_COSTS: readonly { keyword: string; bars: number }[] = [
    { keyword: 'plateskirt', bars: 3 },
    { keyword: 'kiteshield', bars: 3 },
    { keyword: 'chainbody', bars: 3 },
    { keyword: 'platelegs', bars: 3 },
    { keyword: 'warhammer', bars: 3 },
    { keyword: 'battleaxe', bars: 3 },
    { keyword: 'platebody', bars: 5 },
    { keyword: 'longsword', bars: 2 },
    { keyword: 'full helm', bars: 2 },
    { keyword: 'sq shield', bars: 2 },
    { keyword: 'scimitar', bars: 2 },
    { keyword: '2h sword', bars: 3 },
    { keyword: 'arrowtips', bars: 1 },
    { keyword: 'dart tip', bars: 1 },
    { keyword: 'med helm', bars: 1 },
    { keyword: 'dagger', bars: 1 },
    { keyword: 'claws', bars: 2 },
    { keyword: 'nails', bars: 1 },
    { keyword: 'knife', bars: 1 },
    { keyword: 'sword', bars: 1 },
    { keyword: 'mace', bars: 1 },
    { keyword: 'wire', bars: 1 },
    { keyword: 'axe', bars: 1 }
].slice().sort((a, b) => b.keyword.length - a.keyword.length);

/** Bar cost of the chosen product. Unknown names cost 1 so we never invent a recipe. */
export function barsFor(product: string): number {
    const hay = product.trim().toLowerCase();
    for (const { keyword, bars } of BAR_COSTS) {
        if (hay.includes(keyword)) {
            return bars;
        }
    }
    return 1;
}

export function canSmith(barCount: number, product: string): boolean {
    return barCount >= barsFor(product);
}

export function countBars(items: readonly PackItem[], barItemName: string): number {
    const pat = barItemName.toLowerCase();
    return items
        .filter(i => i.name?.toLowerCase().includes(pat))
        .reduce((n, i) => n + Math.max(1, i.count), 0);
}
