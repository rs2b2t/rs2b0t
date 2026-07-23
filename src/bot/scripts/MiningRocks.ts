export const ROCK_TYPES: Record<string, number[]> = {
    Clay: [2108, 2109],
    Copper: [2090, 2091],
    Tin: [2094, 2095],
    Iron: [2092, 2093],
    Silver: [2100, 2101],
    Coal: [2096, 2097],
    Gold: [2098, 2099],
    Mithril: [2102, 2103],
    Adamantite: [2104, 2105],
    Runite: [2106, 2107]
};

export const ROCK_OPTIONS = Object.keys(ROCK_TYPES);

export const GAS_ROCK_IDS: Set<number> = new Set([
    2119, 2120,
    2121, 2122,
    2123, 2124,
    2125, 2126,
    2127, 2128,
    2129, 2130,
    2131, 2132,
    2133, 2134,
    2135, 2136,
    2137, 2138,
    2139
]);

export const GAS_ROCK_TICKS = 60;

export const BROKEN_PICKAXE = 'Broken pickaxe';

export const PICKAXES: readonly { name: string; level: number }[] = [
    { name: 'Rune pickaxe', level: 41 },
    { name: 'Adamant pickaxe', level: 31 },
    { name: 'Mithril pickaxe', level: 21 },
    { name: 'Steel pickaxe', level: 6 },
    { name: 'Iron pickaxe', level: 1 },
    { name: 'Bronze pickaxe', level: 1 }
];

export function bestPickaxe(miningLevel: number, available: (name: string) => boolean): string | null {
    for (const p of PICKAXES) {
        if (miningLevel >= p.level && available(p.name)) {
            return p.name;
        }
    }
    return null;
}

export function resolveRockIds(names: string[]): Set<number> {
    const ids = new Set<number>();
    for (const name of names) {
        const key = ROCK_OPTIONS.find(k => k.toLowerCase() === name.trim().toLowerCase());
        if (key) {
            for (const id of ROCK_TYPES[key]) {
                ids.add(id);
            }
        }
    }
    return ids;
}
