/**
 * Anchor + leash helpers shared by gathering (and eventually combat) scripts.
 *
 * Today this is a thin seed: pure geometry + a ReturnToAnchor task factory.
 * Many early scripts still inline their own copy — migrate them here over time
 * rather than bloating each bot. Supervisor still reads recoveryAnchor() on the bot.
 */
import type { WorldTile } from '../adapter/ClientAdapter.js';
import type { Task } from './Bot.js';
import { Game } from './Game.js';
import Tile from './Tile.js';
import { Traversal } from './Traversal.js';

/** Minimum surface a leashed script exposes for anchor tasks / queries. */
export interface AnchorHost {
    getAnchor(): Tile;
    leashRadius(): number;
    /** Optional status line while walking home. */
    setStatus?(s: string): void;
    log?(msg: string): void;
}

export interface ReturnToAnchorOptions {
    /**
     * Extra tiles beyond leashRadius before the return task fires.
     * GatheringBot historically used +4 so brief path wobble doesn't thrash.
     */
    slack?: number;
    /** Walk radius when arriving at the anchor. Default 3. */
    arriveRadius?: number;
    timeoutMs?: number;
    /**
     * When true, skip returning (e.g. mid chop→burn load outside the chop leash,
     * or any temporary off-anchor phase).
     */
    suppress?: () => boolean;
    status?: string;
}

/** Chebyshev distance from here to anchor (null here → not beyond). */
export function distanceToAnchor(host: AnchorHost, here: WorldTile | null = Game.tile()): number | null {
    if (!here) {
        return null;
    }
    return host.getAnchor().distanceTo(here);
}

/** True when the player is farther than leash (+ optional slack) from the anchor. */
export function beyondLeash(host: AnchorHost, here: WorldTile | null = Game.tile(), slack = 0): boolean {
    const d = distanceToAnchor(host, here);
    return d !== null && d > host.leashRadius() + slack;
}

/** True when a world tile sits inside the leash circle around the anchor. */
export function tileWithinLeash(host: AnchorHost, tile: WorldTile, slack = 0): boolean {
    return host.getAnchor().distanceTo(tile) <= host.leashRadius() + slack;
}

/**
 * Anchor tile for a run: preset location spot if provided, else the player's
 * current tile (start-where-you-stand). Pure — no Game reads beyond `here`.
 */
export function resolveRunAnchor(here: WorldTile, locationSpot: Tile | null | undefined): Tile {
    if (locationSpot) {
        return locationSpot;
    }
    return new Tile(here.x, here.z, here.level);
}

/**
 * Task that walks home when the player drifts past leash + slack.
 * Prefer this over per-script ReturnToAnchor class copies.
 */
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
