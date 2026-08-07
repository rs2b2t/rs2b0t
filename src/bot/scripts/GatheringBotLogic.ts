/**
 * Pure GatheringBot policy helpers (unit-tested, no live client).
 * Kept separate so task modules can import without circular deps on the bot class.
 */
import { combatBreaksGather } from './TickManipLogic.js';

/** Hostile NPCs that should keep us from re-entering camp after a kite (wildy). */
export function hostileAttackerNearby(
    npcs: readonly {
        inCombat: boolean;
        targetsMe: () => boolean;
        targetsAnotherPlayer: () => boolean;
        actions: () => string[];
        distance: () => number;
    }[],
    radius = 8
): boolean {
    const r = Math.max(1, Math.floor(radius));
    return npcs.some(n => {
        if (n.distance() > r) {
            return false;
        }
        if (!n.actions().includes('Attack')) {
            return false;
        }
        // On us, or fighting in our face (multi-combat pack).
        if (n.targetsMe()) {
            return true;
        }
        if (n.inCombat && !n.targetsAnotherPlayer() && n.distance() <= 2) {
            return true;
        }
        return false;
    });
}

/**
 * Whether FleeCombat should take the loop (multi-combat kite).
 *
 * Sticky `inCombat` with no face target is common after randoms / login and used
 * to trigger blind east walks that bung gather for tens of seconds. Only kite
 * when a real attacker is in play; yield to random-event handling otherwise.
 */
export function shouldFleeCombat(opts: {
    inCombat: boolean;
    eventPending: boolean;
    hasAttacker: boolean;
}): boolean {
    return opts.inCombat && !opts.eventPending && opts.hasAttacker;
}

export function shouldYieldGathering(
    eventPending: boolean,
    inventoryFull: boolean,
    dialogPending: boolean,
    targetGone: boolean,
    inCombat = false,
    /** When true (retaliate tick-manip), combat alone does not break the gather wait. */
    allowCombat = false
): boolean {
    return (
        eventPending ||
        inventoryFull ||
        dialogPending ||
        targetGone ||
        combatBreaksGather(inCombat, allowCombat)
    );
}

export function fishingSessionBroken(opts: {
    eventPending: boolean;
    inventoryFull: boolean;
    dialogPending: boolean;
    inCombat: boolean;
    spotGone: boolean;
    spotMoved: boolean;
    becameWhirlpool: boolean;
    /** When true (Tannerfishing / retaliate), combat alone does not break the session. */
    allowCombat?: boolean;
}): boolean {
    return (
        opts.eventPending ||
        opts.inventoryFull ||
        opts.dialogPending ||
        combatBreaksGather(opts.inCombat, opts.allowCombat === true) ||
        opts.spotGone ||
        opts.spotMoved ||
        opts.becameWhirlpool
    );
}
