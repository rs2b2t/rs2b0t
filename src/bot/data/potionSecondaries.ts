import { potionIngredientByName } from './potionIngredientByName.js';

export interface PotionSecondary {
    key: string;
    /** In-game secondary name, unique and descriptive. */
    name: string;
    id: number;
}

export const POTION_SECONDARIES: readonly PotionSecondary[] = [
    { key: 'toads legs', name: "Toad's legs", id: 2152 },
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

/** Find a secondary by in-game name (exact, then substring), case-insensitive. */
export function potionSecondaryByName(name: string): PotionSecondary | null {
    return potionIngredientByName(POTION_SECONDARIES, name);
}
