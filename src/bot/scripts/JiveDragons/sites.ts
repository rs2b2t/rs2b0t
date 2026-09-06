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

// Why: the Enclave guard is an npc with a two-option chat, not a door, and the content runs `@enter_skavid_cave` off the first option once Watch Tower is complete, which teleports rather than opening anything.
/** A way in that is a conversation rather than a door. */
export interface DragonTalkGate {
    npc: string;
    op: string;
    /** The option that gets you past; the reply teleports you inside. */
    choose: string;
    stand: Tile;
}

// Why: nothing walks out of the Enclave, so the way back is the cave loc's own op, which teleports to the Gu'Tanoth hillside.
/** A way out that is a loc op rather than the walk back in reverse. */
export interface DragonExit {
    locId: number;
    op: string;
    stand: Tile;
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
    /** The way in is a conversation rather than a door. */
    talkGate?: DragonTalkGate;
    /** The way out is a loc op rather than the walk back. */
    exit?: DragonExit;
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

// Why: the lone adult is penned behind railing and spearwall, both `blockrange=no`, so a spell crosses the fence and the dragon never crosses back. Its own gate at (2909, 9910) is what the loot walk opens, and npcs do not open gates, so leaving it open does not widen the wander.
// Why: derived by tools/nav/jive-safespots.ts --target heroes, which rebuilds collision off the engine's loc configs. The pack bakes only the walking wall layer, reads the railing as opaque and derives no safespot here at all.

export const HEROES_BLUE: DragonSite = {
    key: 'heroes-blue',
    label: "Heroes' Guild blue dragon",
    target: 'Blue dragon',
    bones: 'Dragon bones',
    keyItem: null,
    gate: null,
    // Why: the cellar ladder is a transport the graph already carries, so the walk in only needs its landing named; the fight loop takes the rest.
    approach: [new Tile(2892, 9908, 0)],
    safespots: [new Tile(2905, 9909, 0), new Tile(2906, 9911, 0), new Tile(2907, 9911, 0)],
    meleeAnchor: new Tile(2909, 9910, 0),
    bank: TAVERLEY_BLUE.bank,
    escapeTeleportId: TAVERLEY_BLUE.escapeTeleportId,
    // Why: outside the guild doors, one east of Achietties, so the walk out proves the doors opened before the bank leg starts.
    walkOut: new Tile(2904, 3510, 0),
    // Why: the cellar is its own region behind one ladder, so a single box bounds it without swallowing anything else.
    inArea: inBox({ minX: 2886, maxX: 2942, minZ: 9883, maxZ: 9917, level: 0 })
};

// Why: the six spawns share the cave with ten spiders, six shamans, six chieftains and five greater demons, none of which the safespot deriver models, so the stand was picked off `bun tools/nav/jive-safespots.ts --target gutanoth` cross-referenced against those spawn tiles: it is the only cluster that both sees all of a dragon's wander and sits ten tiles clear of the nearest greater demon.
// Why: the stand at (2585,9468) looks at 69 of the 98 body tiles of the dragon at (2590,9461) and at no other dragon, so a cast never picks a second one up.

export const GUTANOTH_BLUE: DragonSite = {
    key: 'gutanoth-blue',
    label: "Gu'Tanoth Enclave blue dragons",
    target: 'Blue dragon',
    bones: 'Dragon bones',
    keyItem: null,
    gate: null,
    // Why: `[opnpc1,enclave_guard]` runs `@enter_skavid_cave` on the first option once Watch Tower is complete, which is the guard being distracted; without the quest it wants a Nightshade and this site is gated on the quest anyway.
    talkGate: {
        npc: 'Enclave guard',
        op: 'Talk-to',
        choose: 'I want to go in there',
        stand: new Tile(2508, 3038, 0)
    },
    // Why: `p_teleport(0_40_147_28_2)` drops you at the south end, sixty tiles of cave short of the stand.
    approach: [new Tile(2588, 9432, 0), new Tile(2586, 9452, 0), new Tile(2585, 9468, 0)],
    safespots: [new Tile(2585, 9468, 0), new Tile(2586, 9468, 0), new Tile(2584, 9468, 0)],
    meleeAnchor: new Tile(2588, 9468, 0),
    // Why: `[oploc1,enclavecave]` teleports to (2540,3054) on the Gu'Tanoth hillside, and it sits thirteen tiles east of the stand.
    exit: { locId: 2813, op: 'Enter', stand: new Tile(2597, 9468, 0) },
    bank: new Tile(2612, 3092, 0),
    // Why: the Watchtower spell needs the quest this site already needs, and lands two ladders and 111 tiles from the Yanille bank; every other spell lands further.
    escapeTeleportId: 'watchtower',
    walkOut: new Tile(2540, 3054, 0),
    food: 'Shark',
    // Why: the stand is melee-proof but nothing in the cave is range-proof, and a live soak took 8 and 13 off it with one adult up, so a hit here is the room rather than the tile being wrong and the ladder must not rotate off it.
    rangedThreat: true,
    // Why: one box over the cave, which is its own region behind the guard's teleport.
    inArea: inBox({ minX: 2560, maxX: 2623, minZ: 9408, maxZ: 9471, level: 0 })
};

export const DRAGON_SITES: Record<string, DragonSite> = {
    [TAVERLEY_BLUE.key]: TAVERLEY_BLUE,
    [TAVERLEY_BLACK.key]: TAVERLEY_BLACK,
    [HEROES_BLUE.key]: HEROES_BLUE,
    [GUTANOTH_BLUE.key]: GUTANOTH_BLUE
};

export const SITE_OPTIONS: string[] = Object.keys(DRAGON_SITES);

export function siteFor(key: string): DragonSite {
    return DRAGON_SITES[key] ?? TAVERLEY_BLUE;
}
