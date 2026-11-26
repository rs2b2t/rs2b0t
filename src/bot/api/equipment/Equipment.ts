import { reader } from '../../adapter/ClientAdapter.js';
import { Input } from '../../input/Input.js';
import { Execution } from '../execution/Execution.js';
import { Bank } from '../bank/Bank.js';
import { Inventory, InvItem } from '../inventory/Inventory.js';

async function equip(equipped: () => boolean, findItem: () => InvItem | null | undefined): Promise<boolean> {
    if (equipped()) {
        return true;
    }

    // Bank side-view swaps backpack ops to Deposit-*, close first so Wield is present.
    if (Bank.isOpen()) {
        if (!(await Bank.close())) {
            return false;
        }
    }

    const item = findItem();
    if (!item) {
        return false;
    }

    const op = item.actions().find(o => /wield|wear|equip/i.test(o));
    if (!op) {
        return false;
    }

    if (!(await item.interact(op))) {
        return false;
    }
    return Execution.delayUntil(equipped, 3000);
}

/**
 * Worn equipment.
 * @see docs/reference/api-items.md
 */
export const Equipment = {
    items(): InvItem[] {
        return reader.equipment().map(s => new InvItem(s));
    },

    contains(name: string): boolean {
        const wanted = name.toLowerCase();
        return reader.equipment().some(i => i.name?.toLowerCase() === wanted);
    },

    equip(name: string): Promise<boolean> {
        return equip(() => Equipment.contains(name), () => Inventory.first(name));
    },

    equipById(id: number): Promise<boolean> {
        return equip(() => reader.equipment().some(item => item.id === id), () => Inventory.items().find(item => item.id === id));
    },

    async unequip(name: string): Promise<boolean> {
        const wanted = name.toLowerCase();
        const worn = reader.equipment().find(i => i.name?.toLowerCase() === wanted);
        if (!worn) {
            return true;
        }

        const opIndex = worn.ops.findIndex(o => o?.toLowerCase() === 'remove');
        if (opIndex === -1) {
            return false;
        }

        await Input.invButton(worn.id, worn.slot, worn.comId, opIndex + 1);
        return Execution.delayUntil(() => !Equipment.contains(name), 3000);
    }
};
