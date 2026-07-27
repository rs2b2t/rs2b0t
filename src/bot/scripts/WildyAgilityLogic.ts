import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from '../api/Tile.js';

/** Course geometry — known-good wilderness agility course layout. */
export const COURSE_OBSTACLES = ['obstacle pipe', 'ropeswing', 'stepping stone', 'log balance', 'rocks'] as const;
export const COURSE_CENTRE = new Tile(2998, 3945, 0);
/** North of the ridge door — used for region math only. Never walk here from the south. */
export const COURSE_ENTRANCE = new Tile(2998, 3924, 0);
/**
 * Ridge Door tile. Pathfinder treats this as a multi-tile door transport; walking
 * to any destination north of it from the south will Open the door automatically.
 */
export const RIDGE_DOOR = new Tile(2998, 3917, 0);
/**
 * Stand tile immediately south of the ridge Door. Approach / fail-recovery walks
 * must target this (or further south) so only the script's ridge.interact crosses.
 */
export const RIDGE_APPROACH = new Tile(2998, 3916, 0);
export const COURSE_RADIUS = 16; // gate at 2998,3931 is ~14 tiles from centre
export const ENTRY_RADIUS = 10;
export const SEARCH_RADIUS = 20;
/** Obstacle pits (ropeswing / log) teleport far above the course in world-z. */
export const PIT_Z_GAP = 2000;
export const RIDGE_MIN_AGILITY = 52;
export const EDGEVILLE_BANK = new Tile(3094, 3493, 0);
export const GATE_TILE = new Tile(2998, 3931, 0);

export const RIDGE_NAME = 'Door';
export const RIDGE_OP = 'Open';
export const GATE_NAME = 'Gate';
export const GATE_OP = 'Open';
export const PIT_LADDER_OP = 'Climb-up';

/** Starting-side tiles used when recovering from a failed / wrong-side attempt. */
export const OBSTACLE_START: Readonly<Record<string, WorldTile>> = {
    'obstacle pipe': { x: 3004, z: 3937, level: 0 },
    ropeswing: { x: 3005, z: 3952, level: 0 },
    'stepping stone': { x: 3002, z: 3960, level: 0 },
    'log balance': { x: 3002, z: 3945, level: 0 },
    rocks: { x: 2994, z: 3937, level: 0 }
};

// --- Chat patterns (type-0 game messages via GameMessages) ---

/** Clicked an obstacle from the wrong approach side (no damage). */
export const WRONG_SIDE = /^(?:you cannot do that from here|you can't? enter the pipe from this side)/i;

/**
 * Immediate fail lines for course obstacles. Stepping-stone lava is included but
 * does not change scenes — it only knocks the player back.
 */
export const PIT_FALL =
    /(?:you slip and fall into the pit below|you lose your footing and fall into the lava|you slip and fall onto the spikes below)/i;

/** Ridge entry success — server: "You skillfully balance across the ridge..." */
export const RIDGE_SUCCESS = /you skillfully balance across the ridge/i;

/** Ridge entry failure — server: "You lose your footing and fall into the wolf pit." */
export const RIDGE_FAIL = /you lose your footing and fall into the wolf pit/i;

export type RidgeOutcome = 'success' | 'fail' | 'interrupted' | 'timeout';

export interface RidgeSignals {
    xpGained: boolean;
    successMessage: boolean;
    failMessage: boolean;
    /**
     * Same-scene wolf-pit fall (ridge fail). Distinct from obstacle `inPit` z-gap:
     * the wolf pit does NOT teleport the player to a high world-z scene.
     */
    inWolfPit: boolean;
    interrupted: boolean;
    settled: boolean;
}

export function classifyRidge(s: RidgeSignals): RidgeOutcome {
    if (s.interrupted) {
        return 'interrupted';
    }
    // Fail before success: a residual success line must not mask a fresh fail.
    // XP only arrives on a true balance, so it still counts as success when present.
    if (s.failMessage || s.inWolfPit) {
        return 'fail';
    }
    if (s.xpGained || s.successMessage) {
        return 'success';
    }
    return 'timeout';
}

export type ObstacleSettleReason =
    | 'xp'
    | 'pit'
    | 'cant_reach'
    | 'wrong_side'
    | 'pit_fall_msg'
    | 'interrupted'
    | 'low_hp'
    | 'timeout';

export interface ObstacleSignals {
    xpGained: boolean;
    inPit: boolean;
    cantReach: boolean;
    wrongSide: boolean;
    pitFallMessage: boolean;
    interrupted: boolean;
    lowHp: boolean;
    settled: boolean;
}

/** Classify a finished obstacle wait. Priority matches the previous RunLap branches. */
export function classifyObstacle(s: ObstacleSignals): ObstacleSettleReason {
    if (s.xpGained) {
        return 'xp';
    }
    if (s.inPit) {
        return 'pit';
    }
    if (s.interrupted) {
        return 'interrupted';
    }
    if (s.wrongSide) {
        return 'wrong_side';
    }
    if (s.pitFallMessage) {
        return 'pit_fall_msg';
    }
    if (s.cantReach) {
        return 'cant_reach';
    }
    if (s.lowHp) {
        return 'low_hp';
    }
    return 'timeout';
}

export function parseObstacles(csv: string): string[] {
    return csv
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
}

export function getStartTile(obstacleName: string): WorldTile | null {
    return OBSTACLE_START[obstacleName.toLowerCase()] ?? null;
}

/** Chebyshev distance on the same plane. */
export function inRegion(here: WorldTile, centre: WorldTile, radius: number): boolean {
    return here.level === centre.level && Math.max(Math.abs(here.x - centre.x), Math.abs(here.z - centre.z)) <= radius;
}

export function awayFromCourse(
    here: WorldTile,
    centre: WorldTile,
    courseRadius: number,
    entrance: WorldTile,
    entryRadius: number
): boolean {
    return !inRegion(here, centre, courseRadius) && !inRegion(here, entrance, entryRadius);
}

export function insideCourseProper(
    here: WorldTile,
    centre: WorldTile,
    courseRadius: number,
    entrance: WorldTile,
    entryRadius: number
): boolean {
    return inRegion(here, centre, courseRadius) && !inRegion(here, entrance, entryRadius);
}

/**
 * Obstacle pit (ropeswing / log balance / pipe): server teleports the player to a
 * high world-z scene. Ridge wolf-pit fails stay in the same scene — do NOT use this.
 */
export function inPit(here: WorldTile, courseCentre: WorldTile, zGap: number = PIT_Z_GAP): boolean {
    return here.level === courseCentre.level && here.z - courseCentre.z > zGap;
}

/** True when standing on the south (outside) side of the ridge Door. */
export function southOfRidge(here: WorldTile, door: WorldTile = RIDGE_DOOR): boolean {
    return here.level === door.level && here.z <= door.z;
}

export function nearTile(here: WorldTile, dest: WorldTile, radius: number): boolean {
    return here.level === dest.level && Math.max(Math.abs(here.x - dest.x), Math.abs(here.z - dest.z)) <= radius;
}

/** Ready to click the ridge: near the south stand, not already north of the door. */
export function atRidgeApproach(here: WorldTile, approach: WorldTile = RIDGE_APPROACH, radius: number = 2): boolean {
    return nearTile(here, approach, radius) && southOfRidge(here);
}

/**
 * Human-like pause after clearing an obstacle. One game tick is 600ms; we need
 * the character to settle before the next click or the first attempt is wasted.
 */
export function reactionMs(rng: () => number = Math.random): number {
    return rng() < 0.1 ? 1200 + rng() * 1800 : 600 + rng() * 900;
}
