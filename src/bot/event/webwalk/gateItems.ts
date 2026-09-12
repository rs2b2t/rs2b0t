// Why: retry with virtual gate items to distinguish missing supplies from a gap in the nav pack.

import { missingItemsForPath, type MissingItem } from './bankPlan.js';
import { SPECIAL_CROSSINGS } from './data/specialCrossings.js';
import type { PathResult } from './Navigator.js';
import { WEB_SLASH_KNIFE_NAME } from './slashTool.js';
import { virtualizeWithItems } from './virtualState.js';
import type { WorldStateData } from './worldStateData.js';

// Derive this from the crossing table so new toll items are included automatically.

/** Every item a baked special crossing can demand, at the largest count any one of them asks for. */
export function gateItemCandidates(): Record<string, number> {
    const out: Record<string, number> = { [WEB_SLASH_KNIFE_NAME]: 1 };
    for (const crossing of SPECIAL_CROSSINGS) {
        const req = crossing.requires;
        if (!req) {
            continue;
        }
        out[req.item] = Math.max(out[req.item] ?? 0, req.count);
    }
    return out;
}

// Why: an empty result means the kit doesn't help, so the destination is off the graph.

/** Items that would turn an `unreachable` verdict into a route; `probe` runs the same path request against a supplied state. */
export async function explainUnreachable(
    probe: (state: WorldStateData) => Promise<PathResult>,
    state: WorldStateData
): Promise<MissingItem[]> {
    const withKit = await probe(virtualizeWithItems(state, gateItemCandidates()));
    if (!withKit.ok) {
        return [];
    }
    return missingItemsForPath(withKit.waypoints, state);
}
