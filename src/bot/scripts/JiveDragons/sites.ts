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
    /** The target hits the safespot from range, so hp lost there is not the derivation being wrong. */
    rangedThreat?: boolean;
    // Why: a SettingDef's options are a fixed string[] with no hook onto another key's value, so each site names the loot setting whose chips are its own drop table.
    /** Settings key holding this site's loot chips; `loot` when absent. */
    lootSetting?: string;
    /** Fallback food when the loadout names none. */
    food?: string;
    /** The route in is worth a Superantipoison. */
    antipoison?: boolean;
    inArea(t: AreaPoint | null): boolean;
}

export interface Box {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    level: number;
}

export const inBox = (b: Box) => (t: AreaPoint | null): boolean =>
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

// Why: the black dragons sit deeper on the same side of the dusty-key gate as the blue lair, so the gate, the key, the bank, the escape and the walk-out are the blue site's and only the room and the walk to it are its own.
// Why: the way there runs south out of the blue lair, west through the demon square and north into the room, so the area is the blue box plus that passage plus the room, and a single box would swallow half the dungeon.

const BLACK_ROOM = inBox({ minX: 2818, maxX: 2850, minZ: 9815, maxZ: 9832, level: 0 });
const BLACK_PASSAGE = inBox({ minX: 2835, maxX: 2896, minZ: 9762, maxZ: 9820, level: 0 });

export const TAVERLEY_BLACK: DragonSite = {
    ...TAVERLEY_BLUE,
    key: 'taverley-black',
    label: 'Taverley Dungeon black dragons',
    target: 'Black dragon',
    lootSetting: 'lootBlack',
    food: 'Shark',
    antipoison: true,
    // Why: the walk in passes the poison spiders at (2871,9792) and (2870,9799), which is what the Superantipoison is for.
    approach: [new Tile(2893, 9790, 0), new Tile(2882, 9768, 0), new Tile(2860, 9803, 0), new Tile(2845, 9815, 0)],
    // Why: derived by tools/nav/jive-safespots.ts --target black. The corridor south of the room is the only cluster the walk in reaches without crossing tiles a dragon stands on.
    safespots: [new Tile(2836, 9817, 0), new Tile(2835, 9817, 0), new Tile(2834, 9817, 0)],
    meleeAnchor: new Tile(2835, 9818, 0),
    inArea: t => TAVERLEY_BLUE.inArea(t) || BLACK_ROOM(t) || BLACK_PASSAGE(t)
};

export const DRAGON_SITES: Record<string, DragonSite> = {
    [TAVERLEY_BLUE.key]: TAVERLEY_BLUE,
    [TAVERLEY_BLACK.key]: TAVERLEY_BLACK
};

export const SITE_OPTIONS: string[] = Object.keys(DRAGON_SITES);

export function siteFor(key: string): DragonSite {
    return DRAGON_SITES[key] ?? TAVERLEY_BLUE;
}
