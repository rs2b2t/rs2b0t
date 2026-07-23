import { reader } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { Execution } from '../Execution.js';
import { Inventory, InvItem } from './Inventory.js';

export const Equipment = {
    items(): InvItem[] {
        return reader.equipment().map(s => new InvItem(s));
    },

    contains(name: string): boolean {
        const wanted = name.toLowerCase();
        return reader.equipment().some(i => i.name?.toLowerCase() === wanted);
    },

    async equip(name: string): Promise<boolean> {
        if (Equipment.contains(name)) {
            return true;
        }

        const item = Inventory.first(name);
        if (!item) {
            return false;
        }

        const op = item.actions().find(o => /wield|wear|equip/i.test(o));
        if (!op) {
            return false;
        }

        await item.interact(op);
        return Execution.delayUntil(() => Equipment.contains(name), 3000);
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

        await ActionRouter.driver.invButton(worn.id, worn.slot, worn.comId, opIndex + 1);
        return Execution.delayUntil(() => !Equipment.contains(name), 3000);
    }
};
