/**
 * Map specialCrossings skill/item gates onto TransportRequires for plan-time filter.
 * Also door-only skill gates (not transport rows) e.g. Fishing Guild.
 */

import { SPECIAL_CROSSINGS } from './data/specialCrossings.js';
import type { TransportRequires } from './types.js';

/**
 * Door tiles with skill / worn gates that live in doors.json (not transports.json).
 * Levels from Server content scripts (skill_*_guild / magic_guild / fishing_guild / ranging).
 */
const DOOR_SKILL_GATES: readonly {
    x: number;
    z: number;
    level: number;
    skill: string;
    levelReq: number;
    /** Worn equipment required (plan-time). */
    worn?: { name: string; count: number }[];
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
    // cooking_guild.rs2 chefdoor — cooking 32 + Chef's hat worn
    {
        x: 3143,
        z: 3444,
        level: 0,
        skill: 'cooking',
        levelReq: 32,
        worn: [{ name: "Chef's hat", count: 1 }],
        note: "chef's hat worn"
    },
    // ranging_guild_door.rs2 — ranged 40 (map loc 2658,3438). doors.json uses loc tile;
    // transports.json uses diagonal stands — gate both so PathFinder from-tile attach works.
    { x: 2658, z: 3438, level: 0, skill: 'ranged', levelReq: 40 }
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
    // All four surface from-tiles in transports.json (locId 2113)
    { x: 3018, z: 3340, level: 0, skill: 'mining', levelReq: 60 },
    { x: 3019, z: 3339, level: 0, skill: 'mining', levelReq: 60 },
    { x: 3019, z: 3341, level: 0, skill: 'mining', levelReq: 60 },
    { x: 3020, z: 3340, level: 0, skill: 'mining', levelReq: 60 },
    // skill_agility/shortcuts.rs2 _island_rope_swing — agility 10 on outer swings.
    // tree_ropeswing2 (brim south, from 2705,3205) intentionally has NO level check
    // so players cannot softlock on the island (content: loc_type ! tree_ropeswing2).
    { x: 2709, z: 3209, level: 0, skill: 'agility', levelReq: 10 }, // tree_ropeswing1 north
    { x: 2511, z: 3091, level: 0, skill: 'agility', levelReq: 10 }, // tree_ropeswing3 ogre
    // ranging_guild_door diagonal stands (transports.json from-tiles; loc at 2658,3438)
    { x: 2657, z: 3439, level: 0, skill: 'ranged', levelReq: 40 },
    { x: 2659, z: 3437, level: 0, skill: 'ranged', levelReq: 40 }
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
        const requires: TransportRequires = {
            skills: [{ name: door.skill, level: door.levelReq }]
        };
        if (door.worn && door.worn.length > 0) {
            requires.worn = door.worn.map(w => ({ name: w.name, count: w.count }));
        }
        return requires;
    }
    const tr = TRANSPORT_SKILL_GATES.find(d => d.x === x && d.z === z && d.level === level);
    if (tr) {
        return { skills: [{ name: tr.skill, level: tr.levelReq }] };
    }
    return undefined;
}
