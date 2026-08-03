/**
 * Map specialCrossings skill/item gates onto TransportRequires for plan-time filter.
 * Also door-only skill gates (not transport rows) e.g. Fishing Guild.
 */

import { SPECIAL_CROSSINGS } from '../data/specialCrossings.js';
import type { TransportRequires } from './types.js';

/**
 * Door tiles with skill gates that live in doors.json (not transports.json).
 * Levels from Server content scripts (skill_*_guild / magic_guild / fishing_guild).
 * Note: Cooking also needs a chef's hat worn at execute — plan-time is skill only.
 */
const DOOR_SKILL_GATES: readonly {
    x: number;
    z: number;
    level: number;
    skill: string;
    levelReq: number;
    note?: string;
}[] = [
    // fishing_guild.rs2 loc_2025 — fishing 68
    { x: 2611, z: 3394, level: 0, skill: 'fishing', levelReq: 68 },
    { x: 2611, z: 3398, level: 0, skill: 'fishing', levelReq: 68 },
    // magic_guild.rs2 — magic 66 (Yanille double doors, both sides)
    { x: 2584, z: 3087, level: 0, skill: 'magic', levelReq: 66 },
    { x: 2584, z: 3088, level: 0, skill: 'magic', levelReq: 66 },
    { x: 2597, z: 3087, level: 0, skill: 'magic', levelReq: 66 },
    { x: 2597, z: 3088, level: 0, skill: 'magic', levelReq: 66 },
    // crafting_guild.rs2 crafting_guild_door — crafting 40
    { x: 2933, z: 3289, level: 0, skill: 'crafting', levelReq: 40 },
    // cooking_guild.rs2 chefdoor — cooking 32 (+ chef's hat at execute)
    { x: 3143, z: 3444, level: 0, skill: 'cooking', levelReq: 32, note: "chef's hat worn at execute" }
];

/**
 * Transport from-tiles (transports.json) with skill gates — same attach path as
 * doors via specialRequiresAt(edge.from). Exit ladders (climb-up from cellar) stay open.
 */
const TRANSPORT_SKILL_GATES: readonly {
    x: number;
    z: number;
    level: number;
    skill: string;
    levelReq: number;
}[] = [
    // mining_guild.rs2 miningguildladder — mining 60 to descend into guild
    { x: 3019, z: 3339, level: 0, skill: 'mining', levelReq: 60 },
    { x: 3019, z: 3341, level: 0, skill: 'mining', levelReq: 60 },
    { x: 3020, z: 3340, level: 0, skill: 'mining', levelReq: 60 }
];

/**
 * Plan-time requires for an edge origin tile.
 * specialCrossings: prefer exact level, else same x/z (ships often key SC at
 * deck L1 while transports.json stand is pier L0).
 *
 * freeSlots on unlockQuest is **execute-only** (e.g. Drezel pies when starting
 * Nature Spirit) — never attach to plan requires or full packs fail the gate forever.
 */
export function specialRequiresAt(x: number, z: number, level: number): TransportRequires | undefined {
    const atXz = SPECIAL_CROSSINGS.filter(s => s.x === x && s.z === z);
    const sc = atXz.find(s => s.level === level) ?? atXz[0];
    if (sc) {
        const requires: TransportRequires = {};
        if (sc.requires) {
            requires.items = [{ name: sc.requires.item, count: sc.requires.count, consumed: true }];
            // also currency form for tolls / ship fares
            if (sc.requires.item === 'Coins') {
                requires.currency = { name: 'Coins', amount: sc.requires.count };
            }
        }
        if (sc.requiresSkill) {
            requires.skills = [{ name: sc.requiresSkill.name, level: sc.requiresSkill.level }];
        }
        if (!requires.items && !requires.skills && !requires.currency) {
            // unlockQuest-only rows (Mort Myre) → no plan-time freeSlots
            return undefined;
        }
        return requires;
    }

    const door = DOOR_SKILL_GATES.find(d => d.x === x && d.z === z && d.level === level);
    if (door) {
        return { skills: [{ name: door.skill, level: door.levelReq }] };
    }
    const tr = TRANSPORT_SKILL_GATES.find(d => d.x === x && d.z === z && d.level === level);
    if (tr) {
        return { skills: [{ name: tr.skill, level: tr.levelReq }] };
    }
    return undefined;
}
