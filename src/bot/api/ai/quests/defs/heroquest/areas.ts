import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import Tile from '../../../../../geometry/Tile.js';
import type { LadderHop, NpcStop } from '../../exec/primitives.js';

export const HERO_NAME = "Hero's Quest";

/** Object ids. Key, Herb, Chest and Door each name more than one object, so nothing here is matched by name. */
export const HERO_ID = {
    COINS: 995,
    /** Grip's spare, tradeable — the only way a Phoenix bot crosses the side door. */
    MISC_KEY: 1586,
    /** Grip's own keyring, untradeable, dropped for everyone by `obj_addall`. */
    GRIP_KEYS: 1588,
    ID_PAPERS: 1584,
    CANDLESTICK: 1577,
    ARMBAND: 1579,
    BLACK_PLATEBODY: 1125,
    BLACK_PLATELEGS: 1077,
    BLACK_FULL_HELM: 1165,
    OAK_LONGBOW: 845,
    STEEL_ARROW: 886,
    ICE_GLOVES: 1580,
    FEATHER: 1583,
    SLIME: 1581,
    BLAMISH_OIL: 1582,
    UNID_HARRALANDER: 205,
    HARRALANDER: 255,
    VIAL_WATER: 227,
    VIAL_EMPTY: 229,
    HARRALANDER_VIAL: 97,
    FISHING_ROD: 307,
    OILY_ROD: 1585,
    FISHING_BAIT: 313,
    RAW_LAVA_EEL: 2148,
    LAVA_EEL: 2149,
    /** The Jailer's drop, which opens Velrak's cell. */
    JAIL_KEY: 1591,
    /** Velrak's gift, which opens the deep dungeon the lava eels are in. */
    DUSTY_KEY: 1590,
    TINDERBOX: 590,
    LOGS: 1511
} as const;

/** Display names, which is what shop and inventory clicks match on. */
export const HERO_NAMED = {
    MISC_KEY: 'Miscellaneous key',
    GRIP_KEYS: "Grips' keyring",
    ID_PAPERS: 'Id papers',
    CANDLESTICK: "Pete's candlestick",
    ARMBAND: "Thieves' armband",
    BLACK_PLATEBODY: 'Black platebody',
    BLACK_PLATELEGS: 'Black platelegs',
    BLACK_FULL_HELM: 'Black full helm',
    OAK_LONGBOW: 'Oak longbow',
    STEEL_ARROW: 'Steel arrow',
    ICE_GLOVES: 'Ice gloves',
    FEATHER: 'Fire feather',
    SLIME: 'Blamish snail slime',
    BLAMISH_OIL: 'Blamish oil',
    // Why: every grimy herb is called Herb, so the pack is read by id and only the display name is clicked.
    UNID_HERB: 'Herb',
    HARRALANDER: 'Harralander',
    VIAL_WATER: 'Vial of water',
    VIAL_EMPTY: 'Vial',
    HARRALANDER_VIAL: 'Unfinished potion',
    FISHING_ROD: 'Fishing rod',
    OILY_ROD: 'Oily fishing rod',
    FISHING_BAIT: 'Fishing bait',
    RAW_LAVA_EEL: 'Raw lava eel',
    LAVA_EEL: 'Lava eel',
    JAIL_KEY: 'Jail key',
    DUSTY_KEY: 'Dusty key',
    TINDERBOX: 'Tinderbox',
    LOGS: 'Logs',
    COINS: 'Coins'
} as const;

export const HERO_NPC = {
    ACHIETTIES: 796,
    KATRINE: 642,
    STRAVEN: 644,
    GRUBOR: 789,
    TROBERT: 790,
    ALFONSE: 793,
    CHARLIE: 794,
    GARV: 788,
    GRIP: 792,
    PIRATE_GUARD: 799,
    ICE_QUEEN: 795,
    FIREBIRD: 139,
    CHAOS_DRUID: 181,
    LAVA_FISH: 800,
    JAILER: 201,
    VELRAK: 798,
    GERRANT: 558,
    JATIX: 587,
    LOWE: 550,
    VALAINE: 536,
    HORVIK: 549
} as const;

export const HERO_LOC = {
    TREASURE_DOOR: 2621,
    SIDE_DOOR: 2622,
    GRUBOR_DOOR: 2626,
    GARV_DOOR: 2627,
    KITCHEN_DOOR: 2628,
    /** "Wall", op1 Push — never a Door, so no derivation ever bakes it. */
    KITCHEN_PANEL: 2629,
    CHEST_SHUT: 2632,
    CHEST_OPEN: 2633,
    /** Velrak's cell, which only the jail key opens. */
    JAIL_DOOR: 2631,
    /** The deep dungeon the lava eels are in, which only the dusty key opens. */
    DEEP_GATE: 2623,
    CABINET_SHUT: 2635,
    CABINET_OPEN: 2636
} as const;

/** Every tile is walkable in the collision pack unless the comment says which loc blocks it. */
export const HERO_TILE = {
    ACHIETTIES: new Tile(2903, 3511, 0),
    // Why: `grubordoor` is a west wall, so its two sides are east and west of one tile, not north and south.
    /** The alley outside the Black Arm Brimhaven hideout. */
    GRUBOR_DOOR: new Tile(2810, 3170, 0),
    /** Past the door, in the hideout. */
    GRUBOR_DOOR_INNER: new Tile(2811, 3170, 0),
    TROBERT: new Tile(2806, 3175, 0),
    ALFONSE: new Tile(2793, 3189, 0),
    /** The restaurant floor, south of the kitchen door. */
    KITCHEN_DOOR: new Tile(2788, 3189, 0),
    /** Inside the kitchen, north of the door. */
    KITCHEN_DOOR_INNER: new Tile(2788, 3190, 0),
    CHARLIE: new Tile(2789, 3191, 0),
    /** East of the panel, inside the kitchen. */
    KITCHEN_PANEL: new Tile(2787, 3190, 0),
    /** West of the panel, in Mr Olbors' garden. */
    KITCHEN_PANEL_INNER: new Tile(2786, 3190, 0),
    GARDEN: new Tile(2784, 3194, 0),
    /** The dead-end yard the garden door opens into, south of the side door. */
    YARD: new Tile(2781, 3196, 0),
    /** The five-tile side room, north of the side door. */
    SIDE_ROOM: new Tile(2781, 3197, 0),
    /** Beside the arrow slit; `snipable_wall` carries blockrange=no, so Grip is shootable through it. */
    ARROW_SLIT: new Tile(2780, 3198, 0),
    /** Where `summon_grip` walks Grip, three tiles west of the slit on one row. */
    GRIP_LURE: new Tile(2777, 3198, 0),
    GARV_DOOR: new Tile(2774, 3187, 0),
    GARV_DOOR_INNER: new Tile(2774, 3188, 0),
    GRIP: new Tile(2774, 3191, 0),
    /** North of the drinks cabinet: `forceapproach=east` at angle 3 rotates to north. */
    CABINET_STAND: new Tile(2775, 3197, 0),
    /** The mansion's west wing, past the ordinary door at (2767,3194). */
    WEST_WING: new Tile(2765, 3194, 0),
    /** West of the treasure door, in the west wing. */
    TREASURE_DOOR: new Tile(2763, 3197, 0),
    /** The treasure room side, which is the door's own tile. */
    TREASURE_DOOR_INNER: new Tile(2764, 3197, 0),
    /** South of the candlestick chest: `forceapproach=north` at angle 2 rotates to south. */
    CHEST_STAND: new Tile(2766, 3198, 0),
    /** Open street south of the Shrimp and Parrot, where the two bots meet to trade. */
    RENDEZVOUS: new Tile(2793, 3180, 0),

    GERRANT: new Tile(3013, 3226, 0),
    JATIX: new Tile(2899, 3428, 0),
    LOWE: new Tile(3232, 3424, 0),
    LOUIE: new Tile(3316, 3176, 0),
    HORVIK: new Tile(3229, 3439, 0),
    VALAINE: new Tile(3193, 3362, 1),
    SCAVVO: new Tile(3191, 3352, 1),
    CHAMPIONS_STAIRS: new Tile(3188, 3358, 0),
    CHAMPIONS_STAIRS_TOP: new Tile(3188, 3354, 1),

    TAVERLEY_LADDER: new Tile(2884, 3398, 0),
    TAVERLEY_DUNGEON: new Tile(2884, 9798, 0),
    CHAOS_DRUIDS: new Tile(2932, 9849, 0),
    /** Where the Jailer patrols, outside Velrak's cell. */
    JAILER: new Tile(2932, 9693, 0),
    // Why: `dungeonjail` is a south wall, so `check_axis` reads the door's own row as the outside.
    /** North of the cell door, where the jail key is used on it. */
    JAIL_DOOR: new Tile(2931, 9690, 0),
    /** Inside the cell, where the door lands you. */
    JAIL_DOOR_INNER: new Tile(2931, 9689, 0),
    VELRAK: new Tile(2931, 9686, 0),
    // Why: `deepdungeondoor` is a west wall, so its sides are east and west of one tile.
    /** East of the deep dungeon gate, where the dusty key is used on it. */
    DEEP_GATE: new Tile(2924, 9803, 0),
    /** Past the gate, where the lava eels are. */
    DEEP_GATE_INNER: new Tile(2923, 9803, 0),
    LAVA_FISH: new Tile(2892, 9767, 0),
    // Why: Taverley's own range (2844,3367) sits in a pocket the baked graph has no door into, so the
    // nearest cooking surface a walker can reach from the dungeon ladder is Catherby's.
    CATHERBY_RANGE: new Tile(2817, 3443, 0),

    WWM_LADDER: new Tile(2845, 3526, 0),
    WWM_DUNGEON: new Tile(2845, 9926, 0),
    ICE_QUEEN: new Tile(2866, 9955, 0),

    PORT_SARIM_MONK: new Tile(3048, 3236, 0),
    ENTRANA_DOCK: new Tile(2834, 3335, 0),
    FIREBIRD: new Tile(2847, 3387, 0),

    VARROCK_BANK: new Tile(3185, 3436, 0),
    DRAYNOR_BANK: new Tile(3092, 3245, 0)
} as const;

// Why: `pickPreferred` matches a lower-cased substring, so every fragment here is apostrophe-free —
// the content mixes straight and curly quotes and one wrong glyph silently picks no option at all.

export const ACHIETTIES: NpcStop = {
    npc: 'Achietties',
    anchor: HERO_TILE.ACHIETTIES,
    leash: 8,
    prefer: ['may I apply to join', 'start looking for all those things']
};

export const KATRINE_TASK: NpcStop = {
    npc: 'Katrine',
    anchor: new Tile(3186, 3385, 0),
    leash: 6,
    prefer: ['rank of master thief']
};

export const KATRINE_ARMBAND: NpcStop = {
    npc: 'Katrine',
    anchor: new Tile(3186, 3385, 0),
    leash: 6,
    prefer: ['have a candlestick now']
};

export const STRAVEN_TASK: NpcStop = {
    npc: 'Straven',
    anchor: new Tile(3246, 9780, 0),
    leash: 6,
    prefer: []
};

export const STRAVEN_ARMBAND: NpcStop = {
    npc: 'Straven',
    anchor: new Tile(3246, 9780, 0),
    leash: 6,
    prefer: []
};

export const TROBERT: NpcStop = {
    npc: 'Trobert',
    anchor: HERO_TILE.TROBERT,
    leash: 6,
    prefer: ['help me get scarface pete', 'volunteer to undertake']
};

export const ALFONSE: NpcStop = {
    npc: 'Alfonse the waiter',
    anchor: HERO_TILE.ALFONSE,
    leash: 8,
    prefer: ['do you sell gherkins']
};

export const CHARLIE: NpcStop = {
    npc: 'Charlie the cook',
    anchor: HERO_TILE.CHARLIE,
    leash: 6,
    prefer: ['looking for a gherkin', 'want to steal scarface pete']
};

export const VELRAK: NpcStop = {
    npc: 'Velrak the explorer',
    anchor: HERO_TILE.VELRAK,
    leash: 4,
    prefer: ['know anywhere good to explore', 'yes please']
};

export const GERRANT: NpcStop = {
    npc: 'Gerrant',
    anchor: HERO_TILE.GERRANT,
    leash: 8,
    prefer: ['how to catch a lava eel']
};

/** Grubor's password, and the cabinet answer that walks Grip to the arrow slit. */
export const HERO_SAY = {
    BLACK_ARM_PASSWORD: 'four leaved clover',
    GRIP_DUTIES: 'what do my duties involve',
    GRIP_TASK: 'anything i can do now',
    // Why: `grip_chat_options` recurses after every option but the last, so the leg needs a way out.
    GRIP_LEAVE: 'better sort my new room out',
    CABINET_PEEK: 'notice me having a quick look'
} as const;

export const GRIP: NpcStop = {
    npc: 'Grip',
    anchor: HERO_TILE.GRIP,
    leash: 6,
    prefer: [HERO_SAY.GRIP_DUTIES, HERO_SAY.GRIP_TASK, HERO_SAY.GRIP_LEAVE]
};

/** The Phoenix bot's snipe kit and the Black Arm bot's disguise, each from the shop that stocks it. */
export const HERO_SHOP = {
    LOWE: { npc: 'Lowe', anchor: HERO_TILE.LOWE },
    HORVIK: { npc: 'Horvik', anchor: HERO_TILE.HORVIK },
    VALAINE: { npc: 'Valaine', anchor: HERO_TILE.VALAINE },
    SCAVVO: { npc: 'Scavvo', anchor: HERO_TILE.SCAVVO },
    AEMAD: { npc: 'Aemad', anchor: new Tile(2613, 3294, 0) },
    LOUIE: { npc: 'Louie legs', anchor: HERO_TILE.LOUIE },
    GERRANT: { npc: 'Gerrant', anchor: HERO_TILE.GERRANT },
    JATIX: { npc: 'Jatix', anchor: HERO_TILE.JATIX }
} as const;

export const TAVERLEY_HOP_DOWN: LadderHop = {
    stand: HERO_TILE.TAVERLEY_LADDER,
    locName: 'Ladder',
    op: 'Climb-down',
    arrive: HERO_TILE.TAVERLEY_DUNGEON
};

export const TAVERLEY_HOP_UP: LadderHop = {
    stand: HERO_TILE.TAVERLEY_DUNGEON,
    locName: 'Ladder',
    op: 'Climb-up',
    arrive: HERO_TILE.TAVERLEY_LADDER
};

export const WWM_HOP_DOWN: LadderHop = {
    stand: HERO_TILE.WWM_LADDER,
    locName: 'Ladder',
    op: 'Climb-down',
    arrive: HERO_TILE.WWM_DUNGEON
};

export const WWM_HOP_UP: LadderHop = {
    stand: HERO_TILE.WWM_DUNGEON,
    locName: 'Ladder',
    op: 'Climb-up',
    arrive: HERO_TILE.WWM_LADDER
};

export const HERO_HOPS: readonly LadderHop[] = [TAVERLEY_HOP_DOWN, TAVERLEY_HOP_UP, WWM_HOP_DOWN, WWM_HOP_UP];

function within(t: WorldTile | null | undefined, x0: number, x1: number, z0: number, z1: number, level: number): boolean {
    return !!t && t.level === level && t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1;
}

// Why: every box below is a flood of the collision pack, not a guess — the mansion is six sealed
// pockets and a distance test calls two tiles either side of one wall the same place.

/** The Shrimp and Parrot's kitchen, which only `herokitchendoor` opens. */
export function inKitchen(t: WorldTile | null | undefined): boolean {
    return within(t, 2787, 2799, 3190, 3192, 0);
}

/** Mr Olbors' garden, reached only by pushing the kitchen wall panel. */
export function inGarden(t: WorldTile | null | undefined): boolean {
    return within(t, 2783, 2788, 3188, 3199, 0) && !inKitchen(t);
}

/** The nine-tile yard between the garden door and the side door. */
export function inYard(t: WorldTile | null | undefined): boolean {
    return within(t, 2780, 2782, 3193, 3196, 0);
}

/** The five-tile side room, sealed from the mansion by the snipable wall. */
export function inSideRoom(t: WorldTile | null | undefined): boolean {
    return within(t, 2780, 2782, 3197, 3198, 0);
}

/** Past `pete_treasuredoor`, where the candlestick chest is. Seventeen tiles. */
export function inTreasureRoom(t: WorldTile | null | undefined): boolean {
    return within(t, 2764, 2769, 3196, 3199, 0);
}

/** The eight-tile store the treasure room's ordinary door opens onto; nothing in the quest needs it. */
export function inStoreCorridor(t: WorldTile | null | undefined): boolean {
    return within(t, 2770, 2772, 3196, 3198, 0);
}

/** The mansion's west wing, past the ordinary door at (2767,3194) and outside `pete_treasuredoor`. */
export function inWestWing(t: WorldTile | null | undefined): boolean {
    return within(t, 2759, 2766, 3188, 3199, 0) && !inTreasureRoom(t);
}

/** Everything `garvdoor` seals: the hall Grip patrols and the west wing behind it. */
export function inMansion(t: WorldTile | null | undefined): boolean {
    if (inTreasureRoom(t) || inStoreCorridor(t)) {
        return false;
    }
    return within(t, 2767, 2779, 3188, 3199, 0) || inWestWing(t);
}

// Why: the hideout and the alley interleave along z 3167-3170, so one rectangle over the pair puts
// Grubor's own doorstep inside the hideout and every crossing then reads as already done.

/** The Brimhaven Black Arm hideout, past Grubor's door. Sixty-nine tiles. */
export function inBrimhavenHq(t: WorldTile | null | undefined): boolean {
    return within(t, 2811, 2815, 3167, 3178, 0) || within(t, 2805, 2810, 3171, 3178, 0);
}

export function inTaverleyDungeon(t: WorldTile | null | undefined): boolean {
    return within(t, 2820, 2950, 9600, 9900, 0);
}

/** Velrak's cell, past `dungeonjail`. Thirty-three tiles. */
export function inVelrakCell(t: WorldTile | null | undefined): boolean {
    return within(t, 2928, 2934, 9683, 9689, 0);
}

// Why: the deep dungeon and the rest of Taverley's interleave across x 2881-2923, so these four boxes
// cover the flood instead: all 2473 pocket tiles inside one, no tile of the main component.

/** Past the dusty-key gate, where the lava eels are fished. */
export function inDeepDungeon(t: WorldTile | null | undefined): boolean {
    return within(t, 2817, 2880, 9761, 9854, 0)
        || within(t, 2817, 2914, 9761, 9793, 0)
        || within(t, 2888, 2923, 9769, 9816, 0)
        || within(t, 2881, 2882, 9802, 9808, 0);
}

export function inWwmDungeon(t: WorldTile | null | undefined): boolean {
    return within(t, 2810, 2890, 9900, 9990, 0);
}

export function onEntrana(t: WorldTile | null | undefined): boolean {
    return within(t, 2800, 2870, 3330, 3400, 0);
}
