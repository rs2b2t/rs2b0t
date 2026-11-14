import { Inventory } from '../../api/inventory/Inventory.js';
import { fletchingLevelForLog, isFletchableLogName } from '../GatheringBot/TickManipLogic.js';

const TREE_FOR_LOG: Readonly<Record<string, string>> = {
    'Logs': 'Tree',
    'Oak logs': 'Oak',
    'Willow logs': 'Willow',
    'Maple logs': 'Maple tree',
    'Yew logs': 'Yew',
    'Magic logs': 'Magic tree'
};

/** The log the selected tree drops, e.g. Willow -> Willow logs. */
export function logForTreeName(treeName: string): string {
    const name = treeName.trim().toLowerCase();
    if (name === 'tree' || name === 'dead tree') {
        return 'Logs';
    }
    if (name.includes('oak')) return 'Oak logs';
    if (name.includes('willow')) return 'Willow logs';
    if (name.includes('maple')) return 'Maple logs';
    if (name.includes('yew')) return 'Yew logs';
    if (name.includes('magic')) return 'Magic logs';
    return 'Logs';
}

/** The tree that drops a given log. */
export function treeForLog(logName: string): string {
    return TREE_FOR_LOG[logName] ?? 'Tree';
}

/**
 * Carrier rule: use the selected tree's log when its Fletching level is met;
 * otherwise fall back to normal Logs from a Tree / Dead tree.
 */
export function carrierName(treeName: string, fletchingLevel: number): string {
    const log = logForTreeName(treeName);
    return fletchingLevel >= fletchingLevelForLog(log) ? log : 'Logs';
}

/** Make-1 component: normal Logs opens skill_multi3 (8889); other logs open skill_multi2 (8874). */
export function makeOneForCarrier(name: string | null | undefined): number {
    return (name ?? '').trim().toLowerCase() === 'logs' ? 8889 : 8874;
}

export function findCarrier(preferred?: string) {
    if (preferred) {
        const item = Inventory.first(preferred);
        if (item) {
            return item;
        }
    }
    return Inventory.first('Logs')
        ?? Inventory.items().find(item => isFletchableLogName(item.name))
        ?? null;
}

export function countLogs(): number {
    return Inventory.items()
        .filter(item => isFletchableLogName(item.name))
        .reduce((sum, item) => sum + Math.max(1, item.count), 0);
}

/** Drop up to `limit` extra logs, never the carrier. Returns how many were sent. */
export function dropExtraLogs(limit: number, preferred?: string): number {
    const carrier = findCarrier(preferred);
    if (!carrier) {
        return 0;
    }
    const extras = Inventory.items()
        .filter(item => isFletchableLogName(item.name) && item.slot !== carrier.slot)
        .slice(0, limit);
    for (const item of extras) {
        void item.interact('Drop');
    }
    return extras.length;
}
