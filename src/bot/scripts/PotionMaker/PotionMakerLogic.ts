import { POTION_HERBS } from '../../data/herbs.js';
import { POTION_SECONDARIES } from '../../data/potionSecondaries.js';

export { POTION_HERBS as HERBS, potionHerbByName as herbByName, type PotionHerb as HerbDef } from '../../data/herbs.js';
export { POTION_SECONDARIES as SECONDARIES, potionSecondaryByName as secondaryByName, type PotionSecondary as SecondaryDef } from '../../data/potionSecondaries.js';

/** What the bot withdraws to pair with the herb in the first step. */
export const VIAL_OF_WATER_ID = 227;

/** How many of each half the bot withdraws and combines per batch. */
export const BATCH = 14;

/** Dropdown sentinel that reveals the matching free-text setting. */
export const CUSTOM = 'Custom';

export const HERB_OPTIONS = POTION_HERBS.map(h => h.name);
export const SECONDARY_OPTIONS = POTION_SECONDARIES.map(s => s.name);
