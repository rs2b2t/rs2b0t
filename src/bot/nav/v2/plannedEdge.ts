/**
 * Microbot-style PlannedEdge: the frontier step the walker cannot yet cross.
 * Used by recovery resolvers (Phase 3).
 */

import type { NavPoint } from './types.js';

export interface PlannedEdge {
    from: NavPoint;
    to: NavPoint;
}

export type ObstacleResolution =
    | { kind: 'not_applicable' }
    | { kind: 'crossed' }
    | { kind: 'interacted' }
    | { kind: 'walk_to_origin'; tile: NavPoint }
    | { kind: 'waiting' }
    | { kind: 'abort'; reason: string };

export function plannedEdge(from: NavPoint, to: NavPoint): PlannedEdge {
    return { from, to };
}

export function isAdjacentSameLevel(edge: PlannedEdge): boolean {
    return (
        edge.from.level === edge.to.level
        && Math.max(Math.abs(edge.from.x - edge.to.x), Math.abs(edge.from.z - edge.to.z)) === 1
    );
}

export function isCrossLevel(edge: PlannedEdge): boolean {
    return edge.from.level !== edge.to.level;
}
