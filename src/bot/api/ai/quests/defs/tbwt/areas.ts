import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const TBWT_QUEST = 'Tai Bwo Wannai Trio';

// Why: `tbwt_main` and `tbwt_tiadeche` are the two `transmit=yes` varps this quest owns, so they are on the wire and exact — see docs/decisions/quest-state-not-varps.md, which names TBWT as the exception.
// Why: the other four (`tbwt_tinsay`, `tbwt_tamayu`, `tbwt_lubufu`, `tbwt_flags`) are `scope=perm` only and read back 0, so they come off the journal page instead.

/** Transmitted varp indices, from content/pack/varp.pack. */
export const TB_VARP = { MAIN: 320, TIADECHE: 321 } as const;

/** `%tbwt_main`, from quest_tbwt.constant plus `^tbwt_complete` in quest.constant. */
export const TB_MAIN = {
    NOT_STARTED: 0,
    SPOKE: 1,
    ASKED_FOR_HELP: 2,
    STARTED: 3,
    ALL_BROTHERS: 4,
    GOLD: 5,
    COMPLETE: 6
} as const;

/** `%tbwt_tiadeche`. */
export const TB_TIADECHE = {
    UNKNOWN: 0,
    INTRO: 1,
    RETURN_WHEN_CAUGHT: 2,
    CAUGHT: 3,
    REQUEST_MANUAL: 4,
    RECEIVED_MANUAL: 5,
    COMPLETE: 6,
    CLAIMED: 7
} as const;

/** `%tbwt_tinsay`. */
export const TB_TINSAY = {
    UNKNOWN: 0,
    INTRO: 1,
    FETCH_RUM: 2,
    GIVEN_RUM: 3,
    FETCH_SANDWICH: 4,
    GIVEN_SANDWICH: 5,
    FETCH_BONES: 6,
    COMPLETE: 7,
    CLAIMED: 8
} as const;

/** `%tbwt_tamayu`. */
export const TB_TAMAYU = {
    UNKNOWN: 0,
    INTRO: 1,
    SLAY_SHAIKAHAN: 2,
    WATCHED_CUTSCENE: 3,
    COMPLETE: 4,
    CLAIMED: 5
} as const;

/** `%tbwt_lubufu` — the counted stretch 5..24 is "karambwanji handed in so far". */
export const TB_LUBUFU = {
    UNKNOWN: 0,
    INTRO: 1,
    INITIAL_OPS: 2,
    ASKED_WHAT_DO: 3,
    OFFERED_TO_HELP: 4,
    FETCH_KARAMBWANJI: 5,
    GIVEN_KARAMBWANJI: 25,
    ASKED_QUESTIONS: 28,
    OFFERED_APPRENTICE: 29,
    BECAME_APPRENTICE: 30,
    COMPLETE: 31
} as const;

/** Karambwanji Lubufu wants before he will teach. */
export const KARAMBWANJI_WANTED = 20;

/** Bait carried to the Karambwan shoal: each lower spends one, and a burnt Karambwan costs another round trip. */
export const KARAMBWAN_BAIT = 4;

// Why: "Karambwan vessel", "Karamjan rum" and "Karambwan paste" each name three different objects, so every one of them is matched by id.
export const TB_ID = {
    COINS: 995,
    NET: 303,
    KNIFE: 946,
    PESTLE: 233,
    TINDERBOX: 590,
    SEAWEED: 401,
    BANANA: 1963,
    SLICED_BANANA: 3162,
    RUM: 431,
    RUM_SLICED: 3164,
    RUM_WHOLE: 3165,
    IRON_SPEAR: 1239,
    SPEAR_KP: 3171,
    AGILITY_POTION_4: 3032,
    VESSEL: 3157,
    VESSEL_LOADED: 3159,
    RAW_KARAMBWANJI: 3150,
    KARAMBWANJI_PASTE: 3155,
    RAW_KARAMBWAN: 3142,
    POORLY_COOKED_KARAMBWAN: 3146,
    BURNT_KARAMBWAN: 3148,
    KARAMBWAN_POISON_PASTE: 3153,
    MONKEY_CORPSE: 3166,
    MONKEY_SKIN: 3167,
    SANDWICH: 3168,
    JOGRE_BONES: 3125,
    BURNT_JOGRE_BONES: 3127,
    PASTY_JOGRE_BONES: 3128,
    MARINATED_JOGRE_BONES: 3130,
    CRAFTING_MANUAL: 3161
} as const;

export const TB_NAME = {
    COINS: 'Coins',
    NET: 'Small fishing net',
    KNIFE: 'Knife',
    PESTLE: 'Pestle and mortar',
    TINDERBOX: 'Tinderbox',
    SEAWEED: 'Seaweed',
    BANANA: 'Banana',
    IRON_SPEAR: 'Iron spear',
    AGILITY_POTION_4: 'Agility potion(4)',
    RAW_KARAMBWANJI: 'Raw karambwanji',
    RAW_SHRIMP: 'Raw shrimps',
    BURNT_JOGRE_BONES: 'Burnt jogre bones',
    JOGRE_BONES: 'Jogre bones',
    MONKEY_CORPSE: 'Monkey corpse',
    RUM: 'Karamjan rum',
    BOW: 'Maple shortbow',
    ARROWS: 'Adamant arrow',
    BODY: 'Rune chainbody',
    LEGS: 'Rune platelegs',
    HELM: 'Rune full helm'
} as const;

/** Worn from the start: the monkey dodges every melee swing while TBWT is live. */
export const TB_GEAR: readonly string[] = [TB_NAME.BOW, TB_NAME.ARROWS, TB_NAME.BODY, TB_NAME.LEGS, TB_NAME.HELM];

export const ARROW_TARGET = 200;
export const FOOD_TARGET = 10;
export const COIN_TARGET = 500;

export const TB_TILE = {
    ARDOUGNE_BANK: new Tile(2616, 3332, 0),
    /** Timfraku sits on the first floor of the chief's hut; the ladder is at (2782,3087). */
    TIMFRAKU: new Tile(2780, 3087, 1),
    TAMAYU: new Tile(2844, 3042, 0),
    TINSAY: new Tile(2764, 2976, 0),
    TIADECHE: new Tile(2912, 3118, 0),
    LUBUFU: new Tile(2770, 3169, 0),
    /** `0_43_47_karambwanji` shoal in the Holy Lake south of the village. */
    KARAMBWANJI_SHOAL: new Tile(2801, 3010, 0),
    /** `lubufu_karambwan`, the one spot the vessel may be lowered into. */
    KARAMBWAN_SHOAL: new Tile(2768, 3165, 0),
    /** Jiminua's Jungle Store, north edge of Tai Bwo Wannai. */
    JIMINUA: new Tile(2767, 3122, 0),
    /** Zambo's bar in Musa Point — the only Karamjan rum on the island. */
    ZAMBO: new Tile(2925, 3143, 0),
    BANANA_PLANTATION: new Tile(2916, 3161, 0),
    /** Why: both Brimhaven ranges are out — one is inside the Shrimp and Parrot kitchen behind Heroes' Quest, the other in a room the baked graph has no door into.
     *  The permanent jungle fire south of the village is the only cooking source this quest can reach. */
    FIRE: new Tile(2789, 3049, 0),
    MONKEYS: new Tile(2833, 3031, 0),
    /** Why: the jungle edge the Jogres wander from — their own spawn tiles are outside the baked graph, and a walk aimed at one never arrives. */
    JOGRES: new Tile(2916, 3053, 0)
} as const;

export const TB_LOC = { FIRE: 'Fire', BANANA_TREE: 'Banana Tree' } as const;

export const TB_NPC = {
    TIMFRAKU: 'Timfraku',
    TAMAYU: 'Tamayu',
    TINSAY: 'Tinsay',
    TIADECHE: 'Tiadeche',
    LUBUFU: 'Lubufu',
    MONKEY: 'Monkey',
    JOGRE: 'Jogre',
    ZAMBO: 'Zambo',
    JIMINUA: 'Jiminua',
    FISHING_SPOT: 'Fishing spot'
} as const;

// Why: every option list is driven by preference, so re-ordered dialogue does not break a leg.

/** Title, then Trufitus's news, then the reward and the start prompt. */
export const TIMFRAKU_START: NpcStop = {
    npc: TB_NPC.TIMFRAKU,
    anchor: TB_TILE.TIMFRAKU,
    leash: 5,
    prefer: [
        'I am a roving adventurer.',
        'Trufitus sent me.',
        'Your gratitude is all I deserve.',
        'Yes'
    ]
};

export const TIMFRAKU_REWARD: NpcStop = {
    npc: TB_NPC.TIMFRAKU,
    anchor: TB_TILE.TIMFRAKU,
    leash: 5,
    prefer: ['Oh it was nothing really.', 'Ok, thanks.']
};

interface Pos {
    x: number;
    z: number;
    level: number;
}

// Why: the bank is Ardougne, across a 30gp ferry, so "am I still on the island" is what decides whether a missing item is worth a crossing.

/** Karamja, Brimhaven and the ferry decks. */
export function onKaramja(t: Pos | null | undefined): boolean {
    return !!t && t.x >= 2700 && t.x <= 3010 && t.z >= 2870 && t.z <= 3260;
}

/** The Shaikahan hunt teleports the player into the m39_71 pocket and back out again. */
export function inCutscene(t: Pos | null | undefined): boolean {
    return !!t && t.x >= 2496 && t.x <= 2559 && t.z >= 4544 && t.z <= 4607;
}
