/**
 * Worn-equipment reader + equip/unequip. Equipment slots are a component
 * container (INV_BUTTON ops), distinct from backpack held-ops — see
 * reader.equipment() for why the two aren't interchangeable.
 */
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

    /**
     * Equip a backpack item by its held Wield/Wear op (object-level iop,
     * dispatched via `InvItem.interact` -> OPHELD*, same as any other held
     * action). Verifies via the worn tab rather than trusting the click.
     */
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

    /**
     * Remove a worn item by name via the worn tab's component-level 'Remove'
     * button. Deliberately bypasses `InvItem.interact` (which always
     * dispatches OPHELD*, the object-level op path) — the worn tab's ops are
     * component-level (see `reader.equipment()`'s doc comment), the same
     * INV_BUTTON* dispatch `Bank.ts` already uses for Withdraw/Deposit — so
     * this clicks `ActionRouter.driver.invButton` directly against the raw
     * snapshot instead. Returns true (no-op) if the item isn't worn.
     */
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
