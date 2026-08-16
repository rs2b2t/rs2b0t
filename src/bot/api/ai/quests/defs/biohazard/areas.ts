import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot } from '../../engine/types.js';

export interface BioItem {
    id: number;
    name: string;
}

// Why: both priest halves render "Priest gown", both cages render "Pigeon cage" and the
// mourner key renders "Key", so every lookup in this quest goes through the object id.
export const BIO_ITEM = {
    COINS: { id: 995, name: 'Coins' },
    ETHENEA: { id: 415, name: 'Ethanea' },
    LIQUID_HONEY: { id: 416, name: 'Liquid honey' },
    SULPHURIC_BROLINE: { id: 417, name: 'Sulphuric broline' },
    PLAGUE_SAMPLE: { id: 418, name: 'Plague sample' },
    TOUCH_PAPER: { id: 419, name: 'Touch paper' },
    DISTILLATOR: { id: 420, name: 'Distillator' },
    BIRDFEED: { id: 422, name: 'Bird feed' },
    MOURNER_KEY: { id: 423, name: 'Key' },
    PIGEONS: { id: 424, name: 'Pigeon cage' },
    EMPTY_CAGE: { id: 425, name: 'Pigeon cage' },
    PRIEST_GOWN: { id: 426, name: 'Priest gown' },
    PRIEST_ROBE: { id: 428, name: 'Priest gown' },
    DOCTOR_GOWN: { id: 430, name: "Doctors' gown" },
    ROTTEN_APPLES: { id: 1984, name: 'Rotten apples' }
} as const satisfies Record<string, BioItem>;

/** The three reagents Guidor needs, in the order the errand-boy leg hands them over. */
export const VIALS: readonly BioItem[] = [
    BIO_ITEM.SULPHURIC_BROLINE,
    BIO_ITEM.ETHENEA,
    BIO_ITEM.LIQUID_HONEY
];

export const BIO_NPC = {
    ELENA: 'Elena',
    JERICO: 'Jerico',
    OMART: 'Omart',
    KILRON: 'Kilron',
    MOURNER: 'Mourner',
    CHEMIST: 'Chemist',
    HOPS: 'Hops',
    DEVINCI: 'DeVinci',
    CHANCY: 'Chancy',
    THESSALIA: 'Thessalia',
    GUIDOR: 'Guidor',
    LATHAS: 'King Lathas'
} as const;

export const BIO_LOC = {
    JERICO_CUPBOARD_SHUT: 2056,
    JERICO_CUPBOARD_OPEN: 2057,
    WATCHTOWER: 2067,
    CAULDRON: 2043,
    NURSE_CUPBOARD_SHUT: 2062,
    NURSE_CUPBOARD_OPEN: 2063,
    HQ_DOOR: 2036,
    HQ_CRATE: 2064,
    GUIDOR_DOOR: 2032,
    /** The two leaves of the Varrock east gate, where the guard searches for vials. */
    VARROCK_GATE: [2050, 2051] as readonly number[]
} as const;

// Why: `mournerstew2` upstairs shares its display name with every other Mourner in the
// city, and only that one drops the key.
export const SICK_MOURNER_ID = 370;

export const BIO_TILE = {
    ARDOUGNE_BANK: new Tile(2616, 3332, 0),
    ELENA: new Tile(2592, 3336, 0),
    JERICO: new Tile(2612, 3324, 0),
    // Why: `forceapproach=east` rotates with the placement's angle of 1, so the only side the
    // cupboard may be used from is its south face — the east tile is the cupboard's own second half.
    JERICO_CUPBOARD: new Tile(2611, 3325, 0),
    PIGEON_SPAWN: new Tile(2618, 3324, 0),
    // Why: the tower's east wall is x 2563, and this stand is also inside the pigeon-release box.
    WATCHTOWER: new Tile(2564, 3303, 0),
    OMART: new Tile(2559, 3266, 0),
    KILRON: new Tile(2556, 3266, 0),
    LADDER_WEST: new Tile(2556, 3267, 0),
    LADDER_EAST: new Tile(2559, 3267, 0),
    ROTTEN_APPLES: new Tile(2535, 3333, 0),
    CAULDRON: new Tile(2542, 3332, 0),
    NURSE_CUPBOARD: new Tile(2518, 3275, 0),
    // Why: a wall door's gated side is the door's own tile, so this is outside the building
    // and HQ_INSIDE is the tile the crossing lands on.
    HQ_DOOR: new Tile(2551, 3320, 0),
    HQ_INSIDE: new Tile(2551, 3321, 0),
    // Why: the sick mourners stand on the near side of the gate, so this leg needs no key.
    HQ_UPSTAIRS: new Tile(2550, 3326, 1),
    HQ_CRATE: new Tile(2554, 3326, 1),
    LATHAS: new Tile(2578, 3293, 1),
    CHEMIST: new Tile(2934, 3211, 0),
    HOPS: new Tile(2931, 3219, 0),
    DEVINCI: new Tile(2933, 3219, 0),
    CHANCY: new Tile(2935, 3219, 0),
    THESSALIA: new Tile(3204, 3417, 0),
    // Why: the gate's two leaves are walls on the west edges of 3264,3405 and 3264,3406, and the
    // route from Varrock crosses the northern one — these are the tiles either side of it.
    GATE_OUTSIDE: new Tile(3263, 3406, 0),
    GATE_INSIDE: new Tile(3265, 3406, 0),
    DANCING_DONKEY: new Tile(3270, 3390, 0),
    GUIDOR_DOOR: new Tile(3282, 3382, 0),
    GUIDOR: new Tile(3285, 3381, 0),
    VARROCK_BANK: new Tile(3253, 3420, 0),
    SEWER_MUD_PILE: new Tile(2561, 9737, 0),
    MANHOLE: new Tile(2529, 3303, 0)
} as const;

// Why: `opheld1,pigeons` only releases them inside this box, and the journal gives no
// second chance — outside it the cage says the pigeons do not want to leave.
export const PIGEON_ZONE = { x0: 2559, x1: 2565, z0: 3299, z1: 3307 } as const;

export type BioArea = 'mainland' | 'west' | 'hq' | 'hqUpstairs' | 'castleUpstairs' | 'sewer' | 'unknown';

// Why: `mournerstewdoor` is SCRIPT_REFUSED, so the headquarters building and its first floor are a
// sealed pocket the navigator has no route into — every branch has to know which side of it we are on.
export function bioArea(tile: QuestSnapshot['tile']): BioArea {
    if (!tile) {
        return 'unknown';
    }
    const { x, z, level } = tile;
    if (x >= 2490 && x <= 2600 && z >= 9690 && z <= 9770) {
        return 'sewer';
    }
    if (level === 1 && x >= 2540 && x <= 2557 && z >= 3320 && z <= 3330) {
        return 'hqUpstairs';
    }
    if (level === 1 && x >= 2565 && x <= 2590 && z >= 3283 && z <= 3310) {
        return 'castleUpstairs';
    }
    if (level === 0 && x >= 2542 && x <= 2555 && z >= 3321 && z <= 3327) {
        return 'hq';
    }
    if (level === 0 && x >= 2433 && x <= 2556 && z >= 3266 && z <= 3334) {
        return 'west';
    }
    return level === 0 ? 'mainland' : 'unknown';
}

// Why: the Varrock east gate searches in both directions between given_distillator and found_secret, so the vials may only ever be carried inside this quarter — which is also the only place they are needed, as Guidor and the inn are both in it.
export function inGuidorQuarter(tile: QuestSnapshot['tile']): boolean {
    if (!tile || tile.level !== 0) {
        return false;
    }
    return tile.x >= 3264 && tile.x <= 3287 && tile.z >= 3376 && tile.z <= 3407;
}

export function inPigeonZone(tile: QuestSnapshot['tile']): boolean {
    if (!tile || tile.level !== 0) {
        return false;
    }
    return tile.x >= PIGEON_ZONE.x0 && tile.x <= PIGEON_ZONE.x1
        && tile.z >= PIGEON_ZONE.z0 && tile.z <= PIGEON_ZONE.z1;
}

export function held(snap: QuestSnapshot, item: BioItem): number {
    return snap.invIds?.get(item.id) ?? 0;
}

export function banked(snap: QuestSnapshot, item: BioItem): number {
    return snap.bankIds?.get(item.id) ?? 0;
}

export function worn(snap: QuestSnapshot, item: BioItem): boolean {
    return snap.wornIds?.has(item.id) ?? false;
}

/** What `obj_gettotal` counts: pack plus bank plus what is worn. */
export function owned(snap: QuestSnapshot, item: BioItem): number {
    return held(snap, item) + banked(snap, item) + (worn(snap, item) ? 1 : 0);
}
