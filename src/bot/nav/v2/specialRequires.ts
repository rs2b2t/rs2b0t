/**
 * Map specialCrossings skill/item gates onto TransportRequires for plan-time filter.
 */

import { SPECIAL_CROSSINGS } from '../data/specialCrossings.js';
import type { TransportRequires } from './types.js';

/** Key: `${x},${z},${level}` of the edge origin (specialCrossing from-tile). */
export function specialRequiresAt(x: number, z: number, level: number): TransportRequires | undefined {
    const sc = SPECIAL_CROSSINGS.find(s => s.x === x && s.z === z && s.level === level);
    if (!sc) {
        return undefined;
    }
    const requires: TransportRequires = {};
    if (sc.requires) {
        requires.items = [{ name: sc.requires.item, count: sc.requires.count, consumed: true }];
        // also currency form for tolls
        if (sc.requires.item === 'Coins') {
            requires.currency = { name: 'Coins', amount: sc.requires.count };
        }
    }
    if (sc.requiresSkill) {
        requires.skills = [{ name: sc.requiresSkill.name, level: sc.requiresSkill.level }];
    }
    if (sc.unlockQuest?.freeSlots) {
        requires.freeSlots = sc.unlockQuest.freeSlots;
    }
    if (!requires.items && !requires.skills && !requires.currency && requires.freeSlots === undefined) {
        return undefined;
    }
    return requires;
}
