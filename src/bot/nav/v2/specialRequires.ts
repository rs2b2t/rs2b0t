/**
 * Map specialCrossings skill/item gates onto TransportRequires for plan-time filter.
 * Also door-only skill gates (not transport rows) e.g. Fishing Guild.
 */

import { SPECIAL_CROSSINGS } from '../data/specialCrossings.js';
import type { TransportRequires } from './types.js';

/** Door tiles with skill gates that live in doors.json (not transports.json). */
const DOOR_SKILL_GATES: readonly { x: number; z: number; level: number; skill: string; levelReq: number }[] = [
    // fishing_guild.rs2 loc_2025 — fishing 68 to enter from outside
    { x: 2611, z: 3394, level: 0, skill: 'fishing', levelReq: 68 },
    { x: 2611, z: 3398, level: 0, skill: 'fishing', levelReq: 68 }
];

/** Key: `${x},${z},${level}` of the edge origin (specialCrossing from-tile). */
export function specialRequiresAt(x: number, z: number, level: number): TransportRequires | undefined {
    const sc = SPECIAL_CROSSINGS.find(s => s.x === x && s.z === z && s.level === level);
    if (sc) {
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

    const door = DOOR_SKILL_GATES.find(d => d.x === x && d.z === z && d.level === level);
    if (door) {
        return { skills: [{ name: door.skill, level: door.levelReq }] };
    }
    return undefined;
}
