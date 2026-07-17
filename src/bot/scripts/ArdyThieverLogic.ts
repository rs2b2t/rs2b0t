import Tile from '../api/Tile.js';
import { chebyshev } from '../nav/followMath.js';
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
}

/** Is this NPC plausibly the one attacking us — a market hostile, currently in
 *  combat, close enough to be meleeing us, and actually attackable? */
export function isHostileAttacker(c: AttackerCandidate, maxDistance: number): boolean {
    return c.name !== null
        && HOSTILE_NAMES.includes(c.name)
        && c.inCombat
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

export interface Point {
    x: number;
    z: number;
}

/**
 * Supercover line walk: no tile the segment from `from` to `to` passes
 * through (endpoints excluded) is blocked. An approximation of the engine's
 * `lineofsight` using whole-tile blockers — right for stall counters, which
 * block walk AND sight alike; it doesn't model see-through-but-unwalkable
 * quirks (windows, low fences), which the market stalls don't have.
 */
export function lineClear(blocked: (x: number, z: number) => boolean, from: Point, to: Point): boolean {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const steps = Math.max(Math.abs(dx), Math.abs(dz)) * 2; // half-tile sampling covers diagonal corner cuts
    for (let i = 1; i < steps; i++) {
        const x = Math.round(from.x + (dx * i) / steps);
        const z = Math.round(from.z + (dz * i) / steps);
        if ((x !== from.x || z !== from.z) && (x !== to.x || z !== to.z) && blocked(x, z)) {
            return false;
        }
    }
    return true;
}

/**
 * The engine's stall-owner catch (stealing.rs2 stealing_check_for_owner):
 * a theft is refused while the OWNER npc is within 5 tiles of the player AND
 * has line of sight — "Hey! Get your hands off there!", nothing stolen. The
 * stall's own counter is the sight-blocker that makes the far stand safe.
 */
export function ownerWatching(owner: Point, stand: Point, blocked: (x: number, z: number) => boolean): boolean {
    return chebyshev(owner, stand) <= 5 && lineClear(blocked, owner, stand);
}
