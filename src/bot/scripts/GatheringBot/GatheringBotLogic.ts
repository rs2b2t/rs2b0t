/**
 * Pure GatheringBot policy helpers (unit-tested, no live client).
 * Kept separate so task modules can import without circular deps on the bot class.
 */
import { wildernessLevelAt, type WildTile } from '../../event/webwalk/wilderness.js';
import { combatBreaksGather } from './TickManipLogic.js';

type GatheringCombatMode =
    | 'standard'
    | 'desert-camp-miner-npc'
    | 'desert-camp-miner-player'
    | 'wilderness-miner-npc'
    | 'wilderness-miner-player';

export interface GatheringCombatPolicy {
    mode: GatheringCombatMode;
    /** Combat may remain active without yielding the gather loop. */
    allowGather: boolean;
    /** WaitStickyCombat / FleeCombat should own combat instead of Gather. */
    flee: boolean;
}

export function wildernessMinerAt(opts: {
    isMiner: boolean;
    tile: WildTile | null;
}): boolean {
    return opts.isMiner && opts.tile !== null && wildernessLevelAt(opts.tile) > 0;
}

// Why: FleeCombat separately requires the local victim's `Game.inCombat()` signal, which cuts false positives from harmless idle or follow face targets.

/** Live incoming-player signal; clears as soon as no loaded player targets us. */
export function incomingPlayerAttacker(
    players: readonly { targetsMe: () => boolean }[]
): boolean {
    return players.some(player => player.targetsMe());
}

/** Re-assert a non-retaliating hostile-camp Miner stance after entry or relogin. */
export function wildernessMinerStanceNeeded(opts: {
    isMiner: boolean;
    tile: WildTile | null;
    tickManipAllowCombat: boolean;
    autoRetaliateOn: boolean;
    desertCampMiner?: boolean;
}): boolean {
    return (
        (wildernessMinerAt(opts) || opts.desertCampMiner === true) &&
        !opts.tickManipAllowCombat &&
        opts.autoRetaliateOn
    );
}

// Why: Wilderness and Desert Camp miners must hold ground through resident NPC combat, while a detectable player attack still restores flee behavior.

/** Resolves the gatherer's live combat policy. */
export function gatheringCombatPolicy(opts: {
    isMiner: boolean;
    tile: WildTile | null;
    incomingPlayerAttacker: boolean;
    autoLocation: boolean;
    tickManipAllowCombat: boolean;
    desertCampMiner?: boolean;
}): GatheringCombatPolicy {
    if (opts.desertCampMiner) {
        return opts.incomingPlayerAttacker
            ? { mode: 'desert-camp-miner-player', allowGather: false, flee: true }
            : { mode: 'desert-camp-miner-npc', allowGather: true, flee: false };
    }
    if (wildernessMinerAt(opts)) {
        if (opts.incomingPlayerAttacker) {
            return {
                mode: 'wilderness-miner-player',
                allowGather: false,
                flee: true
            };
        }
        return {
            mode: 'wilderness-miner-npc',
            allowGather: true,
            flee: false
        };
    }

    return {
        mode: 'standard',
        allowGather: opts.tickManipAllowCombat,
        flee: !opts.autoLocation && !opts.tickManipAllowCombat
    };
}

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

// Why: sticky `inCombat` with no face target is common after randoms and login, and it triggers blind east walks that bung gather for tens of seconds.
// Why: the kite only runs with an attacker in play, and otherwise yields to random-event handling.

/** Whether FleeCombat should take the loop for a multi-combat kite. */
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
