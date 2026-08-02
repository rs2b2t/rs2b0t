/**
 * Ore rock loc type ids from Server content (`scripts/skill_mining/configs/rocks.loc`
 * + `pack/loc.pack`). All share in-game name "Rocks" + op Mine; ore is distinguished
 * only by id. Depleted stages become empty rocks1/rocks2 (ids 450/452) with
 * `mining_rock_empty` — those must stay out of this map so findRock ignores empties.
 *
 * Dwarven iron spans two clusters (~3032,9825 and ~3044,9770) — pick by player
 * distance + local prefer, not only camp-pin membership (see GatheringBot.findRock).
 */
export const ROCK_TYPES: Record<string, number[]> = {
    Clay: [2108, 2109],
    Copper: [2090, 2091],
    Tin: [2094, 2095],
    Iron: [2092, 2093], // ironrock1 / ironrock2 (mining_rock_fast, respawnrate ~6)
    Silver: [2100, 2101],
    Coal: [2096, 2097],
    Gold: [2098, 2099],
    Mithril: [2102, 2103],
    Adamantite: [2104, 2105],
    Runite: [2106, 2107]
};

export const ROCK_OPTIONS = Object.keys(ROCK_TYPES);

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

export const GAS_ROCK_TICKS = 60;

export const BROKEN_PICKAXE = 'Broken pickaxe';

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
