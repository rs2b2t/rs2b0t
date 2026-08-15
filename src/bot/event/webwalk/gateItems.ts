// Why: A* prunes an item-gated crossing when the player cannot pay for it, so the region behind it stops existing and the verdict is a bare "unreachable" — the same word a nav-data island produces.
// Why: the Kharidian desert has one baked entrance, the Shantay pass, so a bot with no pass reads as though the desert were not in the pack at all.
// Why: re-probing with every gate item virtualized separates the two — if the route appears, the blocker is a shopping list rather than the graph.

import { missingItemsForPath, type MissingItem } from './bankPlan.js';
import { SPECIAL_CROSSINGS } from './data/specialCrossings.js';
import type { PathResult } from './Navigator.js';
import { WEB_SLASH_KNIFE_NAME } from './slashTool.js';
import { virtualizeWithItems } from './virtualState.js';
import type { WorldStateData } from './worldStateData.js';

// Why: derived from the crossing table so a new toll cannot leave its item out of the diagnosis.

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

// Why: an empty result means the kit does not help, so the destination is off the graph rather than behind a toll.

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
