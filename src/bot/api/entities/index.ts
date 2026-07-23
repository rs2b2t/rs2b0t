import type { GroundItemSnapshot, LocSnapshot, NpcSnapshot, PlayerSnapshot } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import Tile from '../Tile.js';

export interface Interactable {
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;
}

export interface Locatable {
    tile(): Tile;
    distance(): number;
}

function opIndex(ops: (string | null)[], action: string): number {
    const wanted = action.toLowerCase();
    for (let i = 0; i < ops.length; i++) {
        if (ops[i]?.toLowerCase() === wanted) {
            return i + 1;
        }
    }

    return -1;
}

function presentOps(ops: (string | null)[]): string[] {
    return ops.filter((op): op is string => op !== null && op !== 'hidden');
}

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

        return ActionRouter.driver.interactNpc(this.snap.index, op);
    }
}

export class Player implements Locatable {
    constructor(readonly snap: PlayerSnapshot) {}

    get name(): string | null {
        return this.snap.name;
    }

    get index(): number {
        return this.snap.index;
    }

    get inCombat(): boolean {
        return this.snap.inCombat;
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

        return ActionRouter.driver.interactLoc(local.lx, local.lz, this.snap.typecode, op);
    }
}

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

        return ActionRouter.driver.takeObj(local.lx, local.lz, this.snap.id, op);
    }
}
