import { isTeleportKind, type NavPoint, type PathPolicy, type TransportEdge, type TransportKind } from './types.js';

function chebyshev(a: NavPoint, b: NavPoint): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/**
 * Whether a transport kind is enabled by path policy (toggles only — not WorldState).
 * Teleports default ON when policy is absent so catalog edges participate once added;
 * scripts that need pure walk pass `{ useTeleports: false }`.
 */
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

/**
 * Teleport-specific gates: allowlist + distance-before-teleport.
 *
 * `routeSpan` is typically Chebyshev(start, goal). Microbot compares against
 * distance remaining; for A* admission we use the full route span so short
 * same-city walks never open the tele graph. Callers may pass a tighter
 * remaining estimate later.
 */
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
    const minDist = policy?.distanceBeforeTeleport ?? 0;
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
