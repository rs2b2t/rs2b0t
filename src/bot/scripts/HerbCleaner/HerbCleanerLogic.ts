// Pure data and decisions for the HerbCleaner script.

// Why: 2004scape unids all render as the same display name ("Unidentified herb"), so matches go through the numeric id, never the name.
// Why: `unidId` is the grimy or unidentified form and `id` is the cleaned form.

/** How the bot cleans a grimy herb (the first/held op; same as RoguesPurse). */
export const IDENTIFY_OP = 'Identify';

export interface HerbDef {
    key: string;
    /** Display name of the cleaned (identified) herb. */
    name: string;
    /** Cleaned herb id. */
    id: number;
    /** Unidentified (grimy) form — what sits in the inventory. */
    unidId: number;
    /** Herblore level required to identify it. */
    level: number;
}

export const HERBS: readonly HerbDef[] = [
    { key: 'guam', name: 'Guam leaf', id: 249, unidId: 199, level: 3 },
    { key: 'marrentill', name: 'Marrentill', id: 251, unidId: 201, level: 5 },
    { key: 'tarromin', name: 'Tarromin', id: 253, unidId: 203, level: 11 },
    { key: 'harralander', name: 'Harralander', id: 255, unidId: 205, level: 20 },
    { key: 'ranarr', name: 'Ranarr weed', id: 257, unidId: 207, level: 25 },
    { key: 'toadflax', name: 'Toadflax', id: 2998, unidId: 3049, level: 30 },
    { key: 'irit', name: 'Irit leaf', id: 259, unidId: 209, level: 40 },
    { key: 'avantoe', name: 'Avantoe', id: 261, unidId: 211, level: 48 },
    { key: 'kwuarm', name: 'Kwuarm', id: 263, unidId: 213, level: 54 },
    { key: 'snapdragon', name: 'Snapdragon', id: 3000, unidId: 3051, level: 59 },
    { key: 'cadantine', name: 'Cadantine', id: 265, unidId: 215, level: 65 },
    { key: 'lantadyme', name: 'Lantadyme', id: 2481, unidId: 2485, level: 67 },
    { key: 'dwarf weed', name: 'Dwarf weed', id: 267, unidId: 217, level: 70 },
    { key: 'torstol', name: 'Torstol', id: 269, unidId: 219, level: 75 },
    // Karamja herbs (ids verified against quest/JunglePotion defs).
    { key: 'snake weed', name: 'Snake weed', id: 1526, unidId: 1525, level: 3 },
    { key: 'ardrigal', name: 'Ardrigal', id: 1528, unidId: 1527, level: 3 },
    { key: 'sito foil', name: 'Sito foil', id: 1530, unidId: 1529, level: 3 },
    { key: 'volencia moss', name: 'Volencia moss', id: 1532, unidId: 1531, level: 3 },
    { key: 'rogues purse', name: 'Rogues purse', id: 1534, unidId: 1533, level: 3 }
];

export const HERB_OPTIONS = HERBS.map(h => h.name);

export function herbById(id: number): HerbDef | null {
    return HERBS.find(h => h.unidId === id || h.id === id) ?? null;
}

export function herbByCleanId(id: number): HerbDef | null {
    return HERBS.find(h => h.id === id) ?? null;
}

export function herbByUnidId(id: number): HerbDef | null {
    return HERBS.find(h => h.unidId === id) ?? null;
}

// Why: the list comes back lowest-level first, so cheap identify XP precedes expensive.

/** The herbs the player can clean this run: those Herblore allows, restricted to `selected` when non-empty. */
export function eligibleHerbs(herbloreLevel: number, selected: readonly string[]): HerbDef[] {
    return HERBS
        .filter(h => h.level <= herbloreLevel)
        .filter(h => selected.length === 0 || selected.some(s => s.toLowerCase() === h.name.toLowerCase()))
        .sort((a, b) => a.level - b.level);
}

/** Chat refusal from the engine when Herblore is below the herb's level, or the world is non-members. */
export const CANNOT_IDENTIFY = /you cannot identify this herb|need to be on a members['’]? world/i;