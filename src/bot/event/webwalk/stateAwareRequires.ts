import type { NavPoint, TransportRequires } from './types.js';

interface StateAwareActivation {
    debugName?: string;
    locName?: string;
    action?: string;
    from?: NavPoint;
    to?: NavPoint;
    requires: TransportRequires;
    note: string;
}

export const STATE_AWARE_ACTIVATIONS: readonly StateAwareActivation[] = [
    {
        debugName: 'monasteryladder',
        requires: {
            members: true,
            skills: [{ name: 'prayer', level: 31 }]
        },
        note: 'Edgeville monastery upper floor — 31 Prayer (members guild).'
    },
    {
        debugName: 'horror_ladder_down',
        from: { x: 2507, z: 3644, level: 0 },
        to: { x: 2518, z: 9994, level: 1 },
        requires: { quests: [{ quest: 'Horror from the Deep', minStatus: 'complete' }] },
        note: 'Postquest Lighthouse basement entrance.'
    },
    {
        debugName: 'horror_ladder_top',
        from: { x: 2510, z: 3644, level: 0 },
        to: { x: 2518, z: 9994, level: 1 },
        requires: { quests: [{ quest: 'Horror from the Deep', minStatus: 'complete' }] },
        note: 'Postquest Lighthouse basement entrance.'
    },
    {
        debugName: 'horror_ladder_base',
        from: { x: 2519, z: 9995, level: 1 },
        to: { x: 2510, z: 3644, level: 0 },
        requires: { quests: [{ quest: 'Horror from the Deep', minStatus: 'complete' }] },
        note: 'Postquest Lighthouse basement exit.'
    },
    {
        debugName: 'horror_ladder_base2',
        from: { x: 2515, z: 10008, level: 0 },
        to: { x: 2515, z: 10005, level: 1 },
        requires: { quests: [{ quest: 'Horror from the Deep', minStatus: 'complete' }] },
        note: 'Postquest dagannoth floor exit.'
    }
];

export function activationForEdge(edge: {
    debugName?: string;
    locName?: string;
    action?: string;
    from?: NavPoint;
    to?: NavPoint;
}): StateAwareActivation | undefined {
    const candidates = STATE_AWARE_ACTIVATIONS.filter(
        a => (!a.from || (a.from.x === edge.from?.x && a.from.z === edge.from.z && a.from.level === edge.from.level))
            && (!a.to || (a.to.x === edge.to?.x && a.to.z === edge.to.z && a.to.level === edge.to.level))
    );
    if (edge.debugName) {
        const byDebug = candidates.find(a => a.debugName === edge.debugName);
        if (byDebug) {
            return byDebug;
        }
    }
    return candidates.find(
        a => a.locName !== undefined && a.action !== undefined
            && a.locName === edge.locName && a.action === edge.action
    );
}

/** True when disabledReason is only "state deferred" and the row isn't permanently broken. */
export function isStateDeferredReason(reason: string | undefined): boolean {
    if (!reason) {
        return false;
    }
    return /state-aware transports are deferred|depends on player or world state|runtime quest\/skill\/inv guard/i.test(
        reason
    );
}
