import { ITEMS_BY_NAME } from '../data/itemIndex.js';
import { ITEM_DB } from '../data/itemdb.js';
import type { Loadout } from '../api/loadout/loadouts.js';
import type { ItemRecord, Slot } from '../api/loadout/types.js';

/** The equipment interface grid; null is a spacer cell. */
export const SLOT_LAYOUT: readonly (readonly (Slot | null)[])[] = [
    [null, 'hat', null],
    ['back', 'front', 'quiver'],
    ['righthand', 'torso', 'lefthand'],
    [null, 'legs', null],
    ['hands', 'feet', 'ring']
];

export interface SupplyRow {
    label: string;
    /** Seeds the picker's search box so the common case is one click. */
    hint: string;
}

export const SUPPLY_ROWS: readonly SupplyRow[] = [
    { label: 'Food', hint: '' },
    { label: 'Prayer potion', hint: 'prayer potion' },
    { label: 'Antipoison', hint: 'antipoison' },
    { label: 'Super attack', hint: 'super attack' },
    { label: 'Super strength', hint: 'super strength' },
    { label: 'Super defence', hint: 'super defence' }
];

export function recordByName(name: string): ItemRecord | null {
    return ITEMS_BY_NAME.get(name.trim().toLowerCase())?.at(-1) ?? null;
}

export function slotOptions(slot: Slot): ItemRecord[] {
    return ITEM_DB.filter(r => r.slot === slot);
}

export function consumableOptions(): ItemRecord[] {
    return ITEM_DB.filter(r => r.consumable !== undefined);
}

export function searchItems(list: readonly ItemRecord[], query: string): ItemRecord[] {
    const q = query.trim().toLowerCase();
    return q.length === 0 ? [...list] : list.filter(r => r.name.toLowerCase().includes(q));
}

function isTwoHanded(name: string | undefined): boolean {
    return name !== undefined && recordByName(name)?.twoHanded === true;
}

export function shieldDisabled(worn: Loadout['worn']): boolean {
    return isTwoHanded(worn.righthand);
}

/** Build a loadout from worn items, using catalog slot metadata. */
export function wornFromEquipment(equipped: readonly { name: string | null }[]): Loadout['worn'] {
    const out: Loadout['worn'] = {};
    for (const item of equipped) {
        const record = item.name ? recordByName(item.name) : null;
        if (record?.slot) {
            out[record.slot] = record.name;
        }
    }
    return out;
}

export function wearItem(worn: Loadout['worn'], slot: Slot, name: string | null): Loadout['worn'] {
    const out = { ...worn };
    if (name === null) {
        delete out[slot];
        return out;
    }
    out[slot] = name;
    if (slot === 'righthand' && isTwoHanded(name)) {
        delete out.lefthand;
    }
    return out;
}
