import Tile from '../../geometry/Tile.js';

export interface AreaPoint {
    x: number;
    z: number;
    level: number;
}

export interface DragonGate {
    locId: number;
    op: string;
    /** Where the key is used from. */
    outside: Tile;
    /** Where the gate lands you. */
    inside: Tile;
}

export interface DragonSite {
    key: string;
    label: string;
    target: string;
    bones: string;
    keyItem: { name: string; id: number } | null;
    gate: DragonGate | null;
    approach: Tile[];
    safespots: Tile[];
    meleeAnchor: Tile;
    bank: Tile;
    /** A teleportId from webwalk/teleportCatalog.ts, never a copied rune list. */
    escapeTeleportId: string;
    /** Walk-out target when the teleport will not fire. */
    walkOut: Tile;
    inArea(t: AreaPoint | null): boolean;
}

interface Box {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    level: number;
}

const inBox = (b: Box) => (t: AreaPoint | null): boolean =>
    t !== null && t.level === b.level
    && t.x >= b.minX && t.x <= b.maxX
    && t.z >= b.minZ && t.z <= b.maxZ;

export const TAVERLEY_BLUE: DragonSite = {
    key: 'taverley-blue',
    label: 'Taverley Dungeon blue dragons',
    target: 'Blue dragon',
    bones: 'Dragon bones',
    keyItem: { name: 'Dusty key', id: 1590 },
    gate: { locId: 2623, op: 'Open', outside: new Tile(2924, 9803, 0), inside: new Tile(2923, 9803, 0) },
    approach: [new Tile(2911, 9809, 0)],
    safespots: [new Tile(2901, 9809, 0), new Tile(2900, 9809, 0), new Tile(2901, 9810, 0)],
    meleeAnchor: new Tile(2900, 9808, 0),
    bank: new Tile(2946, 3369, 0),
    escapeTeleportId: 'falador',
    walkOut: new Tile(2884, 3398, 0),
    // Why: the entrance corridor runs up the same z band as the lair with a strip of rock between, so a radius reads the way in as the way through.
    inArea: inBox({ minX: 2888, maxX: 2923, minZ: 9769, maxZ: 9816, level: 0 })
};

// Why: a second site is an entry here plus four code changes, none of which this table can carry. supply.ts hard-codes Velrak's jail from JAIL_DOOR through fetchFromVelrak and DragonSite has no field saying where a key comes from. JiveDragons.ts builds the loot options from DROP_DB[TAVERLEY_BLUE.target] at module load, because a SettingDef's options are a fixed string[] with no hook onto another key's value. The safespot1..3 panel keys only reach the first three tiles of safespots. Those tile keys are shared by every site rather than namespaced per site, so a tile moved for one site moves for all of them.

export const DRAGON_SITES: Record<string, DragonSite> = { [TAVERLEY_BLUE.key]: TAVERLEY_BLUE };

export const SITE_OPTIONS: string[] = Object.keys(DRAGON_SITES);

export function siteFor(key: string): DragonSite {
    return DRAGON_SITES[key] ?? TAVERLEY_BLUE;
}
