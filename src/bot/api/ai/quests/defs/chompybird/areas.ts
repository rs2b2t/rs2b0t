import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const CB_QUEST = 'Big Chompy Bird Hunting';

/** `%chompybird`, from quest_chompybird.constant. */
export const CB_STAGE = {
    NOT_STARTED: 0,
    STARTED: 5,
    GIVEN_ARROWS: 10,
    KIDS_PLAY_WITH_TOAD: 15,
    REMOVED_ROCK: 20,
    SHOWN_TOAD: 25,
    DROPPED_TOAD: 30,
    CHOMPY_SPAWNED: 35,
    RANTZ_MISSED: 40,
    GOT_BOW: 45,
    KILLED_CHOMPY: 50,
    TOLD_TO_COOK: 55,
    CHOMPY_COOKED: 60,
    COMPLETE: 65
} as const;

export const CB_ID = {
    ACHEY_LOGS: 2862,
    SHAFT: 2864,
    FLIGHTED: 2865,
    WOLF_BONES: 2859,
    ARROWTIPS: 2861,
    ARROW: 2866,
    BOW: 2883,
    BELLOWS_EMPTY: 2871,
    BELLOWS3: 2872,
    BELLOWS2: 2873,
    BELLOWS1: 2874,
    TOAD: 2875,
    RAW_CHOMPY: 2876,
    SEASONED_CHOMPY: 2882,
    RUINED_CHOMPY: 2880,
    FEATHER: 314,
    KNIFE: 946,
    CHISEL: 1755,
    POTATO: 1942,
    ONION: 1957,
    CABBAGE: 1965,
    TOMATO: 1982,
    DOOGLE: 1573,
    EQUA: 2128,
    COINS: 995,
    BONES: 526
} as const;

export const CB_NAME = {
    ACHEY_LOGS: 'Achey tree logs',
    SHAFT: 'Ogre arrow shaft',
    FLIGHTED: 'Flighted ogre arrow',
    WOLF_BONES: 'Wolf bones',
    ARROWTIPS: 'Wolfbone arrowtips',
    ARROW: 'Ogre arrow',
    BOW: 'Ogre bow',
    TOAD: 'Bloated toad',
    RAW_CHOMPY: 'Raw chompy',
    SEASONED_CHOMPY: 'Seasoned chompy',
    RUINED_CHOMPY: 'Ruined chompy',
    FEATHER: 'Feather',
    KNIFE: 'Knife',
    CHISEL: 'Chisel',
    POTATO: 'Potato',
    ONION: 'Onion',
    CABBAGE: 'Cabbage',
    TOMATO: 'Tomato',
    DOOGLE: 'Doogle leaves',
    EQUA: 'Equa leaves',
    COINS: 'Coins'
} as const;

/** The bellows carry three charges and every charge is a different obj. */
export const BELLOWS_IDS: readonly number[] = [CB_ID.BELLOWS3, CB_ID.BELLOWS2, CB_ID.BELLOWS1];
export const ANY_BELLOWS: readonly number[] = [CB_ID.BELLOWS_EMPTY, ...BELLOWS_IDS];

export const CB_LOC = {
    ACHEY: 'Achey Tree',
    BUBBLES: 'Swamp bubbles',
    CHEST_LOCKED: 'Locked Ogre chest',
    CHEST_OPEN: 'Unlocked Ogre chest',
    SPIT: 'Ogre spit-roast',
    POTATO: 'Potato',
    ONION: 'Onion',
    CABBAGE: 'Cabbage'
} as const;

export const CB_LOC_ID = {
    /** `chompybird_chest`, before the rock comes off. */
    CHEST: 3377,
    /** `chompybird_chest_open`, the searchable half. */
    CHEST_OPEN: 3378,
    // Why: six locs share the name "Ogre spit-roast" and only the empty one carries the `oplocu` a raw chompy needs.
    /** `chompybird_spitroast_empty`. */
    SPIT_EMPTY: 3375
} as const;

export const CB_NPC = {
    RANTZ: 'Rantz',
    FYCIE: 'Fycie',
    BUGS: 'Bugs',
    TOAD: 'Swamp toad',
    CHOMPY: 'Chompy bird',
    WOLF: 'Wolf'
} as const;

export const CB_TILE = {
    RANTZ: new Tile(2630, 2981, 0),
    SPIT: new Tile(2630, 2990, 0),
    CAVE_MOUTH: new Tile(2630, 2997, 0),
    CAVE_ARRIVAL: new Tile(2647, 9379, 0),
    BUGS: new Tile(2640, 9391, 0),
    FYCIE: new Tile(2650, 9393, 0),
    CHEST: new Tile(2638, 9397, 0),
    ACHEY: new Tile(2626, 2974, 0),
    WOLVES: new Tile(2607, 2962, 0),
    // Why: the pool is a block of unwalkable floor and five of its six bubble locs have no standable cardinal neighbour at all, so this is the one that can ever be used.
    /** The only swamp bubbles the bellows can reach. */
    BUBBLE: new Tile(2598, 2963, 0),
    /** Standing south of that bubble, at the pool's south lip. */
    SWAMP: new Tile(2598, 2962, 0),
    /** The clearing Rantz points at, dead centre of the bait zone. */
    BAIT: new Tile(2636, 2966, 0),
    POTATO: new Tile(2641, 2958, 0),
    CABBAGE: new Tile(2645, 2958, 0),
    ONION: new Tile(2583, 2966, 0),
    // Why: the tomato spawn's own tile is blocked floor, so this is the standable neighbour a Take can be sent from.
    TOMATO: new Tile(2584, 2965, 0),
    EQUA: new Tile(2639, 2952, 0),
    DOOGLE: new Tile(2562, 2972, 0),
    YANILLE_BANK: new Tile(2612, 3092, 0)
} as const;

export const BOB_AXES = { npc: 'Bob', anchor: new Tile(3232, 3203, 0) };
export const GERRANT = { npc: 'Gerrant', anchor: new Tile(3013, 3225, 0) };

export const RANTZ: NpcStop = {
    npc: CB_NPC.RANTZ,
    anchor: CB_TILE.RANTZ,
    leash: 6,
    prefer: [
        "Ok, I'll make you some 'stabbers'.",
        "Ok, I'll make the 'stabbers' for you.",
        'Ok, thanks.'
    ]
};

export const BUGS: NpcStop = {
    npc: CB_NPC.BUGS,
    anchor: CB_TILE.BUGS,
    leash: 6,
    prefer: ["Ok, I'll give you 10 bright pretties.", 'Ok, thanks.']
};

export const FYCIE: NpcStop = {
    npc: CB_NPC.FYCIE,
    anchor: CB_TILE.FYCIE,
    leash: 6,
    prefer: ["Ok, I'll give you 50 bright pretties.", 'Ok, thanks.']
};

interface Pos {
    x: number;
    z: number;
    level: number;
}

// Why: `opheld1,bloated_toad` refuses outside this box with "This is too far away for Rantz to shoot the chompy bird."

/** The clearing the quest will accept bait in — `inzone(0_41_46_7_18, 0_41_46_15_27)`. */
export function inBaitZone(t: Pos | null | undefined): boolean {
    return !!t && t.level === 0 && t.x >= 2631 && t.x <= 2639 && t.z >= 2962 && t.z <= 2971;
}

/** Rantz's cave, reached and left by scripted teleports alone. */
export function inCave(t: Pos | null | undefined): boolean {
    return !!t && t.z >= 9340 && t.z <= 9410 && t.x >= 2620 && t.x <= 2690;
}
