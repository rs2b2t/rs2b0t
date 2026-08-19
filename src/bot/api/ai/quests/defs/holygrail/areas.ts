import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const GRAIL_NAME = 'Holy Grail';

// Why: names, not ids — every one of these is unique in the object table, and the quest never sees a collision.
export const ITEM = {
    NAPKIN: 'Holy table napkin',
    WHISTLE: 'Magic whistle',
    BELL: 'Grail bell',
    GRAIL: 'Holy grail',
    EXCALIBUR: 'Excalibur',
    COINS: 'Coins'
} as const;

/** merlin2, not the `merlin` that Merlin's Crystal frees — both render as "Merlin". */
export const MERLIN_ID = 213;
export const TITAN_ID = 221;
/** `whistledoor`; Draynor Manor's top floor has a second, ordinary Door two tiles away. */
export const WHISTLE_DOOR_ID = 22;

export const GRAIL_TILE = {
    /** Merlin's workshop, past the door the oploc spawns him behind. */
    MERLIN_WORKSHOP: new Tile(2767, 3500, 1),
    DRAYNOR_BANK: new Tile(3093, 3243, 0),
    // Why: the whistles land on furniture, so their own tile takes no step — only the tile due west of it does, and only a cardinal neighbour counts as adjacent.

    /** West of where `whistledoor` drops the whistles, on Draynor Manor's top floor. */
    WHISTLE_STAND: new Tile(3106, 3359, 2),
    /** Karamja's six stone heads: the only mainland tiles the whistle answers on. */
    SIX_HEADS: new Tile(2741, 3235, 0),
    REALM_ARRIVAL: new Tile(2806, 4715, 0),
    /** East of the titan, the one tile his crossing can be attacked from. */
    TITAN_STAND: new Tile(2792, 4722, 0),
    /** West of the titan, where `defeat_titan` p_teleports the winner. */
    TITAN_WEST: new Tile(2790, 4722, 0),
    BELL_SPAWN: new Tile(2762, 4694, 0),
    /** Outside the castle wall and three tiles from the maidens' spawns. */
    RING_STAND: new Tile(2763, 4693, 0),
    CASTLE_LANDING: new Tile(2761, 4692, 0),
    /** West of the castle's 2x2 spiral staircase. */
    CASTLE_STAIR: new Tile(2760, 4680, 0),
    /** East of the diagonal door into the Fisher King's hall. */
    FISHER_KING_DOOR: new Tile(2767, 4688, 1),
    FISHER_KING: new Tile(2762, 4688, 1),
    GOBLIN_SACKS: new Tile(2960, 3507, 0),
    // Why: Percival is added to the sacks' south-west, so the east side is the one that stays clear.
    /** East of the Goblin Village sacks. */
    SACKS_STAND: new Tile(2961, 3507, 0),
    RENEWED_ARRIVAL: new Tile(2678, 4715, 0),
    /** South of the round table the Grail rests on; the table's own tile is sealed. */
    GRAIL_STAND: new Tile(2649, 4683, 2),
    GRAIL_TABLE: new Tile(2649, 4684, 2)
} as const;

export const KING_ARTHUR_START: NpcStop = {
    npc: 'King Arthur',
    anchor: new Tile(2764, 3515, 0),
    leash: 8,
    prefer: ['Now I am a knight of the round table', 'Tell me of this quest.', "I'd enjoy trying that."]
};

export const KING_ARTHUR_FINISH: NpcStop = {
    npc: 'King Arthur',
    anchor: new Tile(2764, 3515, 0),
    leash: 8,
    prefer: []
};

export const MERLIN: NpcStop = {
    npc: 'Merlin',
    anchor: GRAIL_TILE.MERLIN_WORKSHOP,
    leash: 6,
    prefer: ['Thank you for the advice.']
};

export const HIGH_PRIEST: NpcStop = {
    npc: 'High Priest',
    anchor: new Tile(2851, 3349, 0),
    leash: 8,
    prefer: ['Ok, I will go searching.']
};

export const GALAHAD: NpcStop = {
    npc: 'Galahad',
    anchor: new Tile(2612, 3474, 0),
    leash: 8,
    prefer: [
        'I seek an item from the realm of the Fisher King.',
        'I have lost the holy table napkin',
        'Well, I\'d better be going then.',
        'Do you get lonely out here on your own?'
    ]
};

export const FISHERMAN: NpcStop = {
    npc: 'Fisherman',
    anchor: new Tile(2802, 4706, 0),
    leash: 8,
    prefer: ['Any idea how to get into the castle?']
};

export const FISHER_KING: NpcStop = {
    npc: 'The Fisher King',
    anchor: GRAIL_TILE.FISHER_KING,
    leash: 10,
    prefer: ["You don't look too well."]
};

export const SIR_PERCIVAL: NpcStop = {
    npc: 'Sir Percival',
    anchor: GRAIL_TILE.SACKS_STAND,
    leash: 8,
    prefer: ['Your father wishes to speak to you.', 'Come with me, I shall make you a king.']
};

export const LADY_OF_THE_LAKE: NpcStop = {
    npc: 'The Lady of the Lake',
    anchor: new Tile(2924, 3405, 0),
    leash: 6,
    prefer: ['I seek the sword Excalibur.']
};

function within(t: WorldTile | null | undefined, x0: number, x1: number, z0: number, z1: number): boolean {
    return !!t && t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1;
}

/** The blighted Realm of the Fisher King — mapsquare 43×73, every level. */
export function inBlightedRealm(t: WorldTile | null | undefined): boolean {
    return within(t, 2752, 2815, 4672, 4735);
}

/** The renewed realm the whistle lands in once Percival has been sent home. */
export function inRenewedRealm(t: WorldTile | null | undefined): boolean {
    return within(t, 2624, 2687, 4672, 4735);
}

export function inFisherRealm(t: WorldTile | null | undefined): boolean {
    return inBlightedRealm(t) || inRenewedRealm(t);
}

// Why: the barricades and the blocked column at x 2791 split the blighted realm in two, and the titan's tile is the only join — so which side we are on decides whether there is a fight left to have.
// Why: a rectangle cannot express it, as the pocket's west edge steps east as z falls; these bands sit in the gap between the two components on every row.

/** True on the whistle's landing side of the titan, where the crossing is still unpaid. */
export function eastOfTitan(t: WorldTile | null | undefined): boolean {
    if (!t || t.level !== 0 || !inBlightedRealm(t) || t.z < 4709) {
        return false;
    }
    if (t.z >= 4728) { return t.x >= 2786; }
    if (t.z >= 4713) { return t.x >= 2791; }
    if (t.z >= 4712) { return t.x >= 2794; }
    if (t.z >= 4711) { return t.x >= 2795; }
    if (t.z >= 4710) { return t.x >= 2797; }
    return t.x >= 2800;
}

// Why: the castle's floor plan interleaves with the ground outside it, so no rectangle separates them — but the outside has no upper floor at all.

/** True on a Grail castle floor above the ground, which only the bell reaches. */
export function inCastleUpstairs(t: WorldTile | null | undefined): boolean {
    return inBlightedRealm(t) && (t?.level ?? 0) >= 1;
}
