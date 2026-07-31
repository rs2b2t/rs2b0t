import { JP_STAGE, JUNGLE_POTION_QUEST } from '../quests/defs/junglepotion.js';

/** `oc_param(rogues_purse, identified_herb_level)`. */
export const IDENTIFY_LEVEL = 3;
/** `oc_param(rogues_purse, identified_herb_exp)` / 10. */
export const IDENTIFY_XP = 2.5;
/** The wall is dead below `^junglepotion_get_rogues_purse` — started is not enough. */
export const WALL_STAGE = JP_STAGE.GET_ROGUES_PURSE;

export const IDENTIFY_OP = 'Identify';
export const DROP_OP = 'Drop';

export const COINS = 'Coins';
/**
 * The Karamja ship is a `Pay-fare` SpecialCrossing, and the navigator prunes crossings it
 * cannot pay for — so an empty pack makes the whole island read as `unreachable` rather than
 * as "you are broke". Must stay in step with `nav/data/specialCrossings.ts`.
 */
export const FARE = 30;
/** Enough for the crossing plus the Al Kharid toll gate on the way. */
export const FARE_FLOAT = 100;

const NOTHING_OF_INTEREST = /unfortunately,?\s+you find nothing of interest/i;
const CANNOT_IDENTIFY = /you cannot identify this herb/i;

/** The wall refused the search: `%junglepotion` is below {@link WALL_STAGE}. */
export function isStageRefusal(text: string): boolean {
    return NOTHING_OF_INTEREST.test(text);
}

/** The identify refused: Herblore is below {@link IDENTIFY_LEVEL}. */
export function isLevelRefusal(text: string): boolean {
    return CANNOT_IDENTIFY.test(text);
}

export interface GateState {
    herbloreLevel: number;
    /** Journal stage from `readJungleProgress`; undefined when the journal would not read. */
    stage: number | undefined;
}

export type Gate = { ok: true } | { ok: false; reason: string };

const RUN_THE_QUEST = `run AIOQuester with ${JUNGLE_POTION_QUEST} first`;

/** Both engine gates, checked before the walk to Karamja rather than after it. */
export function checkGates(state: GateState): Gate {
    if (state.herbloreLevel < IDENTIFY_LEVEL) {
        return {
            ok: false,
            reason:
                `Herblore ${IDENTIFY_LEVEL} required to identify a Rogues purse (have ${state.herbloreLevel})`
                + ' — identify guams elsewhere first'
        };
    }
    if (state.stage === undefined) {
        return { ok: false, reason: `could not read the ${JUNGLE_POTION_QUEST} journal` };
    }
    if (state.stage >= WALL_STAGE) {
        return { ok: true };
    }
    if (state.stage <= JP_STAGE.NOT_STARTED) {
        return { ok: false, reason: `${JUNGLE_POTION_QUEST} not started — ${RUN_THE_QUEST}` };
    }
    return {
        ok: false,
        reason:
            `Trufitus hasn't asked for the Rogues purse yet (${JUNGLE_POTION_QUEST} stage ${state.stage}, `
            + `need ${WALL_STAGE}) — ${RUN_THE_QUEST}`
    };
}

export interface Point {
    x: number;
    z: number;
}

function dist(a: Point, b: Point): number {
    return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * Cost of banking at `bank` on the way from `here` to `dest`, rather than distance from the
 * player. A bank behind us is a there-and-back detour even when it is the closest one: from the
 * Lumbridge death spawn Al Kharid is nearest, but it is 50 tiles the wrong way and the walk
 * afterwards comes straight back past Draynor.
 */
export function detourCost(here: Point, bank: Point, dest: Point): number {
    return dist(here, bank) + dist(bank, dest);
}

/** Candidate banks for the fare trip, cheapest detour first. */
export function rankBanksByDetour<T extends { tile: Point }>(here: Point, dest: Point, banks: readonly T[]): T[] {
    return [...banks].sort((a, b) => detourCost(here, a.tile, dest) - detourCost(here, b.tile, dest));
}

export type CycleAction = 'continue' | 'identify' | 'drop' | 'search';

export interface CycleState {
    /** A search's `~objbox` is suspended on `p_pausebutton` until this is cleared. */
    continuePending: boolean;
    unids: number;
    identified: number;
    freeSlots: number;
}

/**
 * One tick's packets. `opheld` runs inline during decode while `oploc` resolves in the
 * movement phase, so this burst pipelines: identify and drop act on what the pack already
 * holds and the search lands after them. Four user events, inside the engine's five.
 */
export function planCycle(state: CycleState): CycleAction[] {
    const plan: CycleAction[] = [];
    if (state.continuePending) {
        plan.push('continue');
    }
    if (state.unids > 0) {
        plan.push('identify');
    }
    if (state.identified > 0) {
        plan.push('drop');
    }
    if (state.freeSlots > 0) {
        plan.push('search');
    }
    return plan;
}
