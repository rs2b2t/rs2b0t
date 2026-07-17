/**
 * Ore-bearing rock types for the Miner. Every mining rock loc is named "Rocks"
 * in-game — the ore is distinguished only by loc id (two variants each), taken
 * from the content pack (`pack/loc.pack`). The type NAME doubles as the product
 * keyword: every ore item's name contains it (Copper -> "Copper ore",
 * Coal -> "Coal", Clay -> "Clay"), so we filter the pack the same way.
 */
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

/** Ore type names, in mining-level order — the Miner's multi-select options. */
export const ROCK_OPTIONS = Object.keys(ROCK_TYPES);

/**
 * "Smoking rock" gas variants (anti-macro event, pack/loc.pack 2119-2139):
 * the rock being mined is loc_changed to one of these for 60 ticks and the
 * ENGINE re-interacts the miner automatically — a few swings later it
 * explodes for 10 damage and swaps the pickaxe (worn or pack) for a Broken
 * pickaxe. Same "Rocks"/Mine name+op as real rocks; only the loc id tells.
 */
export const GAS_ROCK_IDS: Set<number> = new Set([
    2119, 2120, // copper
    2121, 2122, // iron
    2123, 2124, // tin
    2125, 2126, // coal
    2127, 2128, // gold
    2129, 2130, // silver
    2131, 2132, // mithril
    2133, 2134, // adamantite
    2135, 2136, // runite
    2137, 2138, // clay
    2139 // blurite
]);

/** How long a gas rock stays before reverting (macro_event_gas.rs2). */
export const GAS_ROCK_TICKS = 60;

/** Every broken tier shares this item name (antimacro.obj). */
export const BROKEN_PICKAXE = 'Broken pickaxe';

/** Pickaxe ladder, best first, with the MINING level each needs to be used
 *  (pickaxes.obj levelrequire — the engine's pickaxe_checker order). */
export const PICKAXES: readonly { name: string; level: number }[] = [
    { name: 'Rune pickaxe', level: 41 },
    { name: 'Adamant pickaxe', level: 31 },
    { name: 'Mithril pickaxe', level: 21 },
    { name: 'Steel pickaxe', level: 6 },
    { name: 'Iron pickaxe', level: 1 },
    { name: 'Bronze pickaxe', level: 1 }
];

/** Best usable pickaxe: highest tier within `miningLevel` that `available`
 *  accepts (e.g. is in the bank), or null when none qualifies. */
export function bestPickaxe(miningLevel: number, available: (name: string) => boolean): string | null {
    for (const p of PICKAXES) {
        if (miningLevel >= p.level && available(p.name)) {
            return p.name;
        }
    }
    return null;
}

/** Resolve selected ore-type names to the set of rock loc ids to mine. */
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
