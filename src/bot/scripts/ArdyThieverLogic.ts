import Tile from '../api/Tile.js';
import { PICKPOCKET_TARGETS } from './PickpocketTargets.js';

/**
 * Pure ArdyThiever knowledge — no client imports so it runs under plain
 * `bun test` (ArdyFighterLogic pattern). Encodes the East Ardougne market
 * layout the bot used to take as settings: where each pickpocket target
 * hangs out, what Thieving level it needs, and which NPCs a caught stall
 * theft can turn hostile.
 */

export interface TargetSpot {
    anchor: Tile;
    leash: number;
}

// Anchors/leashes derived from the engine's packed data. The leash must cover
// each target's whole ROAM ENVELOPE — max over its market spawns (n40_51/
// n41_51) of cheb(anchor, spawn) PLUS the npc's maxrange (npc.dat opcode 201,
// the engine's hard cap on drift from a spawn; wander destinations are
// spawn±wanderrange, combat drag is bounded by maxrange). Covering only the
// SPAWN tiles starved candidates() whenever the wanderers dwelt past the
// ring: Knights (wanderrange 15!) spent most of their time outside the old
// r12, wedging the bot idle ("stuck, knights out of leash", live). Envelopes:
// Guard 7 spawns d≤12 + maxrange 7 = 19; Knight x4 d≤12 + 17 = 29; the two
// market Paladins d≤4 + 4 = 8 (12 kept for slack); market-side Heroes
// ((2647,3306) + (2667,3316)) d≤10 + 7 = 17 — Hero's far-SW spawn (2630,3288)
// stays deliberately outside (market-side only). All four anchors are a short
// walk from the Baker's stall (2667,3310) and the south bank (2655,3286).
const SPOTS: Record<string, TargetSpot> = {
    'Guard': { anchor: new Tile(2661, 3306, 0), leash: 19 },
    'Knight of Ardougne': { anchor: new Tile(2661, 3306, 0), leash: 29 },
    'Paladin': { anchor: new Tile(2655, 3311, 0), leash: 12 },
    'Hero': { anchor: new Tile(2657, 3311, 0), leash: 17 }
};

/** The thieving spot for a dropdown target; unknown names get the Guard spot. */
export function targetSpot(target: string): TargetSpot {
    return SPOTS[target] ?? SPOTS['Guard'];
}

/** Thieving level the pickpocket needs (content pickpocket table); unknown → 1. */
export function requiredThieving(target: string): number {
    return PICKPOCKET_TARGETS.find(t => t.name === target)?.level ?? 1;
}

// A caught stall theft retaliates with the market's human hostiles: the
// stall's LOS-blocker is always an Ardougne Guard, and the Baker's
// "Guards guards!" alert additionally pulls any Knight/Paladin/Hero within 5
// tiles of him (content stall_owner_alert_guards).
export const HOSTILE_NAMES: readonly string[] = ['Guard', 'Knight of Ardougne', 'Paladin', 'Hero'];

export interface AttackerCandidate {
    name: string | null;
    inCombat: boolean;
    distance: number;
    actions: string[];
    /** The npc's face/interaction target is a DIFFERENT player (someone else's
     *  fight — Npc.targetsAnotherPlayer()). We must not attack these. */
    targetsAnotherPlayer: boolean;
}

/** Is this NPC plausibly the one attacking US — a market hostile, currently in
 *  combat, close enough to be meleeing us, actually attackable, and NOT already
 *  locked onto another player. `inCombat` alone is true for ANY fight, so
 *  without the target check FightBack steals a guard mid-fight with someone else
 *  (live bug 2026-07-20). */
export function isHostileAttacker(c: AttackerCandidate, maxDistance: number): boolean {
    return c.name !== null
        && HOSTILE_NAMES.includes(c.name)
        && c.inCombat
        && !c.targetsAnotherPlayer
        && c.distance <= maxDistance
        && c.actions.includes('Attack');
}

/**
 * Pick which in-leash target to pickpocket. Candidates come nearest-first;
 * return the nearest REACHABLE one. Fixating on the nearest target regardless
 * of reachability is what wedges the bot when the closest knight wanders to a
 * spot we can't stand next to (a fenced market edge — reachable() is false):
 * the old code funnelled that into a minutes-long walk-to-open loop and never
 * tried the reachable knights standing right there. When NONE are reachable
 * (all wandered behind walls, or we're boxed in), returns {target: null,
 * blocked: nearest} so the caller can attempt ONE bounded path-clear toward
 * the nearest rather than pickpocket nothing.
 */
export function chooseTarget<T>(candidatesNearestFirst: T[], reachable: (t: T) => boolean): { target: T | null; blocked: T | null } {
    for (const c of candidatesNearestFirst) {
        if (reachable(c)) {
            return { target: c, blocked: null };
        }
    }
    return { target: null, blocked: candidatesNearestFirst[0] ?? null };
}
