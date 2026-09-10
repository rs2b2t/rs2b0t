import Tile from '../../geometry/Tile.js';
import { inBox, type AreaPoint, type DragonSite } from '../JiveDragons/sites.js';

export interface LocStop {
    tile: Tile;
    /** How far from the tile the op may be sent: 0 stands on it, 1 beside it. */
    radius: number;
    locId: number;
    op: string;
}

/** The way into the lair and the way back out on foot. */
export interface LairRoute {
    ladder: LocStop;
    dungeonArrival: Tile;
    lever: LocStop;
    lairArrival: Tile;
    outLever: LocStop;
    dungeonReturn: Tile;
    upLadder: LocStop;
    surface: Tile;
    inDungeon(t: AreaPoint | null): boolean;
}

const EDGEVILLE_BANK = new Tile(3094, 3493, 0);

// Why: the alcove is walled on the south and open only north, and no five-wide footprint fits on the row beside it, so the dragon reaches row 9803 and never adjacency. The derivation's one other melee-proof tile, (2714, 9830), sits by the ice spiders and is left out.
// Why: the dragon breathes at anything it can see within 15 tiles, capped at 15 by the shield, so rangedThreat keeps the ladder from reading each breath as a bad tile.

export const KBD_LAIR: DragonSite = {
    key: 'kbd-lair',
    label: 'King Black Dragon lair',
    target: 'King black dragon',
    bones: 'Dragon bones',
    keyItem: null,
    gate: null,
    approach: [],
    safespots: [new Tile(2717, 9801, 0), new Tile(2716, 9801, 0)],
    meleeAnchor: new Tile(2714, 9829, 0),
    bank: EDGEVILLE_BANK,
    escapeTeleportId: 'varrock',
    walkOut: EDGEVILLE_BANK,
    rangedThreat: true,
    inArea: inBox({ minX: 2688, maxX: 2751, minZ: 9792, maxZ: 9855, level: 0 })
};

// Why: both levers are straight wall decorations, which the server only lets a player use from the tile they sit on; each teleport lands you on the tile north of the other lever.

export const KBD_ROUTE: LairRoute = {
    ladder: { tile: new Tile(3017, 3849, 0), radius: 1, locId: 1765, op: 'Climb-down' },
    dungeonArrival: new Tile(3069, 10255, 0),
    lever: { tile: new Tile(3067, 10253, 0), radius: 0, locId: 1816, op: 'Pull' },
    lairArrival: new Tile(2717, 9802, 0),
    outLever: { tile: new Tile(2717, 9801, 0), radius: 0, locId: 1817, op: 'Pull' },
    dungeonReturn: new Tile(3067, 10254, 0),
    upLadder: { tile: new Tile(3069, 10256, 0), radius: 1, locId: 1766, op: 'Climb-up' },
    surface: new Tile(3016, 3849, 0),
    inDungeon: inBox({ minX: 3008, maxX: 3071, minZ: 10240, maxZ: 10303, level: 0 })
};

export const KBD_SITES: Record<string, DragonSite> = { [KBD_LAIR.key]: KBD_LAIR };

export const SITE_OPTIONS: string[] = Object.keys(KBD_SITES);

export function siteFor(key: string): DragonSite {
    return KBD_SITES[key] ?? KBD_LAIR;
}
