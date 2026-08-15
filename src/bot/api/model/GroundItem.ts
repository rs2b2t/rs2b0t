import type { GroundItemSnapshot } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { Input } from '../../input/Input.js';
import Tile from '../../geometry/Tile.js';
import { opIndex, presentOps, type Interactable, type Locatable } from './Interactable.js';

/**
 * An item lying on the ground.
 * @see docs/reference/api-entities.md#entity-shapes
 */
export class GroundItem implements Interactable, Locatable {
    constructor(readonly snap: GroundItemSnapshot) {}

    get name(): string | null {
        return this.snap.name;
    }

    get id(): number {
        return this.snap.id;
    }

    get count(): number {
        return this.snap.count;
    }

    tile(): Tile {
        return Tile.from(this.snap.tile);
    }

    distance(): number {
        return this.snap.distance;
    }

    actions(): string[] {
        return presentOps(this.snap.ops);
    }

    interact(action: string): boolean | Promise<boolean> {
        const op = opIndex(this.snap.ops, action);
        if (op === -1) {
            return false;
        }

        const local = reader.toLocal(this.snap.tile.x, this.snap.tile.z);
        if (!local) {
            return false;
        }

        return Input.takeObj(local.lx, local.lz, this.snap.id, op);
    }
}
