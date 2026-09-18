import type { InvItemSnapshot } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { Input } from '../../input/Input.js';
import { GroundItem } from '../model/GroundItem.js';
import { Loc } from '../model/Loc.js';
import { Npc } from '../model/Npc.js';

const BACKPACK_CAPACITY = 28;

export function backpackSnapshots(): InvItemSnapshot[] {
    return reader.bankComId() !== -1 ? reader.bankSideItems() : reader.inventory();
}

export function backpackCapacity(): number {
    return reader.bankComId() !== -1 ? BACKPACK_CAPACITY : reader.inventorySize();
}

/**
 * One backpack slot.
 * @see docs/reference/api-items.md#invitem
 */
export class InvItem {
    constructor(/** @internal */ readonly snap: InvItemSnapshot, private readonly componentOps = false) {}

    get name(): string | null {
        return this.snap.name;
    }

    get id(): number {
        return this.snap.id;
    }

    get slot(): number {
        return this.snap.slot;
    }

    get count(): number {
        return this.snap.count;
    }

    actions(): string[] {
        return this.snap.ops.filter((op): op is string => op !== null);
    }

    interact(action: string): boolean | Promise<boolean> {
        const wanted = action.toLowerCase();
        for (let i = 0; i < this.snap.ops.length; i++) {
            if (this.snap.ops[i]?.toLowerCase() === wanted) {
                const driver = Input;
                return this.componentOps
                    ? driver.invButton(this.snap.id, this.snap.slot, this.snap.comId, i + 1)
                    : driver.heldOp(this.snap.id, this.snap.slot, this.snap.comId, i + 1);
            }
        }

        return false;
    }

    useOn(target: InvItem | Loc | Npc | GroundItem): boolean | Promise<boolean> {
        // The bank side backpack only exposes Deposit-* component buttons, so it can't start or receive a Use.
        if (this.componentOps || (target instanceof InvItem && target.componentOps)) {
            return false;
        }
        const driver = Input;
        if (target instanceof InvItem) {
            return driver.useItemOnItem(this.snap.id, this.snap.slot, this.snap.comId, target.snap.id, target.snap.slot, target.snap.comId);
        }
        if (target instanceof Npc) {
            return driver.useItemOnNpc(this.snap.id, this.snap.slot, this.snap.comId, target.snap.index);
        }
        const local = reader.toLocal(target.snap.tile.x, target.snap.tile.z);
        if (!local) {
            return false;
        }
        // Why: Ground-item use sends `opobju`, which loc and NPC helpers cannot express.
        if (target instanceof GroundItem) {
            return driver.useItemOnObj(this.snap.id, this.snap.slot, this.snap.comId, target.snap.id, local.lx, local.lz);
        }
        return driver.useItemOnLoc(this.snap.id, this.snap.slot, this.snap.comId, local.lx, local.lz, target.snap.typecode);
    }
}

/**
 * The backpack.
 * @see docs/reference/api-items.md
 */
export const Inventory = {
    items(): InvItem[] {
        const bankOpen = reader.bankComId() !== -1;
        return backpackSnapshots().map(s => new InvItem(s, bankOpen));
    },

    first(name: string): InvItem | null {
        const wanted = name.toLowerCase();
        return Inventory.items().find(i => i.name?.toLowerCase() === wanted) ?? null;
    },

    contains(name: string): boolean {
        return Inventory.first(name) !== null;
    },

    used(): number {
        return backpackSnapshots().length;
    },

    count(name: string): number {
        const wanted = name.toLowerCase();
        return backpackSnapshots()
            .filter(i => i.name?.toLowerCase() === wanted)
            .reduce((sum, i) => sum + i.count, 0);
    },

    countById(id: number): number {
        return backpackSnapshots()
            .filter(i => i.id === id)
            .reduce((sum, i) => sum + i.count, 0);
    },

    isFull(): boolean {
        const size = backpackCapacity();
        return size > 0 && Inventory.used() >= size;
    },

    // Outside the bank, 0 means the pack interface hasn't loaded yet; the bank side view is always the fixed 28-slot backpack.
    free(): number {
        const size = backpackCapacity();
        return size > 0 ? Math.max(0, size - Inventory.used()) : 0;
    }
};
