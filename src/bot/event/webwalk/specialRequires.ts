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
    // Why: skill_agility/shortcuts.rs2 _island_rope_swing needs agility 10 on the outer swings.
    // Why: tree_ropeswing2 (brim south, from 2705,3205) carries no level check on purpose so players cannot softlock on the island — content reads `loc_type ! tree_ropeswing2`.
    { x: 2709, z: 3209, level: 0, skill: 'agility', levelReq: 10 }, // tree_ropeswing1 north
    { x: 2511, z: 3091, level: 0, skill: 'agility', levelReq: 10 }, // tree_ropeswing3 ogre
    // ranging_guild_door diagonal stands (transports.json from-tiles; loc at 2658,3438)
    { x: 2657, z: 3439, level: 0, skill: 'ranged', levelReq: 40 },
    { x: 2659, z: 3437, level: 0, skill: 'ranged', levelReq: 40 }
];

// Why: these are crossings whose content handler checks a quest varp, keyed by the edge origin — doors by loc tile, transports by `from`, the two ways `specialRequiresAt` is called.
// Why: without them A* plans a route the player can never walk and the walker only finds out standing at the barrier; seven Morytania clue destinations spent their eight-minute budget at the Paterdomus gate before this existed.
// Why: the journal is the only quest state on the wire, so a stage check maps to `started` or `complete` and never finer.
// Why: a crossing needing a post-quest step — the Salve barrier wants stage 61, one Drezel conversation past complete — is gated on complete here and unlocked at execute time.
// Why: offline probes carry no WorldState, so these fail open and pack-tool parity is unchanged.
const CROSSING_GATES: readonly {
    x: number;
    z: number;
    level: number;
    quest?: string;
    minStatus?: 'started' | 'complete';
    /** Worn item the same handler demands (gas mask, …). */
    worn?: { name: string; count: number }[];
    /** Inventory item the handler checks without consuming. */
    items?: { name: string; count: number }[];
    /** Content script and the stage it tests. */
    note: string;
}[] = [
    // area_mausoleum/gates.rs2 — check_priest_peril_gate(^priestperil_find_drezel_key = 5)
    { x: 3405, z: 9895, level: 0, quest: 'Priest in Peril', minStatus: 'started', note: 'pip_underground_door1 needs %priestperil >= 5' },
    // check_priest_peril_gate(^priestperil_meet_in_mausoleum = 8)
    { x: 3431, z: 9897, level: 0, quest: 'Priest in Peril', minStatus: 'started', note: 'pip_underground_door2 needs %priestperil >= 8' },
    // area_mausoleum/holy_barrier.rs2 — %priestperil = ^priestperil_access_holy_barrier (61),
    // which is one Drezel conversation past ^priestperil_complete (60).
    { x: 3440, z: 9887, level: 0, quest: 'Priest in Peril', minStatus: 'complete', note: 'pip_underground_wall_side_withportal needs %priestperil = 61' },
    // quest_elena/sewerpipe.rs2 — %elenaquest >= ^quest_elena_opened_pipe AND the
    // gas mask *worn* (the pack only asked for one in the pack).
    {
        x: 2530, z: 9703, level: 0, quest: 'Plague City', minStatus: 'started',
        worn: [{ name: 'Gas mask', count: 1 }],
        note: 'plaguesewerpipe needs the mask worn, not carried'
    },
    // quest_desertrescue.rs2 open_desertcamp_gate — both directions retain the key.
    // The gate itself has no quest-stage check; this remains usable while the quest runs.
    {
        x: 3273,
        z: 3028,
        level: 0,
        items: [{ name: 'Metal key', count: 1 }],
        note: 'miningcampgateclosedl needs the Metal key in inventory'
    },
    {
        x: 3274,
        z: 3028,
        level: 0,
        items: [{ name: 'Metal key', count: 1 }],
        note: 'miningcampgateclosedl needs the Metal key in inventory'
    },
    {
        x: 3273,
        z: 3029,
        level: 0,
        items: [{ name: 'Metal key', count: 1 }],
        note: 'miningcampgateclosedr needs the Metal key in inventory'
    },
    {
        x: 3274,
        z: 3029,
        level: 0,
        items: [{ name: 'Metal key', count: 1 }],
        note: 'miningcampgateclosedr needs the Metal key in inventory'
    }
];

// Why: specialCrossings match on the same level first, then on x/z alone, because ships often key the crossing at deck L1 while the transports.json stand is the pier at L0.
// Why: `freeSlots` on unlockQuest is execute-only (Drezel's pies when starting Nature Spirit) and must never reach plan requires, or a full pack fails the gate forever.

/** Plan-time requires for an edge origin tile. */
export function specialRequiresAt(x: number, z: number, level: number): TransportRequires | undefined {
    // A tile can carry more than one gate — the sewer pipe wants Plague City
    // *and* the gas mask worn — so collect rather than return on the first hit.
    const requires: TransportRequires = {};
    let gated = false;

    const atXz = SPECIAL_CROSSINGS.filter(s => s.x === x && s.z === z);
    const sc = atXz.find(s => s.level === level) ?? atXz[0];
    if (sc) {
        if (sc.requires) {
            requires.items = [{ name: sc.requires.item, count: sc.requires.count, consumed: true }];
            gated = true;
            // also currency form for tolls / ship fares
            if (sc.requires.item === 'Coins') {
                requires.currency = { name: 'Coins', amount: sc.requires.count };
            }
        }
        if (sc.requiresSkill) {
            requires.skills = [{ name: sc.requiresSkill.name, level: sc.requiresSkill.level }];
            gated = true;
        }
        // unlockQuest-only rows (Mort Myre) contribute nothing at plan time — never
        // attach their freeSlots, or a full pack fails the gate forever.
    }

    const door = DOOR_SKILL_GATES.find(d => d.x === x && d.z === z && d.level === level);
    if (door) {
        requires.skills = [{ name: door.skill, level: door.levelReq }];
        gated = true;
        if (door.worn && door.worn.length > 0) {
            requires.worn = door.worn.map(w => ({ name: w.name, count: w.count }));
        }
    }

    const tr = TRANSPORT_SKILL_GATES.find(d => d.x === x && d.z === z && d.level === level);
    if (tr) {
        requires.skills = [{ name: tr.skill, level: tr.levelReq }];
        gated = true;
    }

    const gate = CROSSING_GATES.find(q => q.x === x && q.z === z && q.level === level);
    if (gate) {
        gated = true;
        if (gate.quest && gate.minStatus) {
            requires.quests = [{ quest: gate.quest, minStatus: gate.minStatus }];
        }
        if (gate.items && gate.items.length > 0) {
            requires.items = [...(requires.items ?? []), ...gate.items.map(i => ({ ...i, consumed: false }))];
        }
        if (gate.worn && gate.worn.length > 0) {
            requires.worn = [...(requires.worn ?? []), ...gate.worn.map(w => ({ name: w.name, count: w.count }))];
        }
    }

    return gated ? requires : undefined;
}
