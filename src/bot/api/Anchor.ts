import type { WorldTile } from '../adapter/ClientAdapter.js';
import type { Task } from './Bot.js';
import { Game } from './Game.js';
import { DEFAULT_CAMP_RADIUS } from './GatheringLocations.js';
import Tile from './Tile.js';
import { Traversal } from './Traversal.js';
import { walkOpening } from './walkOpening.js';

export interface AnchorHost {
    getAnchor(): Tile;
    leashRadius(): number;

    setStatus?(s: string): void;
    log?(msg: string): void;
}

/**
 * Soft home arrive radius after bank/shop/repair.
 * Humans re-enter the camp disk — they do not pin the exact location.spot tile.
 */
export const HOME_ARRIVE_RADIUS = 8;

/**
 * Whether post-bank / no-target gather should walk toward the camp anchor.
 *
 * "Already home" is the soft {@link HOME_ARRIVE_RADIUS} disk — not camp membership.
 * Bank stands often sit inside the membership disk but far from resources
 * (Catherby bank→pier ≈ 36). Treating full membership as home left Fisher idling
 * on "no spots" at the bank (#154).
 */
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

/**
 * Backup soft-home from a gather miss (no spot/rock in scene).
 *
 * BankCatch / restock use the tight {@link HOME_ARRIVE_RADIUS} disk via
 * {@link shouldWalkHomeToGatherAnchor}. Gather must **not** — freeform pier-hops and
 * brief spot despawns sit just outside the 8-tile disk and thrash hunt↔home.
 * Only pull home when clearly off the resource pad (bank square / long wander).
 *
 * Uses a soft threshold (~20–28), not full camp membership — bank at ~36 must
 * still soft-home even when membership is 64.
 */
export function shouldSoftHomeFromGatherMiss(
    distToAnchor: number | null | undefined,
    leash = DEFAULT_CAMP_RADIUS
): boolean {
    if (distToAnchor == null || !Number.isFinite(distToAnchor)) {
        return false;
    }
    const L = Math.max(2, Math.floor(Number.isFinite(leash) ? leash : DEFAULT_CAMP_RADIUS));
    // ≥20 tiles off anchor, or past half a tight freeform leash — not the soft arrive disk.
    const threshold = Math.max(HOME_ARRIVE_RADIUS + 12, Math.min(L, 28));
    return distToAnchor > threshold;
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
