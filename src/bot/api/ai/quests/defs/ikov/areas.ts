// docs/QUESTS.md
import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const IKOV_QUEST = 'Temple of Ikov';

/** Object ids: "Lever" is both an obj and a loc here, and both pendants render as plain jewellery. */
export const IKOV_OBJ = {
    LIT_CANDLE: 33,
    UNLIT_CANDLE: 36,
    UNSTRUNG_YEW_SHORTBOW: 68,
    // Why: a stack of 2-5 arrows renders as its own object id, and all five share the display name.
    ICE_ARROW: 78,
    LEVER: 83,
    STAFF: 84,
    SHINY_KEY: 85,
    PENDANT_LUCIEN: 86,
    PENDANT_ARMADYL: 87,
    BOOTS: 88,
    BOOTS_WORN: 89,
    LIMPWURT_ROOT: 225,
    TINDERBOX: 590,
    YEW_SHORTBOW: 857,
    KNIFE: 946,
    IRON_AXE: 1349,
    YEW_LOGS: 1515,
    BOW_STRING: 1777,
    FLAX: 1779
} as const;

export const IKOV_LOC = {
    LEVER_BRACKET: 86,
    MENDED_LEVER: 87,
    LEVER_DOWN: 88,
    SOUTH_GATE_LEFT: 89,
    SOUTH_GATE_RIGHT: 90,
    TRAP_LEVER: 91,
    FEAR_GATE_LEFT: 94,
    FEAR_GATE_RIGHT: 95,
    TRAPLEVER_DOOR: 92,
    FIREWARRIOR_DOOR: 93,
    DARK_STAIRS_UP: 96,
    DARK_STAIRS_DOWN: 98,
    TRAP_LADDER: 101,
    CHEST_SHUT: 103,
    CHEST_OPEN: 104,
    YEW_TREE: 1309,
    SECRET_WALL: 1586,
    SECRET_WALL_OPEN: 1587,
    SPINNING_WHEEL: 2644,
    FLAX: 2646,
    WEB: 733,
    WEB_SLASHED: 734
} as const;

/** The lava bridge: stepping onto any of these tiles carries the player across, or into the lava. */
export const LAVA_BRIDGE_ZONE = { minX: 2648, maxX: 2650, minZ: 9828, maxZ: 9829, level: 0 } as const;

export const IKOV_NPC = {
    HOBGOBLIN_UNARMED: 122,
    HOBGOBLIN_ARMED: 123,
    LUCIEN_HOSTILE: 272,
    LUCIEN_QUESTGIVER: 273,
    GUARDIAN_MALE: 274,
    GUARDIAN_FEMALE: 275,
    WINELDA: 276,
    FIRE_WARRIOR: 277
} as const;

export const IKOV_NAME = {
    LIT_CANDLE: 'Lit candle',
    CANDLE: 'Candle',
    TINDERBOX: 'Tinderbox',
    KNIFE: 'Knife',
    IRON_AXE: 'Iron axe',
    YEW_LOGS: 'Yew logs',
    FLAX: 'Flax',
    BOW_STRING: 'Bow string',
    YEW_SHORTBOW: 'Yew shortbow',
    UNSTRUNG_YEW_SHORTBOW: 'Yew shortbow (u)',
    ICE_ARROWS: 'Ice arrows',
    BOOTS: 'Boots of lightness',
    PENDANT_LUCIEN: 'Pendant of lucien',
    PENDANT_ARMADYL: 'Armadyl pendant',
    SHINY_KEY: 'Shiny key',
    LEVER: 'Lever',
    LIMPWURT_ROOT: 'Limpwurt root',
    LOBSTER: 'Lobster'
} as const;

/** Everything this quest will eat, best first. */
export const IKOV_FOODS = ['lobster', 'swordfish', 'tuna'];

/** Roots Winelda wants, and the ferry across the lava is the only way past her. */
export const ROOTS_WANTED = 20;
// Why: he has 59 hitpoints, four shots in five land recoverable on the floor, and the leg sweeps them mid-fight — so this is a comfortable floor rather than a stockpile, and one chest circuit clears it.

/** Ice arrows held before the Fire Warrior is engaged. */
export const ARROWS_WANTED = 20;

export const IKOV_TILE = {
    /** Lucien in the Flying Horse Inn, East Ardougne. */
    LUCIEN_INN: new Tile(2573, 3321, 0),
    /** Lucien's holding north of Varrock; his door needs the quest started. */
    LUCIEN_HUT: new Tile(3176, 3476, 0),
    ARDOUGNE_BANK: new Tile(2616, 3332, 0),
    SEERS_BANK: new Tile(2725, 3491, 0),
    CATHERBY_BANK: new Tile(2809, 3441, 0),

    // Why: the Ardougne Armoury also stocks an iron axe, and its gate answers "This is a restricted area" until Biohazard is complete.
    AEMAD: new Tile(2613, 3294, 0),
    CANDLE_MAKER: new Tile(2800, 3439, 0),
    ARHEIN: new Tile(2803, 3430, 0),
    KNIFE_SPAWN: new Tile(2704, 3475, 0),
    /** West of the yew at (2760,3431); the tree's own 3x3 is not a stand. */
    YEW_TREES: new Tile(2759, 3431, 0),
    FLAX_FIELD: new Tile(2740, 3444, 0),
    // Why: `spinningwheel` is `forceapproach=south` placed at angle 3, so the only legal side is east in world space.
    SPINNING_WHEEL: new Tile(2712, 3471, 1),
    SPINNING_WHEEL_STAIRS: new Tile(2714, 3472, 0),
    // Why: ten of the fourteen surface hobgoblins stand on the peninsula west of the Crafting Guild at (2939,3282), against six on the Ardougne coast — and Falador West is a shorter bank run than Ardougne's.
    HOBGOBLINS: new Tile(2911, 3284, 0),
    /** Clear of the camp's aggro, on the road north to the Falador West booth. */
    HOBGOBLIN_RETREAT: new Tile(2933, 3323, 0),

    TEMPLE_LADDER: new Tile(2677, 3406, 0),
    ENTRANCE: new Tile(2677, 9806, 0),
    /** South side of the Door of Fear: the pendant has to be worn to open it from here. */
    FEAR_GATE_SOUTH: new Tile(2661, 9814, 0),
    FEAR_GATE_NORTH: new Tile(2661, 9815, 0),
    /** North side of the south gate, which needs the mended lever pulled. */
    SOUTH_GATE_NORTH: new Tile(2661, 9803, 0),
    SOUTH_GATE_SOUTH: new Tile(2661, 9802, 0),
    LEVER_BRACKET: new Tile(2672, 9804, 0),
    DARK_STAIRS_DOWN: new Tile(2654, 9808, 0),
    DARK_LANDING: new Tile(2641, 9764, 0),
    /** South of the web that seals the boots alcove; a knife cuts it, a knife in the pack does not. */
    BOOTS_WEB: new Tile(2654, 9765, 0),
    BOOTS_SPAWN: new Tile(2654, 9767, 0),
    DARK_STAIRS_UP: new Tile(2641, 9763, 0),
    DARK_STAIRS_ARRIVE: new Tile(2654, 9809, 0),
    /** East of the lava bridge; stepping into the zone is what carries you across. */
    BRIDGE_EAST: new Tile(2651, 9828, 0),
    BRIDGE_ZONE_EAST: new Tile(2650, 9828, 0),
    BRIDGE_ZONE_WEST: new Tile(2648, 9828, 0),
    BRIDGE_WEST: new Tile(2647, 9828, 0),
    IKOV_LEVER_SPAWN: new Tile(2637, 9819, 0),
    TRAP_LEVER: new Tile(2665, 9854, 0),
    TRAP_PIT_LADDER: new Tile(2682, 9850, 0),
    TRAPLEVER_DOOR_SOUTH: new Tile(2648, 9856, 0),
    FIRE_DOOR_SOUTH: new Tile(2646, 9869, 0),
    FIRE_WARRIOR_SPAWN: new Tile(2646, 9866, 0),
    WINELDA: new Tile(2656, 9875, 0),
    /** Where Winelda's teleport lands, on the far side of the lava. */
    WINELDA_LANDING: new Tile(2664, 9876, 0),
    SHINY_KEY_SPAWN: new Tile(2628, 9859, 0),
    /** The wall's own tile, on the Winelda-landing side; pushing it opens the guardians' temple. */
    SECRET_WALL: new Tile(2643, 9892, 0),
    SECRET_WALL_INSIDE: new Tile(2643, 9893, 0),
    GUARDIANS: new Tile(2643, 9897, 0),
    MCGRUBOR_LADDER: new Tile(2659, 9893, 0),
    MCGRUBOR_SURFACE: new Tile(2659, 3493, 0)
} as const;

// Why: `ikov_chestclosed` is `forceapproach=north` and each placement rotates that clockwise, so the stand is the only side an Open lands from — anywhere else the op is dropped in silence.

/** The six ice-arrow chests; one of them holds arrows, and which one is re-rolled after every find. */
export const ICE_CHESTS: readonly { loc: Tile; stand: Tile }[] = [
    { loc: new Tile(2710, 9850, 0), stand: new Tile(2710, 9849, 0) },
    { loc: new Tile(2719, 9838, 0), stand: new Tile(2719, 9839, 0) },
    { loc: new Tile(2729, 9850, 0), stand: new Tile(2729, 9849, 0) },
    { loc: new Tile(2738, 9835, 0), stand: new Tile(2739, 9835, 0) },
    { loc: new Tile(2745, 9821, 0), stand: new Tile(2745, 9822, 0) },
    { loc: new Tile(2747, 9848, 0), stand: new Tile(2746, 9848, 0) }
];

// Why: the first two options start the quest; "That sounds like a laugh!" is the only branch that hands the pendant over.
export const LUCIEN_START: NpcStop = {
    npc: 'Lucien',
    anchor: IKOV_TILE.LUCIEN_INN,
    leash: 8,
    prefer: [
        "I'm a mighty hero!",
        'That sounds like a laugh!',
        "Why can't you get it yourself?",
        "What's the reward?"
    ]
};

export const WINELDA_STOP: NpcStop = {
    npc: 'Winelda',
    anchor: IKOV_TILE.WINELDA,
    leash: 8,
    prefer: ['Yes I do!', 'Yes we do!']
};

// Why: the "yearly bath" branch is the only one that ends in the Armadyl pendant; every other answer sets the guardian on you.
export const GUARDIAN_STOP: NpcStop = {
    npc: 'Guardian of Armadyl',
    anchor: IKOV_TILE.GUARDIANS,
    leash: 12,
    prefer: [
        'I seek the Staff of Armadyl.',
        'Lucien will give me a grand reward for it!',
        "You're right, it's time for my yearly bath.",
        "Ok! I'll help!"
    ]
};

export function inDarkRoom(t: { x: number; z: number }): boolean {
    return t.x >= 2639 && t.x <= 2655 && t.z >= 9759 && t.z <= 9768;
}

export function inChamberOfFear(t: { x: number; z: number }): boolean {
    return t.x >= 2646 && t.x <= 2686 && t.z >= 9815 && t.z <= 9855;
}

/** West of the lava bridge, where the Lever lies; the bridge is the only way in or out. */
export function westOfBridge(t: { x: number; z: number }): boolean {
    return t.x >= 2630 && t.x <= 2647 && t.z >= 9815 && t.z <= 9835;
}

/** South of the mended-lever gate: the cavern that loops east to the six ice-arrow chests. */
export function inIceCavern(t: { x: number; z: number }): boolean {
    return t.z <= 9802 || t.x >= 2688;
}

// Why: `inIceCavern` is a half-plane rather than a box, and the boots room sits inside it — so "south or east of the temple" is not the same question as "through the south gate", and only this one may stand in for the gate.

/** Through the south gate, which the boots room is not however far south it lies. */
export function pastSouthGate(t: { x: number; z: number }): boolean {
    return inIceCavern(t) && !inDarkRoom(t);
}

export function inTrapPit(t: { x: number; z: number }): boolean {
    return t.x >= 2672 && t.x <= 2686 && t.z >= 9845 && t.z <= 9856;
}

// Why: the far side wraps past the ledge on both sides, and this box is the strip that holds only the ledge itself.

/** The ledge Winelda stands on, between the Fire Warrior's room and the lava. */
export function onWineldaLedge(t: { x: number; z: number }): boolean {
    return t.x >= 2643 && t.x <= 2658 && t.z >= 9871 && t.z <= 9879;
}

// Why: the far side of the lava wraps around the Fire Warrior's room and Winelda's ledge, so no rectangle separates them — only the temple behind the wall is boxable, and the corridor at z 9893 is the one row where both sides have tiles.

/** The guardians' temple, behind the secret wall. */
export function inGuardianTemple(t: { x: number; z: number }): boolean {
    if (t.x < 2633 || t.x > 2651) {
        return false;
    }
    if (t.z >= 9894) {
        return true;
    }
    return t.z === 9893 && t.x >= 2642 && t.x <= 2645;
}

export function inTemple(t: { x: number; z: number; level: number }): boolean {
    return t.level === 0 && t.x >= 2624 && t.x <= 2751 && t.z >= 9728 && t.z <= 9919;
}
