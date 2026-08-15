import type { LocSnapshot } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { Input } from '../../input/Input.js';
import Tile from '../../geometry/Tile.js';
import { opIndex, presentOps, type Interactable, type Locatable } from './Interactable.js';

/**
 * A scenery object — door, tree, rock, booth, altar.
 * @see docs/reference/api-entities.md#entity-shapes
 */
export class Loc implements Interactable, Locatable {
    constructor(readonly snap: LocSnapshot) {}

    get name(): string | null {
        return this.snap.name;
    }

    get id(): number {
        return this.snap.id;
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

        return Input.interactLoc(local.lx, local.lz, this.snap.typecode, op);
    }
}
