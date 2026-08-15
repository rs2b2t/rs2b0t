import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import Tile from '../../../../../geometry/Tile.js';
import type { LadderHop, NpcStop } from '../../exec/primitives.js';

export const SOA_NAME = 'Shield of Arrav';

/** Object ids. Broken shield, Key, Scroll and Certificate each name more than one object, so nothing here is matched by name. */
export const SOA_ID = {
    BOOK: 757,
    STORE_KEY: 759,
    REPORT: 761,
    SHIELD_PHOENIX: 763,
    SHIELD_BLACKARM: 765,
    CROSSBOW: 767,
    CERTIFICATE: 769,
    COINS: 995
} as const;

export const SOA_LOC = {
    PHOENIX_DOOR: 2397,
    STORE_DOOR: 2398,
    BLACKARM_DOOR: 2399,
    CUPBOARD_SHUT: 2400,
    CUPBOARD_OPEN: 2401,
    BOOKCASE: 2402,
    CHEST_SHUT: 2403,
    CHEST_OPEN: 2404,
    STREET_DOOR: 1530,
    CELLAR_LADDER: 1754,
    HQ_LADDER: 2405,
    STORE_LADDER: 1747,
    STORE_LADDER_TOP: 1746,
    BLACKARM_STAIRS: 1722,
    BLACKARM_STAIRS_TOP: 1723
} as const;

/** Every tile here is walkable in the collision pack; the six that were not are noted where the geometry forced the choice. */
export const SOA_TILE = {
    /** East of the bookcase: x 3211 and 3212 are a solid run of shelves from z 3491 to 3496. */
    BOOKCASE: new Tile(3213, 3493, 0),
    CELLAR_LADDER: new Tile(3244, 3384, 0),
    HQ_LADDER: new Tile(3244, 9784, 0),
    HQ_SURFACE: new Tile(3244, 3382, 0),
    PHOENIX_DOOR: new Tile(3247, 9780, 0),
    /** South of the door. Why: the door is the only crossing between the hideout's two components, and opening it teleports rather than steps. */
    PHOENIX_DOOR_INNER: new Tile(3247, 9778, 0),
    /** North of the chest, the side `forceapproach=north` leaves legal at angle 0. */
    CHEST_STAND: new Tile(3235, 9762, 0),
    STORE_DOOR: new Tile(3251, 3386, 0),
    /** Inside the store, beside the door — the only tile the outward Open can be clicked from. */
    STORE_DOOR_INNER: new Tile(3251, 3384, 0),
    STORE_LADDER: new Tile(3252, 3385, 0),
    STORE_LADDER_TOP: new Tile(3251, 3384, 1),
    CROSSBOW_WEST: new Tile(3243, 3383, 1),
    CROSSBOW_EAST: new Tile(3245, 3385, 1),
    STREET_DOOR: new Tile(3190, 3384, 0),
    /** Katrine's side of the gang door — the side an unjoined character is stuck on. */
    BLACKARM_DOOR: new Tile(3185, 3387, 0),
    /** The stairs side, past the gang door. */
    BLACKARM_DOOR_INNER: new Tile(3185, 3389, 0),
    BLACKARM_STAIRS: new Tile(3188, 3388, 0),
    BLACKARM_STAIRS_TOP: new Tile(3187, 3390, 1),
    /** West of the cupboard: `forceapproach=east` rotates with its angle 2 placement, so east is west in world space. */
    CUPBOARD_STAND: new Tile(3187, 3385, 1),
    JONNY: new Tile(3223, 3395, 0),
    RENDEZVOUS: new Tile(3253, 3420, 0)
} as const;

export const RELDO: NpcStop = {
    npc: 'Reldo',
    anchor: new Tile(3209, 3495, 0),
    leash: 8,
    prefer: ["I'm in search of a quest."]
};

export const BARAEK: NpcStop = {
    npc: 'Baraek',
    anchor: new Tile(3218, 3435, 0),
    leash: 8,
    prefer: ['Can you tell me where I can find the Phoenix Gang?', 'Okay. Have 20 gold coins.']
};

export const TRAMP: NpcStop = {
    npc: 'Tramp',
    anchor: new Tile(3208, 3391, 0),
    leash: 8,
    prefer: ['Is there anything down this alleyway?', 'Do you think they would let me join?']
};

export const STRAVEN_JOIN: NpcStop = {
    npc: 'Straven',
    anchor: new Tile(3246, 9780, 0),
    leash: 6,
    prefer: ['I know who you are!', "I'd like to offer you my services."]
};

export const STRAVEN_HANDIN: NpcStop = {
    npc: 'Straven',
    anchor: new Tile(3246, 9780, 0),
    leash: 6,
    prefer: []
};

export const KATRINE_JOIN: NpcStop = {
    npc: 'Katrine',
    anchor: new Tile(3186, 3385, 0),
    leash: 6,
    prefer: [
        "I've heard you're the Black Arm Gang.",
        "I'd rather not reveal my sources.",
        'I want to become a member of your gang.',
        "Well, you can give me a try can't you?",
        'Ok, no problem.'
    ]
};

export const KATRINE_HANDIN: NpcStop = {
    npc: 'Katrine',
    anchor: new Tile(3186, 3385, 0),
    leash: 6,
    prefer: []
};

export const CURATOR: NpcStop = {
    npc: 'Curator',
    anchor: new Tile(3255, 3446, 0),
    leash: 6,
    prefer: []
};

export const ROALD: NpcStop = {
    npc: 'King Roald',
    anchor: new Tile(3222, 3475, 0),
    leash: 8,
    prefer: []
};

// Why: `needsHop` compares z against 6400, so a LadderHop can only express a surface-to-underground move — the two upper floors are climbed inside their own legs.
export const HQ_HOP_DOWN: LadderHop = {
    stand: SOA_TILE.CELLAR_LADDER,
    locName: 'Ladder',
    op: 'Climb-down',
    arrive: SOA_TILE.HQ_LADDER
};

export const HQ_HOP_UP: LadderHop = {
    stand: SOA_TILE.HQ_LADDER,
    locName: 'Ladder',
    op: 'Climb-up',
    arrive: SOA_TILE.HQ_SURFACE
};

export const SOA_HOPS: readonly LadderHop[] = [HQ_HOP_DOWN, HQ_HOP_UP];

function within(t: WorldTile | null | undefined, x0: number, x1: number, z0: number, z1: number, level: number): boolean {
    return !!t && t.level === level && t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1;
}

/** The hideout is an underground band nothing walks into — the cellar ladder is the only way in or out. */
export function inPhoenixHq(t: WorldTile | null | undefined): boolean {
    return within(t, 3225, 3260, 9750, 9795, 0);
}

// Why: a flood over the pack puts the chest side at z 9761..9779 and the ladder side at 9780 up, so the split is clean.

/** The chest half of the hideout, past the gang door. */
export function inPhoenixInner(t: WorldTile | null | undefined): boolean {
    return within(t, 3233, 3254, 9761, 9779, 0);
}

export function inWeaponStore(t: WorldTile | null | undefined): boolean {
    return within(t, 3240, 3256, 3378, 3392, 1);
}

// Why: a flood over the pack puts this pocket at ten tiles, and `phoenixdoor2` is its only way in or out.
/** The weapon store's ground floor, which the store door seals. */
export function inStoreGround(t: WorldTile | null | undefined): boolean {
    return within(t, 3250, 3252, 3382, 3385, 0);
}

/** The stairs half of the Black Arm hideout, past the gang door. Katrine's room is z 3387 and below. */
export function inBlackArmInner(t: WorldTile | null | undefined): boolean {
    return within(t, 3182, 3189, 3388, 3398, 0);
}

export function inBlackArmUpper(t: WorldTile | null | undefined): boolean {
    return within(t, 3180, 3196, 3380, 3394, 1);
}
