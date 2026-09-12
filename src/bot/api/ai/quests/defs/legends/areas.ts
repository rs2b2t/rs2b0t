import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot } from '../../engine/types.js';

export const LEGENDS_QUEST = 'Legends Quest';

/** Mirrors `quest_legends.constant`. */
export const LQ_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    MAPPED_JUNGLE: 2,
    GOT_BULLROARER: 3,
    SWUNG_BULLROARER: 4,
    ACCEPTED_RESCUE: 5,
    FOUND_ENTRANCE: 6,
    SPOKE_UNGADULU: 7,
    ASKED_GUJUO_WATER: 8,
    FILLED_BOWL: 10,
    SUMMONED_NEZI_FIRE: 11,
    DEFEATED_NEZI_FIRE: 12,
    GERMINATED_SEEDS: 13,
    POOL_DRIED: 14,
    TALK_GUJUO_POOL: 15,
    ENTER_LOWER_DUNGEON: 16,
    CRYSTAL_SMELTED: 17,
    HEART_IN_RECESS: 18,
    PUSHED_BOULDER: 19,
    RECEIVED_DAGGER: 20,
    DEFEATED_NEZI_WATER: 22,
    SACRED_WATER: 25,
    COLLECTED_TOTEM: 30,
    SPAWNED_NEZI_FINAL: 32,
    DEFEATED_NEZI_FINAL: 35,
    REPLACED_TOTEM: 40,
    GOT_GILDED_TOTEM: 45,
    RETURNED_TO_RADIMUS: 50,
    TRAINING_1: 55,
    TRAINING_2: 60,
    TRAINING_3: 65,
    TRAINING_4: 70,
    COMPLETE: 75
} as const;

/** Server gates, read off `legends_journal.rs2`. */
export const LQ_SKILLS = {
    magic: 56,
    mining: 52,
    agility: 50,
    crafting: 50,
    smithing: 50,
    strength: 50,
    thieving: 50,
    woodcutting: 50,
    herblore: 45,
    prayer: 42
} as const;

// Why: display names collide all over this quest, 3 "Crystal" chunks, 2 golden bowls per fill state and "Rocks" for both the cave mouth and every ore vein, so every check goes through the id.
export const LQ_ID = {
    COINS: 995,

    MAP: 714,
    MAP_COMPLETE: 715,
    BULLROARER: 716,
    GOLD_BOWL_SKETCH: 720,
    GOLD_BOWL: 721,
    GOLD_BOWL_BLESSED: 722,
    GOLD_BOWL_WATER: 723,
    GOLD_BOWL_PURE: 724,
    GOLD_BOWL_BLESSED_WATER: 725,
    GOLD_BOWL_BLESSED_PURE: 726,
    HOLLOW_REED: 727,
    BOOK_OF_BINDING: 730,
    YOMMI_SEEDS: 735,
    YOMMI_SEEDS_GERM: 736,
    SNAKEWEED_MIXTURE: 737,
    ARDRIGAL_MIXTURE: 738,
    BRAVERY_POTION: 739,
    VIYELDI_HAT: 740,
    CRYSTAL_CHUNK: 741,
    CRYSTAL_HUNK: 742,
    CRYSTAL_LUMP: 743,
    HEART_CRYSTAL: 744,
    HEART_CRYSTAL_GLOW: 745,
    DEATH_DAGGER: 746,
    DEATH_DAGGER_DONE: 747,
    HOLY_FORCE: 748,
    TOTEM_POLE: 749,
    GILDED_TOTEM: 750,

    KNIFE: 946,
    ROPE: 954,
    PAPYRUS: 970,
    CHARCOAL: 973,
    MACHETE: 975,
    LOCKPICK: 1523,
    RUNE_AXE: 1359,
    HAMMER: 2347,
    GOLD_BAR: 2357,
    GOLD_ORE: 444,
    CHISEL: 1755,
    BRONZE_PICKAXE: 1265,
    RUNE_PICKAXE: 1275,
    ADAMANT_PICKAXE: 1271,
    MITHRIL_PICKAXE: 1273,
    STEEL_PICKAXE: 1269,
    IRON_PICKAXE: 1267,

    SNAKE_WEED: 1526,
    ARDRIGAL: 1528,
    UNID_SNAKE_WEED: 1525,
    UNID_ARDRIGAL: 1527,
    VIAL: 229,
    VIAL_WATER: 227,

    UNPOWERED_ORB: 567,
    SOUL_RUNE: 566,
    MIND_RUNE: 558,
    EARTH_RUNE: 557,
    LAW_RUNE: 563,
    WATER_RUNE: 555,
    COSMIC_RUNE: 564,
    AIR_RUNE: 556,
    FIRE_RUNE: 554,
    DEATH_RUNE: 560,

    OPAL: 1609,
    JADE: 1611,
    RED_TOPAZ: 1613,
    SAPPHIRE: 1607,
    EMERALD: 1605,
    RUBY: 1603,
    DIAMOND: 1601,
    UNCUT_OPAL: 1625,
    UNCUT_JADE: 1627,
    UNCUT_RED_TOPAZ: 1629,
    UNCUT_SAPPHIRE: 1623,
    UNCUT_EMERALD: 1621,
    UNCUT_RUBY: 1619,
    UNCUT_DIAMOND: 1617,

    RUNE_SCIMITAR: 1333,
    LOBSTER: 379,
    SWORDFISH: 373,
    SHARK: 385,
    TUNA: 361,

    /** What each trial boulder leaves behind, worth nothing and one slot. */
    SWAMP_ROCK: 594
} as const;

// Why: both Radimus notes render the same name, both Yommi seed states too, and 5 golden-bowl states share "Golden bowl", so every lookup that matters goes through `LQ_ID`.
/** Display names as the client renders them. */
export const LQ_ITEM = {
    COINS: 'Coins',
    MAP: 'Radimus notes',
    MAP_COMPLETE: 'Radimus notes',
    BULLROARER: 'Bull roarer',
    GOLD_BOWL: 'Gold bowl',
    GOLD_BOWL_BLESSED: 'Blessed gold bowl',
    GOLD_BOWL_BLESSED_PURE: 'Golden bowl',
    HOLLOW_REED: 'Hollow reed',
    BOOK_OF_BINDING: 'Book of binding',
    YOMMI_SEEDS: 'Yommi tree seeds',
    YOMMI_SEEDS_GERM: 'Yommi tree seeds',
    BRAVERY_POTION: 'Bravery potion',
    SNAKEWEED_MIXTURE: 'Snakeweed mixture',
    CRYSTAL_CHUNK: 'Chunk of crystal',
    CRYSTAL_HUNK: 'Hunk of crystal',
    CRYSTAL_LUMP: 'Lump of crystal',
    HEART_CRYSTAL: 'Heart crystal',
    DEATH_DAGGER: 'Black dagger',
    DEATH_DAGGER_DONE: 'Glowing dagger',
    HOLY_FORCE: 'Holy force',
    TOTEM_POLE: 'Yommi totem',
    GILDED_TOTEM: 'Gilded totem',
    SKETCH: 'Sketch',

    KNIFE: 'Knife',
    ROPE: 'Rope',
    PAPYRUS: 'Papyrus',
    CHARCOAL: 'Charcoal',
    MACHETE: 'Machete',
    LOCKPICK: 'Lockpick',
    RUNE_AXE: 'Rune axe',
    HAMMER: 'Hammer',
    GOLD_BAR: 'Gold bar',
    CHISEL: 'Chisel',

    SNAKE_WEED: 'Snake weed',
    ARDRIGAL: 'Ardrigal',
    VIAL: 'Vial',
    VIAL_WATER: 'Vial of water',

    UNPOWERED_ORB: 'Unpowered orb',
    SOUL_RUNE: 'Soul rune',
    MIND_RUNE: 'Mind rune',
    EARTH_RUNE: 'Earth rune',
    LAW_RUNE: 'Law rune',
    WATER_RUNE: 'Water rune',
    COSMIC_RUNE: 'Cosmic rune',
    AIR_RUNE: 'Air rune',
    FIRE_RUNE: 'Fire rune',
    DEATH_RUNE: 'Death rune',

    OPAL: 'Opal',
    JADE: 'Jade',
    RED_TOPAZ: 'Red topaz',
    SAPPHIRE: 'Sapphire',
    EMERALD: 'Emerald',
    RUBY: 'Ruby',
    DIAMOND: 'Diamond',

    RUNE_SCIMITAR: 'Rune scimitar',
    LOBSTER: 'Lobster',
    SWORDFISH: 'Swordfish',
    SHARK: 'Shark',
    TUNA: 'Tuna'
} as const;

// Why: an NPC's display name comes from the `.npc` config: every walkthrough calls him Sir Radimus Erkle and the server calls him Radimus Erkle.
export const LQ_NPC = {
    GUARD: 'Legends Guard',
    RADIMUS: 'Radimus Erkle',
    FORESTER: 'Jungle Forester',
    GUJUO: 'Gujuo',
    UNGADULU: 'Ungadulu',
    NEZIKCHENED: 'Nezikchened',
    ECHNED: 'Echned Zekin',
    VIYELDI: 'Viyeldi',
    SAN_TOJALON: 'San Tojalon',
    IRVIG_SENAY: 'Irvig Senay',
    RANALPH_DEVERE: 'Ranalph Devere',
    BOULDER: 'Boulder'
} as const;

export const LQ_LOC = {
    CUPBOARD: 'Cupboard',
    CUPBOARD_OPEN: 'Open Cupboard',
    GUILD_DOOR: 'Legends Guild door',
    JUNGLE_TREE: 'Jungle Tree',
    JUNGLE_BUSH: 'Jungle Bush',
    MOSSY_ROCK: 'Mossy rock',
    ROCKS: 'Rocks',
    CAVE_ENTRANCE: 'Cave entrance',
    FIRE_WALL: 'Fire Wall',
    BOOKCASE: 'Bookcase',
    CREVICE: 'Crevice',
    ANCIENT_GATE: 'Ancient Gate',
    GUILD_GATE: 'Gate',
    BOULDER: 'Boulder',
    JAGGED_WALL: 'Jagged wall',
    MARKED_WALL: 'Marked wall',
    CARVED_ROCK: 'Carved rock',
    WINCH: 'Winch',
    CLIMB_ROPE: 'Climbing rope',
    ROCKY_LEDGE: 'Rocky Ledge',
    FURNACE: 'Furnace',
    RECESS: 'Recess',
    RECESS_FULL: 'Filled Recess',
    BARRIER: 'Shimmering field',
    /** The pool the pushed boulder uncovers, at the source. */
    SOURCE_POOL: 'Sacred water',
    /** The jungle pool, before and after it is fouled. */
    SACRED_WATER: 'Water Pool',
    POLLUTED_WATER: 'Polluted water',
    TALL_REEDS: 'Tall Reeds',
    FERTILE_SOIL: 'Fertile Soil',
    YOMMI_SAPLING: 'Yommi tree sapling',
    YOMMI_ADULT: 'Adult Yommi tree',
    YOMMI_FELLED: 'Felled Yommi tree',
    YOMMI_TRIMMED: 'Trimmed Yommi',
    YOMMI_TOTEM: 'Totem pole',
    TOTEM_POLE: 'Totem Pole',
    ANVIL: 'Anvil'
} as const;

/** Exact loc ids, for the several places where a display name is shared. */
export const LQ_LOC_ID = {
    GUILD_GATE_L: 2391,
    GUILD_GATE_R: 2392,
    LOCKPICK_GATE_L: 2912,
    LOCKPICK_GATE_R: 2913,
    // Why: `next_loc_stage` swings each leaf to `inac_lglockpickgatebottom*`, a model with no name and no ops, so a query for the shut id finds nothing, same as the gate being out of the scene, unless the open ids are known too.
    LOCKPICK_GATE_L_OPEN: 2914,
    LOCKPICK_GATE_R_OPEN: 2915,
    STRENGTH_GATE_L: 2922,
    STRENGTH_GATE_R: 2923,
    BOULDER_1: 2919,
    BOULDER_2: 2920,
    BOULDER_3: 2921,
    MARKED_WALL: 2927,
    GEM_ROCK: 2928,
    MAGIC_GATE: 2930,
    WINCH_NO_ROPE: 2934,
    WINCH_ROPE: 2935,
    ROCKY_LEDGE_0: 2959,
    ROCKY_LEDGE_1: 2960,
    ROCKY_LEDGE_2: 2961,
    CLIMB_ROCK_1: 2962,
    CLIMB_ROCK_2: 2963,
    CLIMB_ROCK_3: 2964,
    DRAGONS_EYE_ROCK: 2965,
    FURNACE: 2966,
    RECESS_EMPTY: 2969,
    RECESS_FULL: 2970,
    BARRIER: 2971,
    MOSSY_ROCK_1: 2900,
    MOSSY_ROCK_2: 2901,
    MOSSY_ROCK_3: 2902,
    SACRED_WATER: 2942,
    SACRED_WATER_POLLUTED: 2943,
    TALL_REEDS: 2944,
    WATER_POOL_SOURCE: 2941,
    FERTILE_SOIL: 2956,
    DAMAGED_EARTH: 2957,
    EVIL_TOTEM: 2936,
    GOOD_TOTEM: 2937,
    CUPBOARD_SHUT: 2885,
    CUPBOARD_OPEN: 2886,
    MAGIC_GATE_OPEN: 2931,
    YOMMI_BABY: 2945,
    YOMMI_SAPLING: 2946,
    YOMMI_ADULT: 2948,
    YOMMI_FELLED: 2950,
    YOMMI_TRIMMED: 2952,
    YOMMI_TOTEM: 2954
} as const;

// Why: Shilo's bank is an NPC op, 18 tiles from Hajedy's cart; Legends eligibility already covers its quest gate.
export const LQ_BANK = {
    ARDOUGNE: new Tile(2616, 3332, 0),
    YANILLE: new Tile(2612, 3092, 0),
    /** Shilo Village's teller: no booth, an npc with a Bank op, 18 tiles off Hajedy's cart. */
    SHILO: new Tile(2852, 2954, 0)
} as const;

// Why: Obli's counter in Shilo Village stocks the same list and is 30 tiles from the gem rocks, but Jiminua's is the one the Tai Bwo Wannai leg already passes.
export const LQ_SHOP = {
    /** Jiminua's Jungle Store, Tai Bwo Wannai, papyrus, charcoal, machete, knife, rope, vials, chisel, hammer, pickaxe. */
    JIMINUA: { npc: 'Jiminua', anchor: new Tile(2767, 3122, 0) },
    /** Magic Guild Store, Yanille first floor, the only soul-rune counter in the game. */
    MAGIC_GUILD: { npc: 'Magic Store owner', anchor: new Tile(2595, 3087, 1) }
} as const;

export const LQ_TILE = {
    /** Outside the Legends Guild gate, where the guard patrols. */
    GUARD: new Tile(2728, 3348, 0),
    /** Radimus' study, west building. */
    RADIMUS_STUDY: new Tile(2725, 3368, 0),
    /** The main hall, behind the Legends Guild doors. */
    RADIMUS_HALL: new Tile(2724, 3378, 0),
    GUILD_DOORS: new Tile(2729, 3372, 0),
    /** The cupboard's own tile is blocked and only its south neighbour is open. */
    CUPBOARD: new Tile(2724, 3369, 0),

    /** The one mainland tile the dense-jungle band can be chopped south from. */
    JUNGLE_MOUTH: new Tile(2816, 2940, 0),
    /** 2 chops south of the mouth, inside the jungle component. */
    JUNGLE_INSIDE: new Tile(2816, 2936, 0),
    /** Nearest forester to the jungle mouth. */
    FORESTER: new Tile(2817, 2942, 0),

    /** One tile inside each of the 3 map sections. */
    MAP_WEST: new Tile(2790, 2910, 0),
    MAP_MIDDLE: new Tile(2840, 2910, 0),
    MAP_EAST: new Tile(2900, 2910, 0),

    /** Where the bullroarer is swung: open jungle, clear of the dense band. */
    BULLROARER_SPOT: new Tile(2820, 2920, 0),

    /** East of the mossy rocks: the only walkable neighbour on the jungle side. */
    MOSSY_ROCKS: new Tile(2783, 2936, 0),
    CAVE_LANDING: new Tile(2773, 9341, 0),
    CAVE_EXIT: new Tile(2773, 9341, 0),
    CAVE_EXIT_LANDING: new Tile(2781, 2934, 0),

    /** Outside the octagram, on the west side, in speaking range of Ungadulu. */
    OCTAGRAM_OUTSIDE: new Tile(2785, 9328, 0),
    OCTAGRAM_INSIDE: new Tile(2790, 9328, 0),
    UNGADULU: new Tile(2792, 9327, 0),
    /** The west wall's own tile, outside the flames and 4 from Ungadulu. */
    FIRE_WALL_WEST: new Tile(2788, 9325, 0),

    SHAMAN_BOOKCASE: new Tile(2795, 9338, 0),
    SHAMAN_CREVICE: new Tile(2799, 9340, 0),

    LOCKPICK_GATE_NORTH: new Tile(2809, 9333, 0),
    LOCKPICK_GATE_SOUTH: new Tile(2809, 9331, 0),
    BOULDER_1_NORTH: new Tile(2809, 9329, 0),
    BOULDER_1_SOUTH: new Tile(2809, 9325, 0),
    BOULDER_2_SOUTH: new Tile(2809, 9321, 0),
    BOULDER_3_SOUTH: new Tile(2809, 9317, 0),
    STRENGTH_GATE_NORTH: new Tile(2809, 9315, 0),
    STRENGTH_GATE_SOUTH: new Tile(2809, 9313, 0),
    JAGGED_WALL_SOUTH: new Tile(2790, 9295, 0),
    JAGGED_WALL_NORTH: new Tile(2789, 9296, 0),
    /** North of the jagged wall: the wall whose runes open the way into the gem room. */
    MARKED_WALL_IN: new Tile(2780, 9306, 0),
    /** In the gem room: the wall that leads back out. */
    MARKED_WALL_OUT: new Tile(2775, 9303, 0),
    GEM_ROOM_LANDING: new Tile(2774, 9301, 0),
    BOOK_SPAWN: new Tile(2765, 9297, 0),
    MAGIC_GATE_SOUTH: new Tile(2763, 9311, 0),
    MAGIC_GATE_NORTH: new Tile(2763, 9320, 0),
    WINCH: new Tile(2760, 9328, 0),

    VIYELDI_LEDGE: new Tile(2377, 4712, 0),
    VIYELDI_CLIMB_ROPE: new Tile(2377, 4712, 0),
    VIYELDI_MAIN: new Tile(2400, 4710, 0),
    DRAGONS_EYE: new Tile(2409, 4715, 0),
    LAVA_FURNACE: new Tile(2425, 4726, 0),
    HEART_RECESS: new Tile(2422, 4692, 0),
    BARRIER_NORTH: new Tile(2421, 4691, 0),
    BARRIER_SOUTH: new Tile(2421, 4689, 0),
    /** The middle source boulder, which is an NPC. */
    SOURCE_BOULDER: new Tile(2386, 4689, 0),
    /** 2 tiles east of it: the only side it can be pushed from. */
    SOURCE_STAND: new Tile(2389, 4689, 0),

    SACRED_POOL: new Tile(2837, 2917, 0),
    TALL_REEDS: new Tile(2836, 2917, 0),

    /** The 7 gem rocks north of Shilo Village, past Hajedy's cart. */
    GEM_ROCKS: new Tile(2825, 2997, 0),
    /** Brimhaven's gold rocks: the only ones on Karamja. */
    GOLD_ROCKS: new Tile(2733, 3225, 0),
    /** East Ardougne's furnace: the nearest one the walker can reach from Karamja. */
    FURNACE: new Tile(2601, 3310, 0),
    /** Tai Bwo Wannai's anvil, the golden bowl is a gold bar used on one. */
    ANVIL: new Tile(2790, 3102, 0),

    SNAKE_WEED: new Tile(2761, 3015, 0),
    ARDRIGAL: new Tile(2869, 3115, 0)
} as const;

/** The 7 carved rocks, in the order the gems are named on them. */
export const GEM_ROCKS: readonly { id: number; name: string; rock: Tile }[] = [
    { id: LQ_ID.OPAL, name: LQ_ITEM.OPAL, rock: new Tile(2764, 9309, 0) },
    { id: LQ_ID.JADE, name: LQ_ITEM.JADE, rock: new Tile(2771, 9303, 0) },
    { id: LQ_ID.RED_TOPAZ, name: LQ_ITEM.RED_TOPAZ, rock: new Tile(2772, 9295, 0) },
    { id: LQ_ID.SAPPHIRE, name: LQ_ITEM.SAPPHIRE, rock: new Tile(2781, 9291, 0) },
    { id: LQ_ID.DIAMOND, name: LQ_ITEM.DIAMOND, rock: new Tile(2774, 9287, 0) },
    { id: LQ_ID.RUBY, name: LQ_ITEM.RUBY, rock: new Tile(2767, 9289, 0) },
    { id: LQ_ID.EMERALD, name: LQ_ITEM.EMERALD, rock: new Tile(2757, 9297, 0) }
];

/** Uncut gem to its cut form, for the chisel leg. */
export const GEM_CUTS: readonly { uncut: number; uncutName: string; cut: number; name: string }[] = [
    { uncut: LQ_ID.UNCUT_OPAL, uncutName: 'Uncut opal', cut: LQ_ID.OPAL, name: LQ_ITEM.OPAL },
    { uncut: LQ_ID.UNCUT_JADE, uncutName: 'Uncut jade', cut: LQ_ID.JADE, name: LQ_ITEM.JADE },
    { uncut: LQ_ID.UNCUT_RED_TOPAZ, uncutName: 'Uncut red topaz', cut: LQ_ID.RED_TOPAZ, name: LQ_ITEM.RED_TOPAZ },
    { uncut: LQ_ID.UNCUT_SAPPHIRE, uncutName: 'Uncut sapphire', cut: LQ_ID.SAPPHIRE, name: LQ_ITEM.SAPPHIRE },
    { uncut: LQ_ID.UNCUT_EMERALD, uncutName: 'Uncut emerald', cut: LQ_ID.EMERALD, name: LQ_ITEM.EMERALD },
    { uncut: LQ_ID.UNCUT_RUBY, uncutName: 'Uncut ruby', cut: LQ_ID.RUBY, name: LQ_ITEM.RUBY },
    { uncut: LQ_ID.UNCUT_DIAMOND, uncutName: 'Uncut diamond', cut: LQ_ID.DIAMOND, name: LQ_ITEM.DIAMOND }
];

/** The 5 runes the marked wall wants, in the only order it accepts. */
export const WALL_RUNES: readonly { id: number; name: string }[] = [
    { id: LQ_ID.SOUL_RUNE, name: LQ_ITEM.SOUL_RUNE },
    { id: LQ_ID.MIND_RUNE, name: LQ_ITEM.MIND_RUNE },
    { id: LQ_ID.EARTH_RUNE, name: LQ_ITEM.EARTH_RUNE },
    { id: LQ_ID.LAW_RUNE, name: LQ_ITEM.LAW_RUNE },
    { id: LQ_ID.LAW_RUNE, name: LQ_ITEM.LAW_RUNE }
];

/** The 3 Viyeldi guardians, each holding one third of the dragon heart. */
export const HEROES: readonly { npc: string; section: number }[] = [
    { npc: LQ_NPC.SAN_TOJALON, section: LQ_ID.CRYSTAL_CHUNK },
    { npc: LQ_NPC.IRVIG_SENAY, section: LQ_ID.CRYSTAL_HUNK },
    { npc: LQ_NPC.RANALPH_DEVERE, section: LQ_ID.CRYSTAL_LUMP }
];

/** Every ordinary totem pole in the jungle; any one of them takes the new pole. */
export const EVIL_TOTEMS: readonly Tile[] = [
    new Tile(2793, 2908, 0),
    new Tile(2852, 2917, 0),
    new Tile(2875, 2913, 0),
    new Tile(2918, 2922, 0),
    new Tile(2950, 2901, 0)
];

/** Every fertile-soil patch; the Yommi tree is grown on one of them. */
export const FERTILE_SOILS: readonly Tile[] = [
    new Tile(2778, 2916, 0),
    new Tile(2808, 2904, 0),
    new Tile(2831, 2921, 0),
    new Tile(2867, 2923, 0),
    new Tile(2894, 2921, 0),
    new Tile(2911, 2905, 0)
];

// Why: each complex is a chain of sealed pockets joined only by scripted crossings, and their bounding boxes overlap: the trials corridor runs over the gem room's box and every Viyeldi descent ledge sits inside the main cave's.
// Why: `decide()` branches on the complex, and each crossing inside one is a custom step that probes the scene for the loc it needs.

/** The z of the last open jungle tile and of the first open mainland tile north of the band. */
export const JUNGLE_BAND = { south: 2936, north: 2940 } as const;

/** Standing inside the dense band itself, where nothing is walkable either way. */
export function inJungleBand(tile: QuestSnapshot['tile']): boolean {
    return !!tile && tile.level === 0 && tile.x >= 2757 && tile.x <= 3006
        && tile.z > JUNGLE_BAND.south && tile.z < JUNGLE_BAND.north;
}

export type LegendsArea = 'mainland' | 'jungle' | 'shamanCaves' | 'viyeldiCaves' | 'unknown';

/** Which of the quest's four worlds a tile is in. */
export function legendsArea(tile: QuestSnapshot['tile']): LegendsArea {
    if (!tile) {
        return 'unknown';
    }
    const { x, z } = tile;
    if (x >= 2752 && x <= 2815 && z >= 9280 && z <= 9343) {
        return 'shamanCaves';
    }
    if (x >= 2368 && x <= 2431 && z >= 4672 && z <= 4735) {
        return 'viyeldiCaves';
    }
    if (z >= 4000) {
        return 'unknown';
    }
    // The Kharazi Jungle: the southern strip of Karamja, sealed behind the dense band.
    // Why: the band's own 3 rows count as jungle, so a chop that lands halfway through never has a mainland step decided against it; no band tile has a walkable path out either way.
    if (x >= 2757 && x <= 3006 && z >= 2882 && z < JUNGLE_BAND.north) {
        return 'jungle';
    }
    return 'mainland';
}

// Why: transcribed from `legends_fire_wall_correct`. The octagram is 3 overlapping rectangles, and the 4th row the content lists is an acknowledged server bug the checks disagree about.

/** Inside Ungadulu's flaming octagram. */
export function inOctagram(tile: QuestSnapshot['tile']): boolean {
    if (!tile || tile.level !== 0) {
        return false;
    }
    const { x, z } = tile;
    return (x >= 2788 && x <= 2797 && z >= 9328 && z <= 9329)
        || (x >= 2792 && x <= 2793 && z >= 9324 && z <= 9333)
        || (x >= 2789 && x <= 2796 && z >= 9325 && z <= 9332);
}

// Why: the far side of the shimmering barrier is one component, and it is the only part of the Viyeldi caves below z 4691 or west of x 2400.

/** Past the barrier, in the half of the Viyeldi caves that holds the source. */
export function pastBarrier(tile: QuestSnapshot['tile']): boolean {
    if (!tile || legendsArea(tile) !== 'viyeldiCaves') {
        return false;
    }
    return tile.z <= 4690 || (tile.z <= 4701 && tile.x <= 2400);
}

/** On the 11-tile ledge the winch rope drops onto. */
export function onViyeldiLedge(tile: QuestSnapshot['tile']): boolean {
    return tile !== null && tile !== undefined && tile.level === 0
        && tile.x >= 2377 && tile.x <= 2379 && tile.z >= 4712 && tile.z <= 4717;
}

/** Which third of the jungle a tile is in, or null outside it. */
export function jungleSection(tile: QuestSnapshot['tile']): 'west' | 'middle' | 'east' | null {
    if (!tile || legendsArea(tile) !== 'jungle') {
        return null;
    }
    if (tile.x <= 2815) return 'west';
    if (tile.x <= 2879) return 'middle';
    return 'east';
}

/** Anywhere the walker can reach a bank booth from without a scripted crossing. */
export function onOpenGround(area: LegendsArea): boolean {
    return area === 'mainland';
}
