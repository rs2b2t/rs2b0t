import Tile from './Tile.js';

/**
 * Cooking surface catalog for Fisher cook loops and CookBot.
 *
 * Server data: loc types in content `cooking_sources.loc` (category cooking_oven /
 * cooking_fire). World placements scanned from the local engine map pack
 * (`debugname=range` → {@link COOKING_RANGE_LOCS}).
 *
 * Fishing camps pin a preferred {@link CookingSurface} when one is within a
 * useful walk of the pier; otherwise GatheringBot falls back to live scene
 * Locs.query for Range/Fire.
 */

export type CookSurfaceKind = 'range' | 'fire' | 'fireplace';

export interface CookingSurface {
    /**
     * Final stand next to the cook surface (path destination after any approach).
     * FishCook walks here (via walkOpening) and then uses the Range/Fire in leash.
     */
    stand: Tile;
    /**
     * Optional intermediate waypoint (e.g. exterior of a Large door). Walked first so
     * pathfinding enters a building complex before aiming at the interior range tile.
     */
    approach?: Tile;
    /** Loc query name (Range / Fire / Fireplace). */
    locName: string;
    kind: CookSurfaceKind;
    /** Optional map loc SW tile (for docs / nearest search). */
    loc?: Tile;
    label?: string;
    notes?: string;
}

/** Auto-curated Range loc SW tiles from Server map pack (debugname=range).
 * Stand tile defaults to one step south (forceapproach=east ranges still path).
 * Regenerated via tools/nav map probe — do not hand-edit coords without re-scan.
 */
export const COOKING_RANGE_LOCS: readonly { x: number; z: number; level: number }[] = [
    { x: 2445, z: 3188, level: 0 },
    { x: 2459, z: 3173, level: 0 },
    { x: 2547, z: 3322, level: 0 },
    { x: 2549, z: 3098, level: 0 },
    { x: 2566, z: 3104, level: 0 },
    { x: 2571, z: 3248, level: 0 },
    { x: 2578, z: 3198, level: 0 },
    { x: 2591, z: 3209, level: 0 },
    { x: 2616, z: 3396, level: 0 },
    { x: 2617, z: 3317, level: 0 },
    { x: 2630, z: 4731, level: 0 },
    { x: 2632, z: 3163, level: 0 },
    { x: 2636, z: 3170, level: 0 },
    { x: 2637, z: 3432, level: 0 },
    { x: 2642, z: 3355, level: 0 },
    { x: 2648, z: 3297, level: 0 },
    { x: 2706, z: 3404, level: 0 },
    { x: 2715, z: 3476, level: 0 },
    { x: 2733, z: 3582, level: 0 },
    { x: 2758, z: 4731, level: 0 },
    { x: 2787, z: 3191, level: 0 },
    { x: 2814, z: 3161, level: 0 },
    { x: 2817, z: 3444, level: 0 },
    { x: 2818, z: 3455, level: 0 },
    { x: 2822, z: 3351, level: 0 },
    { x: 2844, z: 3367, level: 0 },
    { x: 2856, z: 3334, level: 0 },
    { x: 2917, z: 3318, level: 0 },
    { x: 2922, z: 9713, level: 0 },
    { x: 2933, z: 4698, level: 0 },
    { x: 2967, z: 3331, level: 0 },
    { x: 2970, z: 3209, level: 0 },
    { x: 2971, z: 3328, level: 0 },
    { x: 2988, z: 3365, level: 0 },
    { x: 3019, z: 3237, level: 0 },
    { x: 3036, z: 3342, level: 0 },
    { x: 3036, z: 3708, level: 0 },
    { x: 3039, z: 3367, level: 0 },
    { x: 3046, z: 3375, level: 0 },
    { x: 3052, z: 3356, level: 0 },
    { x: 3097, z: 3367, level: 0 },
    { x: 3151, z: 9558, level: 0 },
    { x: 3156, z: 3410, level: 0 },
    { x: 3160, z: 3427, level: 0 },
    { x: 3188, z: 3352, level: 0 },
    { x: 3219, z: 3388, level: 0 },
    { x: 3221, z: 3497, level: 0 },
    { x: 3223, z: 3497, level: 0 },
    { x: 3229, z: 3401, level: 0 },
    { x: 3230, z: 3196, level: 0 },
    { x: 3236, z: 3382, level: 0 },
    { x: 3237, z: 3403, level: 0 },
    { x: 3237, z: 3409, level: 0 },
    { x: 3271, z: 3180, level: 0 },
    { x: 3280, z: 3929, level: 0 },
    { x: 3286, z: 3486, level: 0 },
    { x: 3286, z: 3489, level: 0 },
    { x: 3292, z: 3202, level: 0 },
    { x: 3318, z: 3138, level: 0 },
    { x: 2448, z: 3510, level: 1 },
    { x: 2482, z: 3479, level: 1 },
    { x: 2763, z: 3274, level: 1 },
    { x: 3081, z: 3508, level: 1 },
    { x: 3143, z: 3452, level: 1 },
    { x: 3145, z: 3452, level: 1 },
    { x: 3202, z: 3401, level: 1 },
];


/** Stand one tile south of the loc SW corner (safe default for 1x2 ranges). */
export function rangeStandFromLoc(loc: { x: number; z: number; level: number }): Tile {
    return new Tile(loc.x, loc.z - 1, loc.level);
}

export function chebyshev(
    a: { x: number; z: number; level?: number },
    b: { x: number; z: number; level?: number }
): number {
    if ((a.level ?? 0) !== (b.level ?? 0)) {
        return Number.POSITIVE_INFINITY;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/** Nearest catalog Range to `origin` within maxCheb (same plane). */
export function nearestCookingRange(
    origin: { x: number; z: number; level?: number },
    maxCheb = 64
): CookingSurface | null {
    const level = origin.level ?? 0;
    let best: { loc: (typeof COOKING_RANGE_LOCS)[number]; d: number } | null = null;
    for (const loc of COOKING_RANGE_LOCS) {
        if (loc.level !== level) continue;
        const d = chebyshev(origin, loc);
        if (d > maxCheb) continue;
        if (!best || d < best.d) best = { loc, d };
    }
    if (!best) return null;
    return {
        stand: rangeStandFromLoc(best.loc),
        loc: new Tile(best.loc.x, best.loc.z, best.loc.level),
        locName: 'Range',
        kind: 'range',
        label: `Range @ ${best.loc.x},${best.loc.z}`,
        notes: `cheb ${best.d} from origin`
    };
}

/**
 * Which surface to prefer for a cook mode:
 * - **pier** — cook-then-bank: cook near the fishing spot (full raw pack walk short)
 * - **bank** — bank-raw-then-cook: cook near the bank (withdraw → cook → re-bank)
 */
export type CookSurfaceRole = 'pier' | 'bank';

export interface FishCampCookPlan {
    /** Near the pier / camp spot (cook-then-bank). */
    pier?: CookingSurface;
    /** Near the bank booth (bank-raw-then-cook). Falls back to pier if omitted. */
    bank?: CookingSurface;
}

const CATHERBY_RANGE: CookingSurface = {
    stand: new Tile(2817, 3443, 0),
    loc: new Tile(2817, 3444, 0),
    locName: 'Range',
    kind: 'range',
    label: 'Catherby range (bank house)',
    notes: 'Door/gate; good for both pier and bank cook modes'
};

/**
 * Curated cook surfaces for fishing camps.
 *
 * Seers pier range uses a stand **outside the Sinclair Large door** so pathing
 * walks through the gate complex instead of aiming at the interior range tile
 * and getting stuck on the wrong side of doors.
 */
export const FISH_CAMP_COOK_PLANS: Readonly<Record<string, FishCampCookPlan>> = {
    Catherby: {
        pier: CATHERBY_RANGE,
        bank: CATHERBY_RANGE
    },
    'Seers (fly fishing)': {
        pier: {
            // Two-step path: (1) exterior of Large door (2) stand east of range
            // (Range forceapproach=east in cooking_sources.loc).
            approach: new Tile(2740, 3570, 0),
            stand: new Tile(2735, 3581, 0),
            loc: new Tile(2733, 3582, 0),
            locName: 'Range',
            kind: 'range',
            label: 'Sinclair mansion range (Large-door approach)',
            notes: 'approach→open Large door→east-of-range stand'
        },
        // Town range SW of Seers bank — interior of the house (south of range is street).
        // Door@2713,3483 from the bank; stand north of the range (inside).
        bank: {
            approach: new Tile(2713, 3484, 0),
            stand: new Tile(2716, 3477, 0),
            loc: new Tile(2715, 3476, 0),
            locName: 'Range',
            kind: 'range',
            label: 'Seers village range (near bank)',
            notes: 'approach Door@2713,3483 → stand north of range (interior)'
        }
    },
    'Fishing Guild': {
        pier: {
            stand: new Tile(2616, 3395, 0),
            loc: new Tile(2616, 3396, 0),
            locName: 'Range',
            kind: 'range',
            label: 'Ardougne range S of guild',
            notes: 'Outside guild fence; walk after bank/dock'
        }
    },
    'Barbarian Village': {
        pier: {
            stand: new Tile(3079, 3444, 0),
            loc: new Tile(3078, 3445, 0),
            locName: 'Fire',
            kind: 'fire',
            label: 'Barb outdoor fires',
            notes: 'No Range in village; cook on Fire'
        }
    },
    'Draynor Village': {
        // Fireplace is inside the house; 3100,3255 (south) is street-side and useOn can't reach.
        // Enter via Door@3101,3258 (east wall), stand north of the fireplace.
        pier: {
            approach: new Tile(3102, 3258, 0),
            stand: new Tile(3100, 3257, 0),
            loc: new Tile(3100, 3256, 0),
            locName: 'Fireplace',
            kind: 'fireplace',
            label: 'Draynor house fireplace',
            notes: 'approach Door@3101,3258 → stand north of fireplace (interior)'
        },
        bank: {
            approach: new Tile(3102, 3258, 0),
            stand: new Tile(3100, 3257, 0),
            loc: new Tile(3100, 3256, 0),
            locName: 'Fireplace',
            kind: 'fireplace',
            label: 'Draynor house fireplace',
            notes: 'approach Door@3101,3258 → stand north of fireplace (interior)'
        }
    }
};

/** @deprecated Prefer {@link FISH_CAMP_COOK_PLANS} + role; kept for simple pier lookup. */
export const FISH_CAMP_COOK_SURFACES: Readonly<Record<string, CookingSurface>> = Object.fromEntries(
    Object.entries(FISH_CAMP_COOK_PLANS).map(([k, v]) => [k, v.pier ?? v.bank!])
);

export function cookSurfaceForFishCamp(
    campName: string,
    role: CookSurfaceRole = 'pier'
): CookingSurface | null {
    const plan = FISH_CAMP_COOK_PLANS[campName];
    if (!plan) {
        return null;
    }
    if (role === 'bank') {
        return plan.bank ?? plan.pier ?? null;
    }
    return plan.pier ?? plan.bank ?? null;
}

/**
 * Prefer curated camp surface for the cook role, else nearest Range to `spot`.
 * Pass camp bank stand as `spot` when role is `bank` to prefer nearby ovens.
 */
export function resolveFishCampCookSurface(
    campName: string | null | undefined,
    spot: { x: number; z: number; level?: number },
    maxCheb = 64,
    role: CookSurfaceRole = 'pier'
): CookingSurface | null {
    if (campName) {
        const curated = cookSurfaceForFishCamp(campName, role);
        if (curated) {
            return curated;
        }
    }
    return nearestCookingRange(spot, maxCheb);
}

/** One harness row: path from a camp spot (or bank) to a curated cook surface. */
export type FishCampRangePathCase = {
    id: string;
    camp: string;
    role: CookSurfaceRole;
    surface: CookingSurface;
};

/**
 * Expand {@link FISH_CAMP_COOK_PLANS} into pier (+ distinct bank) path cases.
 * Used by `tools/gatheringbot-range-path-test.ts`.
 */
export function listFishCampRangePathCases(): FishCampRangePathCase[] {
    const out: FishCampRangePathCase[] = [];
    for (const [camp, plan] of Object.entries(FISH_CAMP_COOK_PLANS)) {
        const slug = camp.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
        if (plan.pier) {
            out.push({
                id: `range-path-${slug}-pier`,
                camp,
                role: 'pier',
                surface: plan.pier
            });
        }
        if (plan.bank) {
            const sameAsPier =
                plan.pier
                && plan.bank.stand.x === plan.pier.stand.x
                && plan.bank.stand.z === plan.pier.stand.z
                && plan.bank.stand.level === plan.pier.stand.level
                && plan.bank.locName === plan.pier.locName;
            if (!sameAsPier) {
                out.push({
                    id: `range-path-${slug}-bank`,
                    camp,
                    role: 'bank',
                    surface: plan.bank
                });
            }
        }
    }
    return out;
}
