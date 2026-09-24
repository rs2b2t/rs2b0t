export interface MarketSet {
    name: string;
    itemIds: readonly number[];
}

const SETS: Readonly<Record<string, MarketSet>> = {
    rune: { name: 'Rune set', itemIds: [1163, 1127, 1079] },
    adamant: { name: 'Adamant set', itemIds: [1161, 1123, 1073] },
    mithril: { name: 'Mithril set', itemIds: [1159, 1121, 1071] },
    black: { name: 'Black set', itemIds: [1165, 1125, 1077] },
    steel: { name: 'Steel set', itemIds: [1157, 1119, 1069] },
    'black dragonhide': { name: 'Black dragonhide set', itemIds: [2503, 2497, 2491] },
    'red dragonhide': { name: 'Red dragonhide set', itemIds: [2501, 2495, 2489] },
    'blue dragonhide': { name: 'Blue dragonhide set', itemIds: [2499, 2493, 2487] },
    'green dragonhide': { name: 'Green dragonhide set', itemIds: [1135, 1099, 1065] },
    leather: { name: 'Leather set', itemIds: [1129, 1095, 1063] },
    super: { name: 'Super set', itemIds: [157, 145, 163] }
};

export function resolveSet(query: string): MarketSet | null {
    const key = query.toLowerCase().trim().replace(/\s+/g, ' ')
        .replace(/^addy\b/, 'adamant')
        .replace(/^mith\b/, 'mithril')
        .replace(/\bd[' -]?hide\b/, 'dragonhide');
    const match = /^(.+) sets?$/.exec(key);
    return match && Object.hasOwn(SETS, match[1]) ? SETS[match[1]] : null;
}
