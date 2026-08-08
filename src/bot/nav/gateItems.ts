/**
 * Why a route came back `unreachable`.
 *
 * A* prunes an item-gated crossing when the player cannot pay for it, so the
 * region behind it stops existing and the verdict is a bare "unreachable" — the
 * same word a genuine nav-data island produces. The Kharidian desert has exactly
 * one baked entrance (the Shantay pass), so a bot with no pass reads as though
 * the desert were not in the pack at all.
 *
 * Re-probing with every gate item virtualized separates the two: if the route
 * appears, the blocker is a shopping list, not the graph.
 */

import { missingItemsForPath, type MissingItem } from './bankPlan.js';
import { SPECIAL_CROSSINGS } from './data/specialCrossings.js';
import type { PathResult } from './Navigator.js';
import { WEB_SLASH_KNIFE_NAME } from './slashTool.js';
import { virtualizeWithItems } from './virtualState.js';
import type { WorldStateData } from './worldStateData.js';

/**
 * Every item a baked special crossing can demand, at the largest count any one
 * of them asks for. Derived from the crossing table so a new toll cannot leave
 * its item out of the diagnosis.
 */
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

/**
 * Items that would turn an `unreachable` verdict into a route.
 *
 * @param probe runs the same path request against a supplied state.
 * @returns what the player is short of, or `[]` when the kit does not help —
 *          which means the destination really is off the graph.
 */
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
