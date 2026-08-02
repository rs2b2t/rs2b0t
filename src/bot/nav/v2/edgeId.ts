import type { NavPoint, TransportEdge, TransportKind } from './types.js';

function pointKey(p: NavPoint): string {
    return `${p.x},${p.z},${p.level}`;
}

/**
 * Stable id for a transport edge. Prefer loc placement when present so reverse
 * hops and multi-action locs stay distinguishable.
 */
export function transportEdgeId(parts: {
    kind: TransportKind;
    from: NavPoint;
    to: NavPoint;
    locId?: number;
    action?: string;
}): string {
    const loc = parts.locId !== undefined ? `loc${parts.locId}` : 'noloc';
    const action = parts.action ?? '';
    return `${parts.kind}|${pointKey(parts.from)}>${pointKey(parts.to)}|${loc}|${action}`;
}

export function ensureEdgeId(edge: Omit<TransportEdge, 'id'> & { id?: string }): string {
    if (edge.id) {
        return edge.id;
    }
    return transportEdgeId({
        kind: edge.kind,
        from: edge.from,
        to: edge.to,
        locId: edge.loc?.locId,
        action: edge.loc?.action
    });
}
