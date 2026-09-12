/** Apply curated state-aware activations: strip disabledReason and attach requires. */

import type { TransportEdgeData } from './PathFinder.js';
import { activationForEdge, isStateDeferredReason } from './stateAwareRequires.js';
import type { TransportRequires } from './types.js';

type EdgeWithRequires = TransportEdgeData & { requires?: TransportRequires };

/** Pipeline rows to routable edges; a state-deferred row with a curated activation becomes active with its requires. */
export function activateTransportRows(rows: readonly TransportEdgeData[]): EdgeWithRequires[] {
    const out: EdgeWithRequires[] = [];
    for (const edge of rows) {
        const act = activationForEdge(edge);
        if (edge.disabledReason && act && isStateDeferredReason(edge.disabledReason)) {
            const { disabledReason: _d, ...rest } = edge;
            out.push({ ...rest, requires: act.requires });
            continue;
        }
        out.push(edge);
    }
    return out;
}
