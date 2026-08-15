import type { NpcSnapshot } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { Input } from '../../input/Input.js';
import Tile from '../../geometry/Tile.js';
import { opIndex, presentOps, type Interactable, type Locatable } from './Interactable.js';

/**
 * A non-player character in the loaded scene.
 * @see docs/reference/api-entities.md#entity-shapes
 */
export class Npc implements Interactable, Locatable {
    constructor(readonly snap: NpcSnapshot) {}

    get name(): string | null {
        return this.snap.name;
    }

    get id(): number {
        return this.snap.id;
    }

    get level(): number {
        return this.snap.level;
    }

    get index(): number {
        return this.snap.index;
    }

    get inCombat(): boolean {
        return this.snap.inCombat;
    }

    get health(): number {
        return this.snap.health;
    }

    targetsAnotherPlayer(): boolean {
        return this.snap.faceEntity >= 32768 && this.snap.faceEntity - 32768 !== reader.selfSlot();
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
        return presentOps(this.snap.ops);
    }

    valid(): boolean {
        return reader.npcs().some(n => n.index === this.snap.index && n.name === this.snap.name);
    }

    interact(action: string): boolean | Promise<boolean> {
        const op = opIndex(this.snap.ops, action);
        if (op === -1) {
            return false;
        }

        return Input.interactNpc(this.snap.index, op);
    }
}
