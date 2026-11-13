import type { SettingsSchema } from '../../runtime/Settings.js';

export const SHADES_SETTINGS: SettingsSchema = {
    strategy: { type: 'string', default: 'Local', options: ['Local', 'Banked'], label: 'Supply strategy' },
    protection: { type: 'string', default: 'Auto', options: ['Auto', 'Food only'], label: 'Protection' },
    loot: { type: 'string', default: 'Sell', options: ['Sell', 'High alch'], label: 'Chest equipment' },
    pyres: { type: 'number', default: 40, min: 1, max: 200, label: 'Pyres per expedition' },
    targetRemains: { type: 'number', default: 14, min: 1, max: 20, label: 'Target hunting batch' }
};

export type ExpeditionOptions = { pyres: number; targetRemains: number; prayer: boolean; alch: boolean };
