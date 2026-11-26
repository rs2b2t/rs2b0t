import type { SettingsBag } from '../../runtime/Settings.js';
import { ITEMS_BY_NAME } from '../../data/itemIndex.js';
import { selectedLoadout } from './loadoutSetting.js';
import type { CarryEntry, Loadout } from './loadouts.js';

/** A loadout naming nothing means unchosen, so every accessor takes the caller's own fallback. */
export function foodOf(loadout: Loadout | null, fallback: string): string {
    for (const entry of loadout?.carry ?? []) {
        const wanted = entry.item.toLowerCase();
        const record = ITEMS_BY_NAME.get(wanted)?.[0];
        if (record?.consumable === 'eat') {
            return record.name;
        }
    }
    return fallback;
}

export function gearOf(loadout: Loadout | null): string[] {
    return Object.values(loadout?.worn ?? {});
}

export function suppliesOf(loadout: Loadout | null): CarryEntry[] {
    return [...(loadout?.carry ?? [])];
}

export function weaponOf(loadout: Loadout | null, fallback: string | null = null): string | null {
    return loadout?.worn.righthand ?? fallback;
}

export function scriptFood(bag: SettingsBag, fallback: string): string {
    return foodOf(selectedLoadout(bag), fallback);
}

export function scriptFoods(bag: SettingsBag, fallback: readonly string[]): string[] {
    const chosen = foodOf(selectedLoadout(bag), '');
    return chosen.length > 0 ? [chosen] : [...fallback];
}
