
import type { WorldTile } from '../adapter/ClientAdapter.js';
import type { Task } from './Bot.js';
import { Game } from './Game.js';
import Tile from './Tile.js';
import { Traversal } from './Traversal.js';

export interface AnchorHost {
    getAnchor(): Tile;
    leashRadius(): number;

    setStatus?(s: string): void;
    log?(msg: string): void;
}

export interface ReturnToAnchorOptions {

    slack?: number;

    arriveRadius?: number;
    timeoutMs?: number;

    suppress?: () => boolean;
    status?: string;
}

export function distanceToAnchor(host: AnchorHost, here: WorldTile | null = Game.tile()): number | null {
    if (!here) {
        return null;
    }
    return host.getAnchor().distanceTo(here);
}

export function beyondLeash(host: AnchorHost, here: WorldTile | null = Game.tile(), slack = 0): boolean {
    const d = distanceToAnchor(host, here);
    return d !== null && d > host.leashRadius() + slack;
}

export function tileWithinLeash(host: AnchorHost, tile: WorldTile, slack = 0): boolean {
    return host.getAnchor().distanceTo(tile) <= host.leashRadius() + slack;
}

export function resolveRunAnchor(here: WorldTile, locationSpot: Tile | null | undefined): Tile {
    if (locationSpot) {
        return locationSpot;
    }
    return new Tile(here.x, here.z, here.level);
}

export function createReturnToAnchorTask(host: AnchorHost, opts: ReturnToAnchorOptions = {}): Task {
    const slack = opts.slack ?? 4;
    const arriveRadius = opts.arriveRadius ?? 3;
    const timeoutMs = opts.timeoutMs ?? 90_000;
    const status = opts.status ?? 'returning to anchor';

    return {
        validate(): boolean {
            if (opts.suppress?.()) {
                return false;
            }
            return beyondLeash(host, Game.tile(), slack);
        },
        async execute(): Promise<void> {
            host.setStatus?.(status);
            await Traversal.walkTo(host.getAnchor(), { radius: arriveRadius, timeoutMs });
        }
    };
}
