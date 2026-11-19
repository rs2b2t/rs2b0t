import type { SettingsSchema } from '../../runtime/Settings.js';

export const SHADES_SETTINGS: SettingsSchema = {
    prayerPotions: { type: 'boolean', default: true, label: 'Use prayer potions', help: 'Uses banked potions for Protect from Melee; uses food when potions run out.' },
    highAlchemy: { type: 'boolean', default: false, label: 'High alch valuable loot', help: 'Spends banked nature and fire runes at 55 Magic. Otherwise sells unwanted chest loot to Razmire.' }
};

export type ExpeditionOptions = { prayer: boolean; alch: boolean };
