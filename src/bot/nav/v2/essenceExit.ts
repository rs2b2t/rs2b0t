/**
 * Essence mine exit — session multiloc transport.
 *
 * Content (`essence_mine.rs2`): entry wizards set `%exit_essence_mine_coord`;
 * every `blankrunestone_exit_portal` placement telejumps to that varp (not a
 * per-placement fixed dest). Client varp pack id: 64.
 */

import type { TransportEdgeData } from '../PathFinder.js';
import { packNavPoint, parseLcCoord } from './lcCoord.js';
import type { NavPoint } from './types.js';

const parse = parseLcCoord;

/** Client/server varp index for exit_essence_mine_coord (varp.pack). */
export const EXIT_ESSENCE_MINE_VARP = 64;

/** Surface return stands (runecraft.constant) — same as ESSENCE_RETURN in travelCatalog. */
export const ESSENCE_EXIT_RETURNS = {
    aubury: parse('0_50_53_53_9'),
    sedridor: parse('0_48_149_34_36'),
    distentor: parse('0_40_48_31_14'),
    brimstail: parse('0_37_153_22_18'),
    cromperty: parse('0_41_51_60_58')
} as const;

export type EssenceReturnId = keyof typeof ESSENCE_EXIT_RETURNS;

/** Stable order for PathFinder path-state packing (0 = unknown / fail-open). */
export const ESSENCE_RETURN_IDS: readonly EssenceReturnId[] = [
    'aubury',
    'sedridor',
    'distentor',
    'brimstail',
    'cromperty'
] as const;

/** 0 = unknown; 1..n = ESSENCE_RETURN_IDS[i-1]. */
export function essenceReturnStateIndex(id: string | undefined): number {
    if (id === undefined) {
        return 0;
    }
    const i = ESSENCE_RETURN_IDS.indexOf(id as EssenceReturnId);
    return i >= 0 ? i + 1 : 0;
}

export function essenceReturnIdFromStateIndex(idx: number): EssenceReturnId | undefined {
    if (idx <= 0) {
        return undefined;
    }
    return ESSENCE_RETURN_IDS[idx - 1];
}

/** Mine-side portal approaches (walkable stands next to blankrunestone_exit_portal placements). */
export const ESSENCE_EXIT_PORTALS: readonly {
    from: NavPoint;
    locX: number;
    locZ: number;
    debug: string;
}[] = [
    { from: { x: 2886, z: 4849, level: 0 }, locX: 2885, locZ: 4850, debug: 'ess_exit_nw' },
    { from: { x: 2890, z: 4814, level: 0 }, locX: 2889, locZ: 4813, debug: 'ess_exit_sw' },
    { from: { x: 2931, z: 4854, level: 0 }, locX: 2932, locZ: 4854, debug: 'ess_exit_ne' },
    { from: { x: 2932, z: 4816, level: 0 }, locX: 2933, locZ: 4815, debug: 'ess_exit_se' }
];

const PACKED_RETURNS: { id: EssenceReturnId; packed: number; tile: NavPoint }[] = (
    Object.entries(ESSENCE_EXIT_RETURNS) as [EssenceReturnId, NavPoint][]
).map(([id, tile]) => ({ id, tile, packed: packNavPoint(tile) }));

/** Match a packed coord varp (or world tile) to a known return id. */
export function essenceReturnIdFromPacked(packed: number): EssenceReturnId | null {
    if (packed === 0) {
        return null;
    }
    for (const row of PACKED_RETURNS) {
        if (row.packed === packed) {
            return row.id;
        }
    }
    // map_findsquare can land 0–2 tiles off the constant — match by proximity
    const live = {
        level: (packed >> 28) & 0x3,
        x: (packed >> 14) & 0x3fff,
        z: packed & 0x3fff
    };
    return essenceReturnIdFromTile(live);
}

export function essenceReturnIdFromTile(tile: NavPoint): EssenceReturnId | null {
    let best: EssenceReturnId | null = null;
    let bestD = 4; // exclusive: must be within 3
    for (const [id, t] of Object.entries(ESSENCE_EXIT_RETURNS) as [EssenceReturnId, NavPoint][]) {
        if (t.level !== tile.level) {
            continue;
        }
        const d = Math.max(Math.abs(t.x - tile.x), Math.abs(t.z - tile.z));
        if (d < bestD) {
            bestD = d;
            best = id;
        }
    }
    return best;
}

export function essenceReturnTile(id: EssenceReturnId): NavPoint {
    return ESSENCE_EXIT_RETURNS[id];
}

/**
 * Plan-time edges: each portal placement × each known return.
 *
 * Content (`blankrunestone_exit_portal`): destination is `%exit_essence_mine_coord`
 * (set by the entry wizard) then `map_findsquare(..., 0, 2, lineofwalk)` — fully
 * determined by session return, not which of the four portal tiles you click.
 * That session is modelled via `requires.essenceExitReturn` + PathFinder path-state
 * (#377). **Not** blacklisted: the landing is fixed given entry wizard (wizard tile ±2).
 *
 * Entry *into* the mine remains blacklisted (#388) — random over 22 pads.
 */
export function essenceExitEdges(): TransportEdgeData[] {
    const out: TransportEdgeData[] = [];
    for (const portal of ESSENCE_EXIT_PORTALS) {
        for (const [returnId, to] of Object.entries(ESSENCE_EXIT_RETURNS) as [EssenceReturnId, NavPoint][]) {
            out.push({
                from: { ...portal.from },
                to: { ...to },
                locName: 'Portal',
                action: 'Use',
                kind: 'portal',
                locId: 2492,
                locX: portal.locX,
                locZ: portal.locZ,
                options: ['Use'],
                debugName: `${portal.debug}_to_${returnId}`,
                requires: { essenceExitReturn: returnId }
            });
        }
    }
    return out;
}
