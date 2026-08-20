import Tile from '../../../../../geometry/Tile.js';
import type { LadderHop, NpcStop } from '../../exec/primitives.js';

export const NS_QUEST = 'Nature Spirit';

/** `%druidspirit`, from quest_druidspirit.constant. */
export const NS_STAGE = {
    NOT_STARTED: 0,
    STARTED: 5,
    ENTERED_SWAMP: 10,
    FAILED_TALK: 15,
    SPOKEN_FILLIMAN: 20,
    SHOWN_MIRROR: 25,
    GIVEN_JOURNAL: 30,
    RECEIVED_SPELL: 35,
    BLESSED: 40,
    CASTED_SPELL: 45,
    PICKED_FUNGI: 50,
    SPOKEN_FILLIMAN2: 55,
    PERFORMED_RITUAL: 60,
    ENTERED_GROTTO: 65,
    FULL_TRANSFORM: 70,
    BLESSED_SICKLE: 75,
    CASTED_SICKLE_BLOOM: 80,
    PICKED_SICKLE: 85,
    ADDED_POUCH: 90,
    KILLED_GHAST1: 95,
    KILLED_GHAST2: 100,
    KILLED_GHAST3: 105,
    COMPLETE: 110
} as const;

// Why: `opheld3,silver_sickle_blessed` charges `random_range(1, 7)` and refuses outright at zero, so a bar under seven can still lose the cast it is about to pay for.
/** The dearest a single Cast Bloom can cost. */
export const BLOOM_MAX_COST = 7;

export const NS_ID = {
    GHOSTSPEAK: 552,
    POUCH_EMPTY: 2957,
    POUCH: 2958,
    SICKLE: 2961,
    SICKLE_BLESSED: 2963,
    BOWL: 2964,
    MIRROR: 2966,
    JOURNAL: 2967,
    SPELL: 2968,
    SPELL_USED: 2969,
    FUNGI: 2970,
    STEM: 2972,
    PEAR: 2974,
    MOULD: 2976,
    SILVER_ORE: 442,
    SILVER_BAR: 2355,
    COINS: 995
} as const;

export const NS_NAME = {
    GHOSTSPEAK: 'Ghostspeak amulet',
    POUCH: 'Druid pouch',
    SICKLE: 'Silver sickle',
    SICKLE_BLESSED: 'Silver sickle(b)',
    BOWL: 'Washing bowl',
    MIRROR: 'Mirror',
    JOURNAL: 'Journal',
    SPELL: 'Druidic spell',
    SPELL_USED: 'A used spell',
    FUNGI: 'Mort myre fungi',
    STEM: 'Mort myre stem',
    PEAR: 'Mort myre pear',
    MOULD: 'Sickle mould',
    SILVER_ORE: 'Silver ore',
    SILVER_BAR: 'Silver bar',
    COINS: 'Coins'
} as const;

export const NS_LOC = {
    LOG: 'Rotting log',
    FUNGI_LOG: 'Fungi on log',
    BRANCH: 'Rotting branch',
    BUDDING_BRANCH: 'Budding branch',
    BUSH: 'A small bush',
    PEAR_BUSH: 'A golden pear bush',
    GROTTO_DOOR: 'Grotto',
    GROTTO_TREE: 'Grotto tree',
    GROTTO_POOL: 'Grotto',
    ALTAR: 'Altar of nature',
    TEMPLE_ALTAR: 'Altar',
    STONE: 'Stone',
    FURNACE: 'Furnace'
} as const;

export const NS_TILE = {
    DREZEL: new Tile(3439, 9895, 0),
    GATE: new Tile(3443, 3461, 0),
    CAMP: new Tile(3440, 3337, 0),
    SPIRIT: new Tile(3440, 3336, 0),
    NATURE_STONE: new Tile(3439, 3336, 0),
    FAITH_STONE: new Tile(3440, 3335, 0),
    SPIRIT_STONE: new Tile(3441, 3336, 0),
    BOWL: new Tile(3437, 3337, 0),
    GROTTO_TREE: new Tile(3439, 3338, 0),
    GROTTO_DOOR: new Tile(3440, 3337, 0),
    GROTTO_INSIDE: new Tile(3442, 9734, 0),
    /** The Saradomin altar on Paterdomus's ground floor, the temple this quest already walks through. */
    TEMPLE_ALTAR: new Tile(3416, 3488, 0),
    GHAST_HUNT: new Tile(3424, 3337, 0),
    URHNEY: new Tile(3235, 3154, 0),
    DOMMIK: new Tile(3322, 3194, 0),
    BOB: new Tile(3232, 3203, 0),
    // Why: the Al Kharid furnace is `forceapproach=east`, which its rotation puts to the south, so this is the stand rather than the loc tile.
    FURNACE: new Tile(3272, 3183, 0),
    SILVER_ROCKS: new Tile(3294, 3301, 0),
    VARROCK_EAST_BANK: new Tile(3253, 3420, 0),
    ALKHARID_BANK: new Tile(3269, 3167, 0)
} as const;

export const NS_HOPS: LadderHop[] = [
    { stand: new Tile(3405, 3506, 0), locName: 'Trapdoor', op: 'Climb-down', open: 'Open', arrive: new Tile(3405, 9907, 0) },
    { stand: new Tile(3405, 9907, 0), locName: 'Ladder', op: 'Climb-up', arrive: new Tile(3405, 3507, 0) }
];

export const DREZEL: NpcStop = {
    npc: 'Drezel',
    anchor: NS_TILE.DREZEL,
    leash: 4,
    prefer: [
        'Is there anything else interesting to do around here?',
        'Well, what is it, I may be able to help?',
        "Yes, I'll go and look for him.",
        "Yes, I'm sure."
    ]
};

export const URHNEY: NpcStop = {
    npc: 'Father Urhney',
    anchor: NS_TILE.URHNEY,
    leash: 6,
    prefer: ['Father Aereck sent me to talk to you.', "He's got a ghost haunting his graveyard.", "I've lost the amulet."]
};

export const FILLIMAN: NpcStop = {
    npc: 'Filliman Tarlock',
    anchor: NS_TILE.SPIRIT,
    leash: 4,
    prefer: ["I'm wearing an amulet of ghost speak!", 'Ok, thanks.']
};

export const NATURE_SPIRIT: NpcStop = {
    npc: 'Nature Spirit',
    anchor: NS_TILE.GROTTO_INSIDE,
    leash: 8,
    prefer: ['Ok thanks.']
};

export const DOMMIK = { npc: 'Dommik', anchor: NS_TILE.DOMMIK };
export const BOB = { npc: 'Bob', anchor: NS_TILE.BOB };

interface Pos {
    x: number;
    z: number;
    level: number;
}

/** The `inzone` the bloom spell and the decay timer both test. */
export function inSwamp(t: Pos | null | undefined): boolean {
    return !!t && t.level === 0 && t.x >= 3392 && t.x <= 3519 && t.z >= 3328 && t.z <= 3455;
}

/** The pocket the swamp cannot decay you in. */
export function inCamp(t: Pos | null | undefined): boolean {
    return !!t && t.level === 0 && t.x >= 3434 && t.x <= 3448 && t.z >= 3330 && t.z <= 3344;
}

// Why: the grotto is entered and left by scripted teleports alone, and it moves up a level once the quest completes.

/** The sealed pocket under the camp. */
export function inGrotto(t: Pos | null | undefined): boolean {
    return !!t && t.x >= 3430 && t.x <= 3455 && t.z >= 9720 && t.z <= 9750;
}
