/**
 * Placement-identity for scenery-backed nav (multiloc model).
 *
 * Same raw loc type can exist at many tiles; identity is **placement**
 * (level + tile), not name alone. Optional closed/open ids describe the
 * raw/effective forms at that placement (trapdoor → open trapdoor).
 *
 * `valid()` answers: does the live scene still have this placement in a form
 * we can interact with (or already open for Open-actions)?
 *
 * Docs: docs/NAV.md (multiloc), docs/local/nav-multiloc-plan.md
 */

import type { TransportInfo } from '../PathFinder.js';

/** Where scenery lives in the world (map placement). */
export interface LocPlacement {
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
    return {
        placement: { level, x: transport.locX, z: transport.locZ },
        locId: transport.locId,
        openLocId: transport.openLocId,
        name: transport.locName,
        action: transport.action,
        slack: 3
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

/**
 * Result of probing the live scene for a LocRef.
 * - matching: interactable form found (closed or open id)
 * - openLeaf: Open-action barrier already shows Close (treat as not shut)
 * - missing: nothing at placement — edge may be stale after map change
 */
export type LocRefProbe =
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

/**
 * Stale when we expected a known id at the placement and the scene has neither
 * that id nor the open transform (map edit / wrong world). Name-only refs never
 * report stale (too ambiguous).
 */
export function locRefStale(ref: LocRef, scene: readonly LocSceneSnap[]): boolean {
    if (ref.locId === undefined && ref.openLocId === undefined) {
        return false;
    }
    return probeLocRef(ref, scene).status === 'missing';
}
