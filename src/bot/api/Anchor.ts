import type { WorldTile } from '../adapter/ClientAdapter.js';
import type { Task } from './Bot.js';
import { Game } from './Game.js';
import Tile from './Tile.js';
import { Traversal } from './Traversal.js';
import { walkOpening } from './walkOpening.js';

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
    /** When set and non-empty, final approach opens matching doors/gates via walkOpening. */
    obstacles?: string[];
    /**
     * If distance to anchor exceeds this, walkResilient first (web path), then local approach.
     * Omit or set <= 0 to skip the long-range leg (GatheringBot default path).
     */
    longRangeTiles?: number;
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
    const obstacles = (opts.obstacles ?? []).map(s => s.trim().toLowerCase()).filter(Boolean);
    const longRangeTiles = opts.longRangeTiles ?? 0;

    return {
        validate(): boolean {
            if (opts.suppress?.()) {
                return false;
            }
            return beyondLeash(host, Game.tile(), slack);
        },
        async execute(): Promise<void> {
            host.setStatus?.(status);
            const log = (m: string) => host.log?.(m);
            const here = Game.tile();
            const anchor = host.getAnchor();
            // Already inside the arrive disk — don't micro-walk the pin.
            if (here && anchor.distanceTo(here) <= arriveRadius) {
                return;
            }
            if (longRangeTiles > 0 && here && anchor.distanceTo(here) > longRangeTiles) {
                await Traversal.walkResilient(anchor, {
                    radius: arriveRadius,
                    timeoutMs,
                    log: m => log?.(`  ${m}`)
                });
                const afterLong = Game.tile();
                if (afterLong && anchor.distanceTo(afterLong) <= arriveRadius) {
                    return;
                }
            }
            if (obstacles.length > 0) {
                await walkOpening(anchor, arriveRadius, obstacles, m => log?.(m));
                return;
            }
            await Traversal.walkTo(anchor, { radius: arriveRadius, timeoutMs, log: m => log?.(`  ${m}`) });
        }
    };
}
