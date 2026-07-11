import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import type Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { Npcs } from '../api/queries/Npcs.js';

// Stealing from a stall while its OWNER (the Baker, at the Ardougne bakery) is
// within ~5 tiles + line of sight gets you caught — the owner shouts "Guards
// guards!" and nearby guards attack (content: skill_thieving stealing.rs2
// `stealing_check_for_owner`). Rather than eat that, step aside until the owner
// wanders back out of range, then resume. Shared by ArdyThiever + ArdyFighter.

/** The stall owner (by name) is within `range` tiles of the steal stand — close
 *  enough to catch a theft. LOS isn't checked client-side (conservative: dodge
 *  whenever he's in range). */
export function ownerNearStall(ownerName: string, stallStand: Tile, range: number): boolean {
    return Npcs.query().name(ownerName).where(n => n.tile().distanceTo(stallStand) <= range).nearest() !== null;
}

export interface DodgeOptions {
    ownerName: string;
    stallStand: Tile;
    dodgeTile: Tile;
    range: number;
    log?: (m: string) => void;
    /** Stop waiting early (combat, death, a random event, etc.). */
    abort?: () => boolean;
}

/**
 * If the stall owner is within catch range of the stand, walk to `dodgeTile` and
 * wait (bounded) until he wanders back out of range, then return true so the
 * caller re-evaluates. Returns false immediately when the owner isn't near, so
 * callers can guard the steal with a single `if (await dodgeStallOwner(...)) return;`.
 */
export async function dodgeStallOwner(opts: DodgeOptions): Promise<boolean> {
    if (!ownerNearStall(opts.ownerName, opts.stallStand, opts.range)) {
        return false;
    }
    opts.log?.(`${opts.ownerName} is by the stall — dodging to ${opts.dodgeTile.x},${opts.dodgeTile.z} until they move off`);
    const here = Game.tile();
    if (!here || opts.dodgeTile.distanceTo(here) > 0) {
        await Traversal.walkTo(opts.dodgeTile, { radius: 0, timeoutMs: 15000, log: m => opts.log?.(`  ${m}`) });
    }
    await Execution.delayUntil(
        () => !ownerNearStall(opts.ownerName, opts.stallStand, opts.range) || (opts.abort?.() ?? false),
        30000
    );
    return true;
}
