import type { PlayerSnapshot } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import Tile from '../../geometry/Tile.js';
import type { Locatable } from './Interactable.js';

/**
 * Another player in the loaded scene. Players never block navigation.
 * @see docs/reference/api-entities.md#entity-shapes
 * @see docs/decisions/corridor-snap.md
 */
export class Player implements Locatable {
    constructor(/** @internal */ readonly snap: PlayerSnapshot) {}

    get name(): string | null {
        return this.snap.name;
    }

    get index(): number {
        return this.snap.index;
    }

    get inCombat(): boolean {
        return this.snap.inCombat;
    }

    targetsMe(): boolean {
        return this.snap.faceEntity >= 32768 && this.snap.faceEntity - 32768 === reader.selfSlot();
    }

    tile(): Tile {
        return Tile.from(this.snap.tile);
    }

    distance(): number {
        return this.snap.distance;
    }

    actions(): string[] {
        return [];
    }
}
