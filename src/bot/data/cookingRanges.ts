import Tile from '../geometry/Tile.js';
import { COOKING_SURFACE_LOCS } from './cookSurfaceLocs.js';

/**
 * Cooking surface catalog for Fisher cook loops: loc types from content `cooking_sources.loc` (category cooking_oven / cooking_fire), world placements generated into {@link COOKING_SURFACE_LOCS} by `bun run gen:cooksurfaces`.
 * Why: fishing camps pin a preferred {@link CookingSurface} only when one is within a useful walk of the pier, and GatheringBot otherwise falls back to live scene Locs.query for Range/Fire.
 */

type CookSurfaceKind = 'range' | 'fire' | 'fireplace';

interface CookingSurface {
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

/**
 * Range loc SW tiles, the oven slice of the generated {@link COOKING_SURFACE_LOCS}.
 * Why: the stand tile defaults to one step south, and forceapproach=east ranges still path.
 */
export const COOKING_RANGE_LOCS: readonly { x: number; z: number; level: number }[] = COOKING_SURFACE_LOCS
    .filter(surface => surface.name === 'Range')
    .map(({ x, z, level }) => ({ x, z, level }));


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
 * Which surface to prefer for a cook mode.
 * `pier` is cook-then-bank near the fishing spot (the full raw pack walks short); `bank` is bank-raw-then-cook near the bank (withdraw → cook → re-bank).
 */
export type CookSurfaceRole = 'pier' | 'bank';

interface FishCampCookPlan {
    /** Near the pier / camp spot (cook-then-bank). */
    pier?: CookingSurface;
    /** Near the bank booth (bank-raw-then-cook). Falls back to pier if omitted. */
    bank?: CookingSurface;
}

export const CATHERBY_RANGE: CookingSurface = {
    stand: new Tile(2817, 3443, 0),
    loc: new Tile(2817, 3444, 0),
    locName: 'Range',
    kind: 'range',
    label: 'Catherby range (bank house)',
    notes: 'Door/gate; good for both pier and bank cook modes'
};

/**
 * Curated cook surfaces for fishing camps.
 * Why: the Seers pier range stands outside the Sinclair Large door so pathing walks the gate complex instead of aiming at the interior range tile and sticking on the wrong side of doors.
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
        // Town range SW of Seers bank, interior of the house (south of range is street).
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
type FishCampRangePathCase = {
    id: string;
    camp: string;
    role: CookSurfaceRole;
    surface: CookingSurface;
};

/**
 * Expand {@link FISH_CAMP_COOK_PLANS} into pier (+ distinct bank) path cases.
 * Used by `e2e/gatheringbot-range-path-test.ts`.
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
