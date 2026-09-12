import type { WorldTile } from '../../adapter/ClientAdapter.js';
import type { Task } from '../bot/Bot.js';
import { Game } from '../game/Game.js';
import { DEFAULT_CAMP_RADIUS } from '../../data/gatheringLocations.js';
import Tile from '../../geometry/Tile.js';
import { Traversal } from '../walking/Traversal.js';
import { walkOpening } from '../../event/webwalk/walkOpening.js';

export interface AnchorHost {
    getAnchor(): Tile;
    leashRadius(): number;

    setStatus?(s: string): void;
    log?(msg: string): void;
}

/** Arrival radius after banking, shopping, or repair; avoids pinning the exact camp spot. */
export const HOME_ARRIVE_RADIUS = 8;

// Why: Camp membership can include a distant bank, so use a tighter arrival radius around the resource (#154).

/** Whether post-bank or no-target gather should walk toward the camp anchor. */
export function shouldWalkHomeToGatherAnchor(
    distToAnchor: number | null | undefined,
    arriveRadius = HOME_ARRIVE_RADIUS
): boolean {
    if (distToAnchor == null || !Number.isFinite(distToAnchor)) {
        return false;
    }
    const r = Math.max(0, Math.floor(Number.isFinite(arriveRadius) ? arriveRadius : HOME_ARRIVE_RADIUS));
    return distToAnchor > r;
}

// Why: Gathering needs room for spot hops, so return only after a clear wander while keeping a bank about 36 tiles away outside the threshold.

/** Backup soft-home from a gather miss (no spot or rock in scene). */
export function shouldSoftHomeFromGatherMiss(
    distToAnchor: number | null | undefined,
    leash = DEFAULT_CAMP_RADIUS
): boolean {
    if (distToAnchor == null || !Number.isFinite(distToAnchor)) {
        return false;
    }
    const L = Math.max(2, Math.floor(Number.isFinite(leash) ? leash : DEFAULT_CAMP_RADIUS));
    // 20 tiles off anchor, or the leash capped at 28 when that's larger.
    const threshold = Math.max(HOME_ARRIVE_RADIUS + 12, Math.min(L, 28));
    return distToAnchor > threshold;
}

export interface ReturnToAnchorOptions {
    slack?: number;
    arriveRadius?: number;
    timeoutMs?: number;
    /** When set and non-empty, final approach opens matching doors/gates via walkOpening. */
    obstacles?: string[];
    /** Past this distance walkResilient (web path) runs before the local approach; omit or <= 0 skips the long-range leg. */
    longRangeTiles?: number;
    suppress?: () => boolean;
    status?: string;
}

function distanceToAnchor(host: AnchorHost, here: WorldTile | null = Game.tile()): number | null {
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
    // Soft defaults: you re-enter the camp disk without pinning the exact spot tile.
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
            // Already inside the arrive disk, don't micro-walk the pin.
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
