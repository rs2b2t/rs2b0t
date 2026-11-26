import { potionIngredientByName } from './potionIngredientByName.js';

export interface HerbDef {
    key: string;
    /** Display name of the cleaned (identified) herb. */
    name: string;
    /** Cleaned herb id. */
    id: number;
    /** Unidentified (grimy) form, what sits in the inventory. */
    unidId: number;
    /** Herblore level required to identify it. */
    level: number;
}

export interface PotionHerb extends Pick<HerbDef, 'key' | 'name' | 'id'> {
    unfId: number;
}

const potionHerbs: readonly (HerbDef & PotionHerb)[] = [
    { key: 'guam', name: 'Guam leaf', id: 249, unidId: 199, level: 3, unfId: 91 },
    { key: 'marrentill', name: 'Marrentill', id: 251, unidId: 201, level: 5, unfId: 93 },
    { key: 'tarromin', name: 'Tarromin', id: 253, unidId: 203, level: 11, unfId: 95 },
    { key: 'harralander', name: 'Harralander', id: 255, unidId: 205, level: 20, unfId: 97 },
    { key: 'ranarr', name: 'Ranarr weed', id: 257, unidId: 207, level: 25, unfId: 99 },
    { key: 'toadflax', name: 'Toadflax', id: 2998, unidId: 3049, level: 30, unfId: 3002 },
    { key: 'irit', name: 'Irit leaf', id: 259, unidId: 209, level: 40, unfId: 101 },
    { key: 'avantoe', name: 'Avantoe', id: 261, unidId: 211, level: 48, unfId: 103 },
    { key: 'kwuarm', name: 'Kwuarm', id: 263, unidId: 213, level: 54, unfId: 105 },
    { key: 'snapdragon', name: 'Snapdragon', id: 3000, unidId: 3051, level: 59, unfId: 3004 },
    { key: 'cadantine', name: 'Cadantine', id: 265, unidId: 215, level: 65, unfId: 107 },
    { key: 'lantadyme', name: 'Lantadyme', id: 2481, unidId: 2485, level: 67, unfId: 2483 },
    { key: 'dwarf weed', name: 'Dwarf weed', id: 267, unidId: 217, level: 70, unfId: 109 },
    { key: 'torstol', name: 'Torstol', id: 269, unidId: 219, level: 75, unfId: 111 }
];

export const POTION_HERBS: readonly PotionHerb[] = potionHerbs.map(({ key, name, id, unfId }) => ({ key, name, id, unfId }));

export const HERBS: readonly HerbDef[] = [
    ...potionHerbs.map(({ key, name, id, unidId, level }) => ({ key, name, id, unidId, level })),
    // Karamja herbs (ids verified against quest/JunglePotion defs).
    { key: 'snake weed', name: 'Snake weed', id: 1526, unidId: 1525, level: 3 },
    { key: 'ardrigal', name: 'Ardrigal', id: 1528, unidId: 1527, level: 3 },
    { key: 'sito foil', name: 'Sito foil', id: 1530, unidId: 1529, level: 3 },
    { key: 'volencia moss', name: 'Volencia moss', id: 1532, unidId: 1531, level: 3 },
    { key: 'rogues purse', name: 'Rogues purse', id: 1534, unidId: 1533, level: 3 }
];

export const HERB_OPTIONS = HERBS.map(h => h.name);

/** Find a herb by clean name (exact, then substring, then key), case-insensitive. */
export function potionHerbByName(name: string): PotionHerb | null {
    return potionIngredientByName(POTION_HERBS, name, wanted =>
        POTION_HERBS.find(h => h.key.toLowerCase() === wanted)
    );
}
