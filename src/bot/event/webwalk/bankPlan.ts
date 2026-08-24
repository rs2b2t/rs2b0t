// Why: the path-scoped bank planner pathfinds as if bank items were held, inspects only items required by transports on the chosen route, and withdraws only those, never speculative tele runes.

import type { Waypoint } from './PathFinder.js';
import type { WorldStateData } from './worldStateData.js';
import { worldStateFromData } from './worldStateData.js';
import { SPELL_TELEPORTS, JEWELLERY_TELEPORTS } from './teleportCatalog.js';
import { specialCrossingForTransport } from './data/specialCrossings.js';
import { isSlashWebTransport, WEB_SLASH_KNIFE_NAME } from './slashTool.js';

import { BANK_WITHDRAW_COST } from './geometry/edgeCosts.js';

/** Flat cost for opening bank + withdrawing (tile-equivalent time). */
export const WITHDRAW_COST = BANK_WITHDRAW_COST;

export interface MissingItem {
    name: string;
    count: number;
}

interface BankPlanInput {
    /** Cost of walking direct with inventory (no bank). */
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

type BankPlan =
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
        // Why: each ship/toll fare is spent on that hop, so Port Sarim→Karamja then Brimhaven→Ardougne is 60 coins, not max(30, 30) (#709).
        // Why: keys and tools are still a peak-hold (one Brass key opens every door that wants it).
        if (name.toLowerCase() === 'coins') {
            need[name] = (need[name] ?? 0) + count;
            return;
        }
        need[name] = Math.max(need[name] ?? 0, count);
    };

    for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i]!;
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
            // Why: plan time requires the ring or glory in inventory, PathFinder scans state.items via inventoryNameMatchesJewellery.
            // Why: jewellery is never withdrawn path-scoped here, only runes and tolls.
            // Why: there is no bank cache of jewellery for routing unless a caller passes bankItemCounts and PathFinder is given a virtualized state.
            continue;
        }
        // Why: door and special-crossing tolls are keyed at the approach stand, which is often not the loc tile, the Shantay pass stand is (3304,3118) while its loc is (3302,3116).
        // Why: resolving the same way the executor does keeps the toll visible; otherwise the region behind it reads as unreachable rather than unpaid.
        const prev = waypoints[i - 1] ?? wp;
        const sc = specialCrossingForTransport(
            t,
            { x: prev.x, z: prev.z, level: prev.level },
            { x: wp.x, z: wp.z, level: wp.level }
        );
        if (sc?.requires) {
            bump(sc.requires.item, sc.requires.count);
        }
        // Slash webs: bank plan withdraws plain Knife when no slash tool held.
        // (Wielded blades also work at execute, no withdraw needed if canSlashWeb.)
        if (isSlashWebTransport(t.locName, t.action)) {
            bump(WEB_SLASH_KNIFE_NAME, 1);
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
        // Already have a slash tool (knife or blade) → do not bank-withdraw Knife.
        if (name === WEB_SLASH_KNIFE_NAME && state.canSlashWeb === true) {
            continue;
        }
        const have = ws.itemCount(name);
        if (have < count) {
            missing.push({ name, count: count - have });
        }
    }
    return missing;
}

/**
 * Decide whether a bank leg is cheaper than walking direct.
 * Pure, callers supply path costs from the pathfinder.
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
