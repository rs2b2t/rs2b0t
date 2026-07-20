import Tile from '../api/Tile.js';

/**
 * Pure cake-stall knowledge — no client imports so it runs under plain
 * `bun test` (ArdyFighterLogic pattern). Encodes the East Ardougne Baker's
 * stall layout and the engine's steal outcomes (content
 * skill_thieving/stalls/stealing.rs2, verified 2026-07-20):
 *
 *  - Every attempt prints the CHAT line "You attempt to steal ..." BEFORE the
 *    guard/owner checks run.
 *  - A guard (Guard/Knight/Paladin/Hero) within 5 tiles WITH line of sight
 *    catches the theft and retaliates -> combat, nothing stolen.
 *  - The Baker within 5 tiles with LOS refuses the theft silently client-side
 *    (his "Hey! Get your hands off there!" is npc_say OVERHEAD text, not a
 *    chat message) -> no loot, no combat.
 *  - For 10 ticks after any combat every steal prints "You can't steal from
 *    the market stall during combat!".
 *
 * Strategy (2026-07-20 design): no line-of-sight prediction — classify what
 * actually happened and react. Outcomes over predictions.
 */

/** The stall loc itself (behind its counter, not standable). */
export const STALL_TILE = new Tile(2667, 3310, 0);
/** THE stand — highest live steal-success rate (user-verified). Market-side
 *  and behind-the-stall stands alert the guards/Baker far more often. */
export const STAND = new Tile(2668, 3312, 0);
/** Where a refusal streak resets to: ~8 tiles north, outside the Baker's
 *  5-tile catch radius and off the market side, until he drifts. */
export const RESET_TILE = new Tile(2668, 3320, 0);
export const STALL_NAME = 'Baker\'s stall';
export const STALL_OP = 'Steal from';
/** What the stall yields (content stealing.dbrow) — contains-matched, so the
 *  cake bite-stages ('2/3 cake', 'Slice of cake') count too. */
export const CAKE_ITEMS = ['cake', 'bread', 'chocolate slice'];

/** Engine: steals are refused until %lastcombat + 10 <= map_clock. */
export const LOCKOUT_TICKS = 10;
/** Consecutive refused/no-op steals before walking off to reset. */
export const RESET_AFTER_REFUSALS = 3;

export type StealOutcome = 'success' | 'caught' | 'lockout' | 'refused' | 'timeout';

/** Signals gathered while resolving one steal click. */
export interface StealSignals {
    /** Carried stall-food count rose. */
    gained: boolean;
    /** Game.inCombat() is up — a guard caught us (when nothing was gained). */
    combat: boolean;
    /** The 10-tick post-combat lockout chat line was seen. */
    lockoutSeen: boolean;
    /** The "You attempt to steal" chat line was seen (the click registered). */
    attemptSeen: boolean;
}

/** What one steal click actually did, in signal-priority order. */
export function classifySteal(s: StealSignals): StealOutcome {
    if (s.gained) {
        return 'success';
    }
    if (s.combat) {
        return 'caught';
    }
    if (s.lockoutSeen) {
        return 'lockout';
    }
    if (s.attemptSeen) {
        return 'refused';
    }
    return 'timeout';
}

/** Walk off and let the Baker drift once refusals stack this high. */
export function shouldReset(consecutiveRefusals: number): boolean {
    return consecutiveRefusals >= RESET_AFTER_REFUSALS;
}
