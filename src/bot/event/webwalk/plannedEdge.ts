/**
 * PlannedEdge: the frontier hop the walker cannot yet cross (door, ladder, tele).
 * Used by recovery resolvers (Phase 3).
 */

import type { NavPoint } from './types.js';

interface PlannedEdge {
    from: NavPoint;
    to: NavPoint;
}


export function plannedEdge(from: NavPoint, to: NavPoint): PlannedEdge {
    return { from, to };
}

export function isAdjacentSameLevel(edge: PlannedEdge): boolean {
    return (
        edge.from.level === edge.to.level
        && Math.max(Math.abs(edge.from.x - edge.to.x), Math.abs(edge.from.z - edge.to.z)) === 1
    );
}
