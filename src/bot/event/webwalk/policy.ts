import { isTeleportKind, type NavPoint, type PathPolicy, type TransportEdge, type TransportKind } from './types.js';

function chebyshev(a: NavPoint, b: NavPoint): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

// Why: 0 leaves A* cost to decide, since spell and jewellery edges carry time costs in `edgeCosts.ts`.
// Why: a positive floor is set only when a caller wants a hard gate.

/** Default min Chebyshev(start, goal) before a tele edge is admissible. */
export const DEFAULT_DISTANCE_BEFORE_TELEPORT = 0;

// Why: teleports default on when policy is absent so catalog edges participate once added, and scripts wanting pure walk pass `{ useTeleports: false }`.

/** Whether a transport kind is enabled by path policy — toggles only, not WorldState. */
export function kindAllowedByPolicy(kind: TransportKind, policy: PathPolicy | undefined): boolean {
    if (!policy) {
        return true;
    }
    if (isTeleportKind(kind) && policy.useTeleports === false) {
        return false;
    }
    if (kind === 'ship' || kind === 'gangplank') {
        if (policy.useShips === false) {
            return false;
        }
    }
    if (kind === 'shortcut' && policy.useShortcuts === false) {
        return false;
    }
    return true;
}

// Why: `routeSpan` is typically Chebyshev(start, goal), and A* admission uses the route span so short same-city walks never open the tele graph.
// Why: callers may pass a tighter remaining estimate later.

/** Teleport-specific gates: allowlist plus distance-before-teleport. */
export function teleportAllowedByPolicy(
    edge: TransportEdge,
    policy: PathPolicy | undefined,
    routeSpan: number
): { ok: true } | { ok: false; reason: string } {
    if (!isTeleportKind(edge.kind)) {
        return { ok: true };
    }
    if (!kindAllowedByPolicy(edge.kind, policy)) {
        return { ok: false, reason: 'useTeleports=false' };
    }
    if (policy?.allowTeleportIds && policy.allowTeleportIds.length > 0) {
        const id = edge.teleportId;
        if (!id || !policy.allowTeleportIds.includes(id)) {
            return { ok: false, reason: `teleport ${id ?? edge.id} not in allowTeleportIds` };
        }
    }
    if (policy?.denyTeleportIds && policy.denyTeleportIds.length > 0) {
        const id = edge.teleportId;
        if (id && policy.denyTeleportIds.includes(id)) {
            return { ok: false, reason: `teleport ${id} denied for this walk` };
        }
    }
    const minDist = policy?.distanceBeforeTeleport ?? DEFAULT_DISTANCE_BEFORE_TELEPORT;
    if (minDist > 0 && routeSpan < minDist) {
        return {
            ok: false,
            reason: `route span ${routeSpan} < distanceBeforeTeleport ${minDist}`
        };
    }
    return { ok: true };
}

/** Chebyshev start→goal helper for policy admission. Levels ignored (2004 tele landings are L0). */
export function routeSpanChebyshev(from: NavPoint, to: NavPoint): number {
    return chebyshev(from, to);
}
