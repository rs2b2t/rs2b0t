// docs/NAV.md
// Why: one raw loc type can exist at many tiles, so identity here is the placement (level + tile) rather than the name alone.
// Why: the optional closed and open ids describe the raw and effective forms at that placement (trapdoor → open trapdoor).
// Why: `valid()` answers whether the live scene still has this placement in an interactable form, or already open for Open-actions.

import type { TransportInfo } from './PathFinder.js';

/** Where scenery lives in the world (map placement). */
interface LocPlacement {
    level: number;
    x: number;
    z: number;
}

/**
 * Stable reference to a nav-relevant loc placement.
 * Built from TransportInfo / door edges; used for match + validity.
 */
export interface LocRef {
    placement: LocPlacement;
    /** Closed / map-placement id when known. */
    locId?: number;
    /** Action-bearing open-state id (closed trapdoor → open). */
    openLocId?: number;
    name?: string;
    action?: string;
    /** Chebyshev slack for pack stands vs clickable tile (default 3). */
    slack?: number;
}

export function locPlacementKey(p: LocPlacement): string {
    return `${p.level}|${p.x}|${p.z}`;
}

/** Build a LocRef from a compiled transport hop. */
export function locRefFromTransport(transport: TransportInfo, level = 0): LocRef {
    // Slashable webs sit one tile apart (e.g. Yanille 2569/2570,3118) with the same
    // locId. Slack 3 would match the neighbour and double-slash; exact placement only.
    const webSlash =
        /^slash$/i.test(transport.action ?? '') && /web/i.test(transport.locName ?? '');
    return {
        placement: { level, x: transport.locX, z: transport.locZ },
        locId: transport.locId,
        openLocId: transport.openLocId,
        name: transport.locName,
        action: transport.action,
        slack: webSlash ? 0 : 3
    };
}

export function locRefFromDoor(
    door: { x: number; z: number; level: number; locId?: number; locName?: string }
): LocRef {
    return {
        placement: { level: door.level, x: door.x, z: door.z },
        locId: door.locId,
        name: door.locName,
        action: 'Open',
        slack: 3
    };
}

/**
 * Whether a live loc instance matches this placement ref (id + near tile).
 * Pure — no scene query.
 */
export function matchesLocRef(
    ref: LocRef,
    loc: { readonly id: number; tile(): { x: number; z: number } }
): boolean {
    const tile = loc.tile();
    const slack = ref.slack ?? 3;
    const near =
        Math.max(Math.abs(tile.x - ref.placement.x), Math.abs(tile.z - ref.placement.z)) <= slack;

    if (ref.locId === undefined && ref.openLocId === undefined) {
        return near;
    }

    const idOk =
        (ref.locId !== undefined && loc.id === ref.locId)
        || (ref.openLocId !== undefined && loc.id === ref.openLocId);
    if (!idOk) {
        return false;
    }

    // Closed map placement: prefer exact tile, allow small slack (ships/gangplanks).
    if (ref.locId !== undefined && loc.id === ref.locId) {
        return (
            (tile.x === ref.placement.x && tile.z === ref.placement.z)
            || near
        );
    }
    // Open transform may sit a tile off the recorded placement.
    return near;
}

// Why: `matching` means an interactable form was found, closed or open id.
// Why: `openLeaf` means an Open-action barrier already shows Close, so it counts as not shut.
// Why: `missing` means nothing sits at the placement, so the edge may be stale after a map change.
type LocRefProbe =
    | { status: 'matching' }
    | { status: 'openLeaf' }
    | { status: 'missing' };

export interface LocSceneSnap {
    id: number;
    name: string | null;
    actions: readonly string[];
    x: number;
    z: number;
}

/**
 * Classify scene snaps against a placement ref (pure; pass Locs.query results).
 */
export function probeLocRef(ref: LocRef, scene: readonly LocSceneSnap[]): LocRefProbe {
    const slack = ref.slack ?? 3;
    const near = (s: LocSceneSnap) =>
        Math.max(Math.abs(s.x - ref.placement.x), Math.abs(s.z - ref.placement.z)) <= slack;

    const matching = scene.some(s => {
        if (!near(s)) {
            return false;
        }
        if (ref.locId === undefined && ref.openLocId === undefined) {
            return true;
        }
        return (
            (ref.locId !== undefined && s.id === ref.locId)
            || (ref.openLocId !== undefined && s.id === ref.openLocId)
        );
    });
    if (matching) {
        return { status: 'matching' };
    }

    // Slashable web already cut: content loc_change → bigweb_slashed ("Slashed web").
    if (ref.action && /^slash$/i.test(ref.action) && ref.name && /web/i.test(ref.name)) {
        const slashed = scene.some(
            s =>
                Math.max(Math.abs(s.x - ref.placement.x), Math.abs(s.z - ref.placement.z)) <= 1
                && /slashed\s*web/i.test(s.name ?? '')
        );
        if (slashed) {
            return { status: 'openLeaf' };
        }
    }

    // Barrier already open: same name near placement with Close option.
    if (ref.action && /^open$/i.test(ref.action) && ref.name) {
        const openLeaf = scene.some(
            s =>
                near(s)
                && s.name === ref.name
                && s.actions.some(a => a !== null && /^close$/i.test(a))
        );
        if (openLeaf) {
            return { status: 'openLeaf' };
        }
    }

    return { status: 'missing' };
}

/** True when the placement is still usable for planning/execution. */
export function locRefValid(ref: LocRef, scene: readonly LocSceneSnap[]): boolean {
    const p = probeLocRef(ref, scene);
    return p.status === 'matching' || p.status === 'openLeaf';
}

// Why: a name-only ref never reports stale, being too ambiguous to judge.

/** Stale when a known id was expected at the placement and the scene has neither it nor the open transform (map edit, wrong world). */
export function locRefStale(ref: LocRef, scene: readonly LocSceneSnap[]): boolean {
    if (ref.locId === undefined && ref.openLocId === undefined) {
        return false;
    }
    return probeLocRef(ref, scene).status === 'missing';
}
