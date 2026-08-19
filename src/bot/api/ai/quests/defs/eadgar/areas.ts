import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot } from '../../engine/types.js';
import type { NpcStop } from '../../exec/primitives.js';
import { trollZone } from '../trollstronghold/areas.js';

export interface EadgarItem {
    id: number;
    name: string;
}

// Why: every unfinished potion in the game displays as "Unfinished potion", so the ranarr
// vial is only ever addressed by id — a name-keyed withdraw pulls whichever unf the bank sorted first.
export const ER_ITEM = {
    COINS: { id: 995, name: 'Coins' },
    CLIMBING_BOOTS: { id: 3105, name: 'Climbing boots' },
    KNIFE: { id: 946, name: 'Knife' },
    AXE: { id: 1349, name: 'Iron axe' },
    TINDERBOX: { id: 590, name: 'Tinderbox' },
    PESTLE: { id: 233, name: 'Pestle and mortar' },
    LOGS: { id: 1511, name: 'Logs' },
    RAW_CHICKEN: { id: 2138, name: 'Raw chicken' },
    GRAIN: { id: 1947, name: 'Grain' },
    PINEAPPLE: { id: 2114, name: 'Pineapple' },
    PINEAPPLE_CHUNKS: { id: 2116, name: 'Pineapple chunks' },
    VODKA: { id: 2015, name: 'Vodka' },
    ALCO_CHUNKS: { id: 3270, name: 'Alco-chunks' },
    DRUNK_PARROT: { id: 3266, name: 'Drunk parrot' },
    DIRTY_ROBE: { id: 3267, name: 'Dirty robe' },
    FAKE_MAN: { id: 3268, name: 'Fake man' },
    BURNT_MEAT: { id: 2146, name: 'Burnt meat' },
    STOREROOM_KEY: { id: 3269, name: 'Storeroom key' },
    GOUTWEED: { id: 3261, name: 'Goutweed' },
    THISTLE: { id: 3262, name: 'Troll thistle' },
    DRIED_THISTLE: { id: 3263, name: 'Dried thistle' },
    GROUND_THISTLE: { id: 3264, name: 'Ground thistle' },
    TROLL_POTION: { id: 3265, name: 'Troll potion' },
    RANARR: { id: 257, name: 'Ranarr weed' },
    VIAL_WATER: { id: 227, name: 'Vial of water' },
    RANARR_VIAL: { id: 99, name: 'Unfinished potion' }
} as const satisfies Record<string, EadgarItem>;

/** Liquors `eadgar_zoo_keeper_aviary` accepts, cheapest stock first. */
export const LIQUORS: readonly EadgarItem[] = [
    ER_ITEM.VODKA,
    { id: 2019, name: 'Gin' },
    { id: 2021, name: 'Brandy' },
    { id: 2017, name: 'Whisky' }
];

export const ER_LOC = {
    AVIARY_HATCH: 4043,
    RACK: 3821,
    KITCHEN_DRAWERS: 3816,
    KITCHEN_DRAWERS_OPEN: 3817,
    STOREROOM_DOOR: 3810,
    GOUTWEED_CRATE: 3822,
    CAVE_ENTRANCE: 3759,
    CAVE_EXIT: 3760
} as const;

export const ER_NPC = {
    SANFEW: 'Sanfew',
    EADGAR: 'Eadgar',
    BURNTMEAT: 'Burntmeat',
    TEGID: 'Tegid',
    PETE: 'Parroty Pete',
    THISTLE: 'Thistle',
    CHICKEN: 'Chicken'
} as const;

/** `chicken` npc id — "Chicken" also names the cooked food. */
export const CHICKEN_NPC_ID = 41;

export const ER_TILE = {
    /** Falador West — the nearest bank to Taverley, Burthorpe and Trollheim. */
    FALADOR_BANK: new Tile(2946, 3369, 0),
    /** Ardougne north bank, beside the zoo, the wheat field and the trees. */
    ARDOUGNE_BANK: new Tile(2616, 3332, 0),
    SANFEW: new Tile(2897, 3426, 1),
    JATIX: new Tile(2899, 3427, 0),
    TEGID: new Tile(2913, 3417, 0),
    TENZING: new Tile(2820, 3556, 0),
    CAVE_MOUTH: new Tile(2893, 3671, 0),
    CAVE_INSIDE: new Tile(2893, 10074, 2),
    EADGAR: new Tile(2890, 10086, 2),
    BURNTMEAT: new Tile(2844, 10057, 1),
    /** Kitchen floor south of both `eadgar_kitchen_drawers`; the drawer tiles themselves block. */
    KITCHEN_DRAWERS: new Tile(2853, 10051, 1),
    RACK: new Tile(2828, 10095, 0),
    STOREROOM_DOOR_OUT: new Tile(2869, 10084, 0),
    STOREROOM_DOOR_IN: new Tile(2869, 10085, 0),
    GOUTWEED_CRATE: new Tile(2856, 10075, 0),
    PETE: new Tile(2611, 3285, 0),
    /** West of the hatch: the loc is a wall on the west edge of (2611,3287), which is not walkable. */
    AVIARY_HATCH: new Tile(2610, 3287, 0),
    AEMAD: new Tile(2613, 3294, 0),
    HECKEL: new Tile(2493, 3488, 1),
    /** Gulluck's axe counter, one ladder above Heckel Funch's groceries. */
    GULLUCK: new Tile(2468, 3487, 2),
    /** Burthorpe Supplies, the only tinderbox counter on the Trollheim side. */
    WISTAN: new Tile(2928, 3546, 0),
    CHICKENS: new Tile(2691, 3273, 0),
    WHEAT: new Tile(2647, 3348, 0),
    // Why: logs are wanted twice, once beside the chickens and the wheat and once beside the
    // Trollheim bank, and a single anchor makes one of the two a five-hundred-tile detour.

    /** The Ardougne lakeside trees, between the zoo and the bank. */
    TREES: new Tile(2605, 3320, 0),
    /** The trees east of Falador, twenty tiles from the bank this quest climbs out of. */
    TREES_FALADOR: new Tile(2920, 3368, 0)
} as const;

/** The five tiles the Thistle npc hops between (`eadgar_troll_thistle_move`). */
export const THISTLE_SPOTS: readonly Tile[] = [
    new Tile(2883, 3670, 0),
    new Tile(2887, 3675, 0),
    new Tile(2891, 3676, 0),
    new Tile(2892, 3686, 0),
    new Tile(2902, 3674, 0)
];

export const SANFEW_START: NpcStop = {
    npc: ER_NPC.SANFEW,
    anchor: ER_TILE.SANFEW,
    leash: 8,
    prefer: ['Have you any more work for me', "I'll do it."]
};

export const SANFEW_FINISH: NpcStop = {
    npc: ER_NPC.SANFEW,
    anchor: ER_TILE.SANFEW,
    leash: 8,
    prefer: ['I have some more goutweed for you.', "Actually I don't need to speak to you."]
};

// Why: one stop covers every Eadgar visit — the option he offers is a function of the stage, and
// no two stages offer two of these at once, so a single ordered list never picks the wrong branch.
export const EADGAR_TALK: NpcStop = {
    npc: ER_NPC.EADGAR,
    anchor: ER_TILE.EADGAR,
    leash: 10,
    prefer: [
        'I need to find some goutweed.',
        "Okay, I'll be right back.",
        'No thanks, Eadgar.',
        'More'
    ]
};

export const BURNTMEAT_TALK: NpcStop = {
    npc: ER_NPC.BURNTMEAT,
    anchor: ER_TILE.BURNTMEAT,
    leash: 8,
    prefer: ['So, where can I get some goutweed?', "I'll be going now."]
};

// Why: "Fine." ends the dialogue with no robe; both of the other two hand one over.
export const TEGID_ROBE: NpcStop = {
    npc: ER_NPC.TEGID,
    anchor: ER_TILE.TEGID,
    leash: 6,
    prefer: ["Sanfew won't be happy", "You'll give me those robes right now"]
};

// Why: `make_alco_chunks` needs both of Pete's varbits set, and each `opnpc1` offers only one
// of the three lines, so the two that matter are two separate visits.
export const PETE_WHEN: NpcStop = {
    npc: ER_NPC.PETE,
    anchor: ER_TILE.PETE,
    leash: 8,
    prefer: ['When did you add it?']
};

export const PETE_FEED: NpcStop = {
    npc: ER_NPC.PETE,
    anchor: ER_TILE.PETE,
    leash: 8,
    prefer: ['What do you feed them?']
};

/** Where the character is, in the terms `decide()` cares about. */
export type EadgarZone = 'cave' | 'stronghold' | 'trollside' | 'mainland' | 'unknown';

export function eadgarZone(tile: QuestSnapshot['tile']): EadgarZone {
    if (!tile) {
        return 'unknown';
    }
    const { x, z, level } = tile;
    // Mad Eadgar's cave: mapsquare 45,157 on the level the freed-Eadgar teleport lands on.
    if (level === 2 && x >= 2880 && x <= 2943 && z >= 10048 && z <= 10111) {
        return 'cave';
    }
    const troll = trollZone(tile);
    if (troll === 'stronghold') {
        return 'stronghold';
    }
    if (troll === 'mainland' || troll === 'unknown') {
        return 'mainland';
    }
    return 'trollside';
}

/** True once the character is past the stile: no more cheap bank trips. */
export function committed(zone: EadgarZone): boolean {
    return zone !== 'mainland' && zone !== 'unknown';
}

// Why: `nearest` ranks banks by straight line, and the cave and the stronghold sit at z ≈ 10 000, where every surface bank is six thousand tiles away and the ordering is noise — one run walked past Falador and out towards Varrock.
// Why: on that side of the map there is one answer, so the bank is pinned rather than ranked.

/** The bank a leg should open: pinned above the stile, nearest anywhere else. */
export function questBank(snap: QuestSnapshot): Tile | undefined {
    return committed(eadgarZone(snap.tile)) ? ER_TILE.FALADOR_BANK : undefined;
}

export function held(snap: QuestSnapshot, item: EadgarItem): number {
    return snap.invIds?.get(item.id) ?? 0;
}

export function banked(snap: QuestSnapshot, item: EadgarItem): number {
    return snap.bankIds?.get(item.id) ?? 0;
}

export function owned(snap: QuestSnapshot, item: EadgarItem): number {
    return held(snap, item) + banked(snap, item);
}

export function worn(snap: QuestSnapshot, item: EadgarItem): boolean {
    return snap.wornIds?.has(item.id) ?? false;
}
