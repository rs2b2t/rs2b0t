
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
    // Soft defaults: humans re-enter the camp disk, they don't pin the exact spot tile.
    const slack = opts.slack ?? 6;
    const arriveRadius = opts.arriveRadius ?? 8;
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
            const here = Game.tile();
            const anchor = host.getAnchor();
            // Already inside the arrive disk — don't micro-walk the pin.
            if (here && anchor.distanceTo(here) <= arriveRadius) {
                return;
            }
            await Traversal.walkTo(anchor, { radius: arriveRadius, timeoutMs });
        }
    };
}
