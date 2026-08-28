import type { WorldTile } from '../adapter/ClientAdapter.js';
import type { BankLocation } from '../api/bank/BankLocations.js';
import Tile from '../geometry/Tile.js';
import { COOKING_SURFACE_LOCS } from './cookSurfaceLocs.js';
import type { CookSurfaceKind, CookSurfaceLoc } from './cookSurfaceTypes.js';
import { cookSurfaceForFishCamp, rangeStandFromLoc } from './cookingRanges.js';

/**
 * Pairs a bank with the cook surface nearest to it, for CookBot's Range mode.
 * Fire mode ignores the surface and lights its own, so a bank with none still earns a row.
 * @see api/cooking/CookLocations.ts for the table bound to the live bank list.
 */

/** Location setting that hands control back to the raw bankStand / rangeStand tiles. */
export const CUSTOM_LOCATION = 'Custom';

/** How far from a bank a surface may sit and still count as that bank's. */
export const MAX_SURFACE_CHEB = 20;

// Why: a derived stand is one tile south of the loc, which is right for a 1x2 range and a guess for anything else, so the walk arrives near and lets useOn close the gap.
const DERIVED_ARRIVE_RADIUS = 2;

const DEFAULT_OBSTACLES: readonly string[] = ['door', 'gate'];

interface CookSurfacePlan {
    /** Final walk destination. */
    stand: Tile;
    /** Walked first, so pathing enters a building before aiming at an interior tile. */
    approach?: Tile;
    /** Loc query name: Range / Fireplace / Cooking pot. */
    locName: string;
    kind: CookSurfaceKind;
    /** The loc's own tile, for distance checks and logs. */
    loc: Tile;
    /** Arrival tolerance for the walk to {@link stand}. */
    arriveRadius: number;
    label: string;
}

export interface CookLocation {
    name: string;
    bank: BankLocation;
    /** Null when nothing cookable sits within {@link MAX_SURFACE_CHEB}: fire mode only. */
    surface: CookSurfacePlan | null;
    obstacles: readonly string[];
    /** True only for hand-checked stands; a derived stand has never been walked. */
    verified: boolean;
}

function cheb(a: WorldTile, b: WorldTile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/** Closest cookable loc to `origin`, ovens first so the lower burn rate wins ties. */
export function nearestCookSurface(origin: WorldTile, maxCheb = MAX_SURFACE_CHEB): CookSurfaceLoc | null {
    let best: { surface: CookSurfaceLoc; d: number } | null = null;
    for (const surface of COOKING_SURFACE_LOCS) {
        if (surface.level !== origin.level) {
            continue;
        }
        const d = cheb(origin, surface);
        if (d > maxCheb) {
            continue;
        }
        if (!best || betterSurface(surface, d, best)) {
            best = { surface, d };
        }
    }
    return best?.surface ?? null;
}

function betterSurface(surface: CookSurfaceLoc, d: number, cur: { surface: CookSurfaceLoc; d: number }): boolean {
    const oven = surface.kind === 'oven';
    const curOven = cur.surface.kind === 'oven';
    if (oven !== curOven) {
        return oven;
    }
    return d < cur.d;
}

function derivePlan(surface: CookSurfaceLoc): CookSurfacePlan {
    return {
        stand: rangeStandFromLoc(surface),
        locName: surface.name,
        kind: surface.kind,
        loc: new Tile(surface.x, surface.z, surface.level),
        arriveRadius: DERIVED_ARRIVE_RADIUS,
        label: `${surface.name} @ ${surface.x},${surface.z}`
    };
}

// Why: these three stands were walked by hand for the fishing camps, doors and all, so the derivation must not overwrite them with a one-south guess.
const CURATED_CAMP: Readonly<Record<string, string>> = {
    Catherby: 'Catherby',
    Seers: 'Seers (fly fishing)',
    Draynor: 'Draynor Village'
};

function curatedPlan(bankName: string): CookSurfacePlan | null {
    const camp = CURATED_CAMP[bankName];
    if (!camp) {
        return null;
    }
    const surface = cookSurfaceForFishCamp(camp, 'bank');
    if (!surface) {
        return null;
    }
    return {
        stand: surface.stand,
        approach: surface.approach,
        locName: surface.locName,
        kind: surface.kind === 'range' ? 'oven' : 'fire',
        loc: surface.loc ?? surface.stand,
        arriveRadius: 0,
        label: surface.label ?? surface.locName
    };
}

function pairBankWithSurface(bank: BankLocation): CookLocation {
    const curated = curatedPlan(bank.name);
    const derived = curated ? null : nearestCookSurface(bank.tile);
    return {
        name: bank.name,
        bank,
        surface: curated ?? (derived ? derivePlan(derived) : null),
        obstacles: DEFAULT_OBSTACLES,
        verified: curated !== null
    };
}

export function buildCookLocations(banks: readonly BankLocation[]): CookLocation[] {
    return banks.map(pairBankWithSurface);
}

export function findCookLocation(locs: readonly CookLocation[], name: string): CookLocation | null {
    const wanted = name.trim().toLowerCase();
    return locs.find(l => l.name.toLowerCase() === wanted) ?? null;
}
