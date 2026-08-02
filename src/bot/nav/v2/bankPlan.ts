/**
 * Path-scoped bank planner (Microbot banking planner shape).
 *
 * Pathfind as if bank items were held, inspect **only** items required by
 * transports on the chosen route, withdraw only those — never random tele runes.
 */

import type { Waypoint } from '../PathFinder.js';
import type { WorldStateData } from './worldStateData.js';
import { worldStateFromData } from './worldStateData.js';
import { SPELL_TELEPORTS, JEWELLERY_TELEPORTS } from './teleportCatalog.js';
import { specialCrossingAt } from '../data/specialCrossings.js';

/** Flat cost for opening bank + withdrawing (tile-equivalent). */
export const WITHDRAW_COST = 50;

export interface MissingItem {
    name: string;
    count: number;
}

export interface BankPlanInput {
    /** Cost of walking direct with real inventory (no bank). */
    directCost: number;
    /** True if direct path already uses a teleport hop. */
    directHasTeleport: boolean;
    /** Cost from current tile to nearest bank stand. */
    toBankCost: number;
    /** Cost bank → dest with virtual bank items. */
    bankToDestCost: number;
    /** Items missing from inventory that the virtual path needs. */
    missing: MissingItem[];
}

export type BankPlan =
    | { action: 'skip'; reason: string }
    | { action: 'bank'; missing: MissingItem[]; estimatedCost: number };

/**
 * Merge required item counts from a path into a name → count map.
 */
export function itemsRequiredByWaypoints(waypoints: Waypoint[]): Record<string, number> {
    const need: Record<string, number> = {};
    const bump = (name: string, count: number): void => {
        if (count <= 0) {
            return;
        }
        need[name] = Math.max(need[name] ?? 0, count);
    };

    for (const wp of waypoints) {
        const t = wp.transport;
        if (!t) {
            continue;
        }
        if (t.teleportId) {
            const dest =
                SPELL_TELEPORTS.find(d => d.teleportId === t.teleportId)
                ?? JEWELLERY_TELEPORTS.find(d => d.teleportId === t.teleportId);
            if (dest?.requires?.items) {
                for (const it of dest.requires.items) {
                    bump(it.name, it.count);
                }
            }
            // Jewellery: plan-time requires the ring/glory **in inventory**
            // (PathFinder scans state.items via inventoryNameMatchesJewellery).
            // We do **not** path-scoped bank-withdraw jewellery here (runes/tolls only).
            // There is no bank-cache of jewellery for routing unless a caller passes
            // bankItemCounts and PathFinder is given a virtualized state.
            continue;
        }
        // Door / special crossing tolls keyed at approach tile.
        const sc = specialCrossingAt(t.locX, t.locZ, wp.level);
        if (sc?.requires) {
            bump(sc.requires.item, sc.requires.count);
        }
    }
    return need;
}

/** Items on the path the player does not currently hold enough of. */
export function missingItemsForPath(waypoints: Waypoint[], state: WorldStateData): MissingItem[] {
    const ws = worldStateFromData(state);
    const need = itemsRequiredByWaypoints(waypoints);
    const missing: MissingItem[] = [];
    for (const [name, count] of Object.entries(need)) {
        const have = ws.itemCount(name);
        if (have < count) {
            missing.push({ name, count: count - have });
        }
    }
    return missing;
}

/**
 * Decide whether a bank leg is cheaper than walking direct.
 * Pure — callers supply path costs from the pathfinder.
 */
export function planBankLeg(input: BankPlanInput): BankPlan {
    if (input.directHasTeleport) {
        return { action: 'skip', reason: 'direct path already uses teleport' };
    }
    if (input.missing.length === 0) {
        return { action: 'skip', reason: 'no missing items on virtual path' };
    }
    const via = input.toBankCost + WITHDRAW_COST + input.bankToDestCost;
    if (via >= input.directCost) {
        return {
            action: 'skip',
            reason: `bank route cost ${via} >= direct ${input.directCost}`
        };
    }
    return { action: 'bank', missing: input.missing, estimatedCost: via };
}

export function pathHasTeleport(waypoints: Waypoint[]): boolean {
    return waypoints.some(
        w => w.transport?.teleportId !== undefined || w.transport?.kind === 'teleport'
    );
}
