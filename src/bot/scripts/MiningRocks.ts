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
