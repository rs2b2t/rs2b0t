import { Equipment } from '../../../../equipment/Equipment.js';
import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import type { BioItem } from './areas.js';

export function heldId(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

export function wornId(id: number): boolean {
    return Equipment.items().some(item => item.id === id);
}

// Why: both halves of the priest suit render "Priest gown", so `Equipment.equip` reports the
// legs already on once the top is worn and never sends the second Wear.

/** Wear by exact object id. */
export async function wear(item: BioItem, log: (m: string) => void): Promise<boolean> {
    if (wornId(item.id)) {
        return true;
    }
    const held = Inventory.items().find(entry => entry.id === item.id);
    if (!held) {
        log(`no ${item.name} (id ${item.id}) in the pack to wear`);
        return false;
    }
    const op = held.actions().find(action => /wield|wear|equip/i.test(action));
    if (!op || !(await held.interact(op))) {
        log(`${item.name} (id ${item.id}) offered no Wear`);
        return false;
    }
    return Execution.delayUntil(() => wornId(item.id), 3000);
}
