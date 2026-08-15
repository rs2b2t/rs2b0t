// Why: this curates the re-enable of edges the transport pipeline left as `disabledReason: state-aware…` where a plan-time gate is known.
// Why: multi-destination and dialogue-state ladders (Horror, Watchtower maze, …) stay disabled, since a wrong dest is worse than a long walk.
// Why: keyed by content-pack `debugName` when present, otherwise `locName|action`.

import type { TransportRequires } from './types.js';

interface StateAwareActivation {
    /** Match TransportEdgeData.debugName when present. */
    debugName?: string;
    locName?: string;
    action?: string;
    requires: TransportRequires;
    /** Human note for docs / regen audits. */
    note: string;
}

/**
 * Safe single-destination activations. Expand only with Server-script evidence.
 */
export const STATE_AWARE_ACTIVATIONS: readonly StateAwareActivation[] = [
    {
        debugName: 'monasteryladder',
        requires: {
            members: true,
            skills: [{ name: 'prayer', level: 31 }]
        },
        note: 'Edgeville monastery upper floor — 31 Prayer (members guild).'
    }
    // Multi-dest / dialog-state ladders (Horror, Watchtower, board games, …) stay
    // disabled — add here only with Server-script evidence for a single dest.
];

export function activationForEdge(edge: {
    debugName?: string;
    locName?: string;
    action?: string;
}): StateAwareActivation | undefined {
    if (edge.debugName) {
        const byDebug = STATE_AWARE_ACTIVATIONS.find(a => a.debugName === edge.debugName);
        if (byDebug) {
            return byDebug;
        }
    }
    return STATE_AWARE_ACTIVATIONS.find(
        a =>
            a.locName !== undefined
            && a.action !== undefined
            && a.locName === edge.locName
            && a.action === edge.action
    );
}

/** True when disabledReason is only “state deferred”, not permanently broken. */
export function isStateDeferredReason(reason: string | undefined): boolean {
    if (!reason) {
        return false;
    }
    return /state-aware transports are deferred|depends on player or world state|runtime quest\/skill\/inv guard/i.test(
        reason
    );
}
