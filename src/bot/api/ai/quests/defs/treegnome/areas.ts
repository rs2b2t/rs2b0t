import Tile from '../../../../../geometry/Tile.js';
import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import type { QuestSnapshot } from '../../engine/types.js';

export interface TgItem {
    id: number;
    name: string;
}

// Why: `orb_of_protection` and `orbs_of_protection` both display "Orb of protection", and only the plural finishes the quest.
// Why: three objs display "Logs", and `commander_montai` deletes obj 1511 alone.
export const TG_ITEM = {
    COINS: { id: 995, name: 'Coins' },
    LOGS: { id: 1511, name: 'Logs' },
    ORB: { id: 587, name: 'Orb of protection' },
    ORBS: { id: 588, name: 'Orb of protection' },
    AMULET: { id: 589, name: 'Gnome amulet' }
} as const satisfies Record<string, TgItem>;

export const TG_NPC = {
    BOLREN: 'King Bolren',
    MONTAI: 'Commander Montai',
    ELKOY: 'Elkoy',
    WARLORD: 'Khazard warlord',
    COMMANDER: 'Khazard commander',
    AEMAD: 'Aemad'
} as const;

export const TG_LOC = {
    BALLISTA: 2181,
    CHEST_SHUT: 2183,
    CHEST_OPEN: 2182,
    FRONT_DOOR: 2184,
    CRUMBLED_WALL: 2185,
    INNER_DOOR: 1530,
    LADDER_UP: 1747,
    LADDER_DOWN: 1746
} as const;

export const TG_TILE = {
    BANK: new Tile(2655, 3283, 0),
    BOLREN: new Tile(2542, 3170, 0),
    MONTAI: new Tile(2523, 3211, 0),
    TREES: new Tile(2521, 3201, 0),
    AXE_SHOP: new Tile(2613, 3294, 0),
    BALLISTA_STAND: new Tile(2511, 3211, 0),
    WALL_STAND: new Tile(2509, 3252, 0),
    HALL_LANDING: new Tile(2509, 3255, 0),
    INNER_DOOR_STAND: new Tile(2506, 3256, 0),
    LADDER_STAND: new Tile(2503, 3253, 0),
    CHEST_STAND: new Tile(2506, 3258, 1),
    FRONT_DOOR_STAND: new Tile(2502, 3251, 0),
    OUTSIDE_FRONT_DOOR: new Tile(2502, 3250, 0),
    WARLORD: new Tile(2457, 3302, 0)
} as const;

export const LOGS_WANTED = 6;

type Rows = Readonly<Record<number, readonly [number, number]>>;

// Why: the crumbled wall drops into the east hall and the ladder sits in the west room, and the two share x and z ranges, so a box over both would answer for the wrong side.
const HALL_ROWS: Rows = {
    3254: [2508, 2511],
    3255: [2507, 2512],
    3256: [2506, 2512],
    3257: [2500, 2511],
    3258: [2502, 2512],
    3259: [2503, 2511]
};

const LADDER_ROOM_ROWS: Rows = {
    3251: [2501, 2503],
    3252: [2500, 2504],
    3253: [2500, 2505],
    3254: [2500, 2506],
    3255: [2500, 2506],
    3256: [2500, 2504]
};

function inRows(tile: WorldTile, rows: Rows): boolean {
    const span = rows[tile.z];
    return tile.level === 0 && span !== undefined && tile.x >= span[0] && tile.x <= span[1];
}

/** The hall behind the crumbled wall: the only way on is the inner door. */
export function inKhazardHall(tile: WorldTile | null | undefined): boolean {
    return tile !== null && tile !== undefined && inRows(tile, HALL_ROWS);
}

/** The west room, which holds the ladder up and the front door out. */
export function inLadderRoom(tile: WorldTile | null | undefined): boolean {
    return tile !== null && tile !== undefined && inRows(tile, LADDER_ROOM_ROWS);
}

/** The stronghold's first floor, where the chest is. */
export function inChestFloor(tile: WorldTile | null | undefined): boolean {
    return tile !== null && tile !== undefined
        && tile.level === 1 && tile.x >= 2499 && tile.x <= 2507 && tile.z >= 3250 && tile.z <= 3260;
}

export function inStronghold(tile: WorldTile | null | undefined): boolean {
    return inKhazardHall(tile) || inLadderRoom(tile) || inChestFloor(tile);
}

export function held(snap: QuestSnapshot, item: TgItem): number {
    return snap.invIds?.get(item.id) ?? 0;
}

export function banked(snap: QuestSnapshot, item: TgItem): number {
    return snap.bankIds?.get(item.id) ?? 0;
}

export function owned(snap: QuestSnapshot, item: TgItem): number {
    return held(snap, item) + banked(snap, item);
}
