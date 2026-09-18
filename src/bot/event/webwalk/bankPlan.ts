// Why: virtualize bank stock, then withdraw only the items used by the chosen route.

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
    /** Cost bank to dest with virtual bank items. */
    bankToDestCost: number;
    /** Items missing from inventory that the virtual path needs. */
    missing: MissingItem[];
}

type BankPlan =
    | { action: 'skip'; reason: string }
    | { action: 'bank'; missing: MissingItem[]; estimatedCost: number };

/** Merge required item counts from a path into a name to count map. */
export function itemsRequiredByWaypoints(waypoints: Waypoint[]): Record<string, number> {
    const need: Record<string, number> = {};
    const bump = (name: string, count: number): void => {
        if (count <= 0) {
            return;
        }
        // Why: sum consumable fares across hops; reusable keys and tools use their peak count.
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
            // Jewellery routing only sees inventory or an explicitly virtualized bank snapshot.
            continue;
        }
        // Why: resolve gates from the approach stand, which may differ from the loc tile.
        const prev = waypoints[i - 1] ?? wp;
        const sc = specialCrossingForTransport(
            t,
            { x: prev.x, z: prev.z, level: prev.level },
            { x: wp.x, z: wp.z, level: wp.level }
        );
        if (sc?.requires) {
            bump(sc.requires.item, sc.requires.count);
        }
        // Withdraw a plain Knife unless a held or worn blade can already slash webs.
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
    // A held slash tool means no Knife withdrawal.
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

/** Whether a bank leg is cheaper than walking direct; pure, callers supply the pathfinder costs. */
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
