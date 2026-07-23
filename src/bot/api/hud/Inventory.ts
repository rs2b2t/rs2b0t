import type { InvItemSnapshot } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { Loc, Npc } from '../entities/index.js';

export class InvItem {
    constructor(readonly snap: InvItemSnapshot) {}

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
                return ActionRouter.driver.heldOp(this.snap.id, this.snap.slot, this.snap.comId, i + 1);
            }
        }

        return false;
    }

    useOn(target: InvItem | Loc | Npc): boolean | Promise<boolean> {
        const driver = ActionRouter.driver;
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
        return driver.useItemOnLoc(this.snap.id, this.snap.slot, this.snap.comId, local.lx, local.lz, target.snap.typecode);
    }
}

export const Inventory = {
    items(): InvItem[] {
        return reader.inventory().map(s => new InvItem(s));
    },

    first(name: string): InvItem | null {
        const wanted = name.toLowerCase();
        return Inventory.items().find(i => i.name?.toLowerCase() === wanted) ?? null;
    },

    contains(name: string): boolean {
        return Inventory.first(name) !== null;
    },

    used(): number {
        return reader.inventory().length;
    },

    count(name: string): number {
        const wanted = name.toLowerCase();
        return reader
            .inventory()
            .filter(i => i.name?.toLowerCase() === wanted)
            .reduce((sum, i) => sum + i.count, 0);
    },

    isFull(): boolean {
        const size = reader.inventorySize();
        return size > 0 && Inventory.used() >= size;
    }
};
