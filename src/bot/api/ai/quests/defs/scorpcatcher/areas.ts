// docs/QUESTS.md
import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

/** Which of Thormac's 3 scorpions a cage is holding. */
export type ScorpionKey = 'a' | 'b' | 'c';

/** `%scorpcatcher`, from `quest_scorpcatcher.constant`. */
export const SC_STAGE = { NOT_STARTED: 0, STARTED: 1, FIRST_HINT: 2, SECOND_HINT: 3, COMPLETE: 6 } as const;

// Why: all 8 cages render "Scorpion cage", so only the obj id says what's inside.

/** The 8 `scorpcage` objs, keyed by what each one holds. */
export const CAGE_ID = {
    EMPTY: 456,
    A: 457,
    AB: 458,
    AC: 459,
    B: 460,
    BC: 461,
    C: 462,
    FULL: 463
} as const;

export const CAGE_NAME = 'Scorpion cage';

/** All 3 Kharid scorpion NPCs render the same name, so they are found by id. */
export const SCORPION_NPC: Record<ScorpionKey, number> = { a: 385, b: 386, c: 387 };

export const SC_ID = {
    DUSTY_KEY: 1590,
    JAIL_KEY: 1591,
    /** `scorpionwall`, the Taverley secret door, "Old wall" / Search. */
    SECRET_WALL: 2117,
    /** `deepdungeondoor`, "Gate" / Open, dusty key only. */
    DEEP_GATE: 2623,
    /** `dungeonjail`, "Door" / Open, jail key only. */
    JAIL_DOOR: 2631,
    /** `monasteryladder`, "Ladder" / Climb-up, order members only. */
    MONASTERY_LADDER: 2641
} as const;

export const SC_ITEM = { DUSTY_KEY: 'Dusty key', JAIL_KEY: 'Jail key', ANTIPOISON: 'Antipoison(3)' } as const;

// Why: 8 `poisonspider` spawns between (2850,9799) and (2876,9806) with `wanderrange=10` cover the coffin corridor and the secret-room wall.
// Why: `poison_severity=27` is 6 damage every 18s for 8 minutes, and `%poison` is `scope=perm` with no transmit, so its opening chat line is the only reading.
// Why: the Karamja general store is the one shop in the content that stocks the cure, so the leg pays a 30gp ferry each way for it.

/** Every dose, newest first, a drink turns (3) into (2) and leaves the rest in the pack. */
export const ANTIPOISON_DOSES: readonly string[] = ['Antipoison(3)', 'Antipoison(2)', 'Antipoison(1)'];

/** `generalshop7` in Musa Point, the only `3doseantipoison` stock on the map. */
export const ANTIPOISON_SHOP = { npc: 'Shop keeper', anchor: new Tile(2902, 3146, 0) } as const;

/** The potion at 1.3x its 288 base, plus both ferry fares. */
export const ANTIPOISON_GP = 600;

const CAGE_CONTENTS: ReadonlyMap<number, readonly ScorpionKey[]> = new Map([
    [CAGE_ID.EMPTY, []],
    [CAGE_ID.A, ['a']],
    [CAGE_ID.B, ['b']],
    [CAGE_ID.C, ['c']],
    [CAGE_ID.AB, ['a', 'b']],
    [CAGE_ID.AC, ['a', 'c']],
    [CAGE_ID.BC, ['b', 'c']],
    [CAGE_ID.FULL, ['a', 'b', 'c']]
]);

/** Every cage obj id, so a pack or bank scan can find whichever one the run is carrying. */
export const EVERY_CAGE: readonly number[] = [...CAGE_CONTENTS.keys()];

// Why: the catch order is the walk: the outpost is next to the Seers, Taverley is on the way back east, and the monastery is the last stop before the tower.

/** The order the module catches them in. */
export const EVERY_SCORPION: readonly ScorpionKey[] = ['b', 'a', 'c'];

export const SCORPION_LABEL: Record<ScorpionKey, string> = {
    a: 'Taverley',
    b: 'Barbarian Outpost',
    c: 'monastery'
};

/** What a cage of this id is holding. */
export function caughtIn(cageId: number): Set<ScorpionKey> {
    return new Set(CAGE_CONTENTS.get(cageId) ?? []);
}

/** The cage obj holding this set of scorpions and no others. */
export function cageWith(caught: ReadonlySet<ScorpionKey>): number | undefined {
    for (const [id, keys] of CAGE_CONTENTS) {
        if (keys.length === caught.size && keys.every(key => caught.has(key))) {
            return id;
        }
    }
    return undefined;
}

export const SC_TILE = {
    /** Thormac, 3 ladders up the Sorcerer's Tower. */
    THORMAC: new Tile(2702, 3405, 3),
    /** The ground-floor Seer in Seers' Village. */
    SEER: new Tile(2702, 3475, 0),

    /** Inside Ivor's hut, 1 tile north of scorpion B. */
    OUTPOST_HUT: new Tile(2552, 3571, 0),

    /** The Black Knights' prison corridor, on the locked side of Velrak's cell. */
    JAIL_DOOR: new Tile(2931, 9690, 0),
    /** Inside the cell, where the jail door lands. */
    JAIL_CELL: new Tile(2931, 9689, 0),
    VELRAK: new Tile(2931, 9685, 0),

    /** The east side of the dusty-key gate. */
    DEEP_GATE: new Tile(2924, 9803, 0),
    /** The deep dungeon, 1 tile west of that gate. */
    DEEP_DUNGEON: new Tile(2923, 9803, 0),

    /** The coffin corridor by the poison spiders, on the outside of the secret wall. */
    SECRET_WALL: new Tile(2875, 9799, 0),
    /** Inside the secret room, where the wall lands. */
    SECRET_ROOM: new Tile(2875, 9798, 0),
    SCORPION_A: new Tile(2877, 9796, 0),

    ABBOT: new Tile(3058, 3482, 0),
    MONASTERY_LADDER: new Tile(3057, 3484, 0),
    /** The upstairs room with the monk's robes on the table. */
    MONASTERY_ROOM: new Tile(3058, 3487, 1),

    /** Falador West, the closest bank to Taverley Dungeon and the monastery both. */
    BANK: new Tile(2946, 3369, 0)
} as const;

// Why: Thormac's first line is the quest offer, his second is the cage, and only the third starts it, so every rung of that chain is in the list.
// Why: "I've lost my cage." comes before the other `thormac_how_goes` option, as that branch is the only way back to a cage the run has dropped.

export const THORMAC: NpcStop = {
    npc: 'Thormac',
    anchor: SC_TILE.THORMAC,
    leash: 6,
    prefer: [
        'What do you need assistance with?',
        'So how would I go about catching them then?',
        'Ok, I will do it then',
        "I've lost my cage.",
        "I've not caught all the scorpions yet."
    ]
};

// Why: The seer has three stage-specific openers; retrying the wrong one only adds another walk to Seers' Village.

export const SEER: NpcStop = {
    npc: 'Seer',
    anchor: SC_TILE.SEER,
    leash: 8,
    prefer: [
        'I need to locate some scorpions.',
        'Where did you say that scorpion was again?',
        'Your friend Thormac sent me to speak to you.',
        'Many greetings.'
    ]
};

/** Joining the order is what unlocks the monastery ladder. */
export const ABBOT: NpcStop = {
    npc: 'Abbot Langley',
    anchor: SC_TILE.ABBOT,
    leash: 8,
    prefer: ['How do I get further into the monastery?', 'Well can I join your order?']
};

export const VELRAK: NpcStop = {
    npc: 'Velrak the explorer',
    anchor: SC_TILE.VELRAK,
    leash: 6,
    prefer: ['So... do you know anywhere good to explore?', 'Yes please!']
};

export const JAILER_NPC = 'Jailer';
