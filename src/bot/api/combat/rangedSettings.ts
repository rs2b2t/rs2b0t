import type { SettingsBag, SettingsSchema } from '../../runtime/Settings.js';

export const CUSTOM_RANGED_SETTINGS: SettingsSchema = {
    customBow: { type: 'string', default: '', label: 'Custom ranged weapon', group: 'Combat', showIf: { key: 'bow', anyOf: ['Other'] }, help: 'exact item name; for thrown weapons use the same name for ammo' },
    customAmmo: { type: 'string', default: '', label: 'Custom ammunition', group: 'Combat', showIf: { key: 'ammo', anyOf: ['Other'] }, help: 'exact item name, such as Bolts or Rune knife' }
};

export function rangedItem(settings: SettingsBag, key: 'bow' | 'ammo', fallback: string): string {
    const selected = settings.str(key, fallback).trim();
    if (selected !== 'Other') return selected;
    const item = settings.str(key === 'bow' ? 'customBow' : 'customAmmo', '').trim();
    if (!item) throw new Error(`Enter a custom ${key === 'bow' ? 'ranged weapon' : 'ammunition'} name`);
    return item;
}
