// Pure data and decisions for the PotionMaker script.

// Why: a batch is made bank-standing — clean herb plus vial of water gives an "Unfinished potion", then a secondary plus that gives the finished potion.
// Why: every herb's unfinished potion renders with the same display name, so the make step is detected by numeric id, never by name.

/** What the bot withdraws to pair with the herb in the first step. */
export const VIAL_OF_WATER_ID = 227;

/** How many of each half the bot withdraws and combines per batch. */
export const BATCH = 14;

/** Dropdown sentinel that reveals the matching free-text setting. */
export const CUSTOM = 'Custom';

export interface HerbDef {
    key: string;
    /** Cleaned herb name — descriptive, matches the settings UI and in-game. */
    name: string;
    /** Cleaned herb id — what the bot withdraws. */
    id: number;
    /** Unfinished potion id produced from this herb + a vial of water. */
    unfId: number;
}

export const HERBS: readonly HerbDef[] = [
    { key: 'guam', name: 'Guam leaf', id: 249, unfId: 91 },
    { key: 'marrentill', name: 'Marrentill', id: 251, unfId: 93 },
    { key: 'tarromin', name: 'Tarromin', id: 253, unfId: 95 },
    { key: 'harralander', name: 'Harralander', id: 255, unfId: 97 },
    { key: 'ranarr', name: 'Ranarr weed', id: 257, unfId: 99 },
    { key: 'toadflax', name: 'Toadflax', id: 2998, unfId: 3002 },
    { key: 'irit', name: 'Irit leaf', id: 259, unfId: 101 },
    { key: 'avantoe', name: 'Avantoe', id: 261, unfId: 103 },
    { key: 'kwuarm', name: 'Kwuarm', id: 263, unfId: 105 },
    { key: 'snapdragon', name: 'Snapdragon', id: 3000, unfId: 3004 },
    { key: 'cadantine', name: 'Cadantine', id: 265, unfId: 107 },
    { key: 'lantadyme', name: 'Lantadyme', id: 2481, unfId: 2483 },
    { key: 'dwarf weed', name: 'Dwarf weed', id: 267, unfId: 109 },
    { key: 'torstol', name: 'Torstol', id: 269, unfId: 111 }
];

export interface SecondaryDef {
    key: string;
    /** In-game secondary name — unique and descriptive. */
    name: string;
    id: number;
}

export const SECONDARIES: readonly SecondaryDef[] = [
    { key: 'eye of newt', name: 'Eye of newt', id: 221 },
    { key: 'red spiders eggs', name: "Red spiders' eggs", id: 223 },
    { key: 'limpwurt root', name: 'Limpwurt root', id: 225 },
    { key: 'snape grass', name: 'Snape grass', id: 231 },
    { key: 'unicorn horn dust', name: 'Unicorn horn dust', id: 235 },
    { key: 'white berries', name: 'White berries', id: 239 },
    { key: 'dragon scale dust', name: 'Dragon scale dust', id: 241 },
    { key: 'wine of zamorak', name: 'Wine of zamorak', id: 245 },
    { key: 'jangerberries', name: 'Jangerberries', id: 247 }
];

export const HERB_OPTIONS = HERBS.map(h => h.name);
export const SECONDARY_OPTIONS = SECONDARIES.map(s => s.name);

/** Find a herb by clean name (exact, then substring, then key) — case-insensitive. */
export function herbByName(name: string): HerbDef | null {
    const wanted = name.trim().toLowerCase();
    if (!wanted) {
        return null;
    }
    return (
        HERBS.find(h => h.name.toLowerCase() === wanted) ??
        HERBS.find(h => h.name.toLowerCase().includes(wanted)) ??
        HERBS.find(h => h.key.toLowerCase() === wanted) ??
        null
    );
}

/** Find a secondary by in-game name (exact, then substring) — case-insensitive. */
export function secondaryByName(name: string): SecondaryDef | null {
    const wanted = name.trim().toLowerCase();
    if (!wanted) {
        return null;
    }
    return (
        SECONDARIES.find(s => s.name.toLowerCase() === wanted) ??
        SECONDARIES.find(s => s.name.toLowerCase().includes(wanted)) ??
        null
    );
}