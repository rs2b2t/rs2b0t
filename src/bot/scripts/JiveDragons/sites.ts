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

// Why: Saniboch's Pay op sets a varbit the entrance tree reads and clears on the way through, so every trip is a payment and a click, and neither is a door the graph can carry.
/** A way in that costs coins: an npc paid from `stand`, then a loc op that teleports inside. */
export interface DragonFeeGate {
    npc: string;
    op: string;
    coins: number;
    stand: Tile;
    entrance: { locId: number; op: string };
    /** The line the payment prints, which is what proves the coins landed. */
    paidLine: RegExp;
    /** The line a second Pay gets when the varbit is already set, since the coins stay put then. */
    prepaidLine: RegExp;
}

// Why: a cave with six dragons in it has more than one good stand, and which one you want depends on what else is camping the room, so the site carries them numbered and the operator picks.
/** One numbered place to fight from: the tiles the ladder rotates between and the tile melee uses. */
export interface DragonStand {
    /** Which dragon it looks at, for the log line. */
    label: string;
    tiles: Tile[];
    anchor: Tile;
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
    /** Numbered stands to choose between; `safespots` and `meleeAnchor` are the first of them. */
    stands?: DragonStand[];
    // Why: a stand is idle while its dragon respawns, and the Enclave puts a greater demon inside cast range of one, so the idle time goes on that rather than on nothing.
    /** Other npcs worth killing from the same stand, taken only when the target is not up. */
    alsoHunt?: string[];
    /** The way in costs coins at an npc before a loc op teleports inside. */
    feeGate?: DragonFeeGate;
    // Why: metal dragons breathe from ten tiles by script, so no tile is fire-proof and the Dragonfire shield goes on whatever the style; the bow has no hand left for it.
    /** The target breathes at range, so every style wears the shield and range is refused. */
    fireAtRange?: boolean;
    /** The trip carries Antifire potions and sips one whenever the last dose lapses. */
    antifire?: boolean;
    /** Coins carried per trip, for the fee and the fares on the way. */
    coins?: number;
    /** The walk in chops vines, so an axe rides in the pack. */
    axe?: boolean;
    // Why: with the breath at 0 the food goes unused and the doses are what the trip burns, so a site can say how much food a trip carries when the panel is left at its default.
    /** Food per trip while the panel's foodWithdraw sits on its schema default. */
    foodPerTrip?: number;
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

// Why: the six spawns share the cave with ten spiders, six shamans, six chieftains and five greater demons, none of which the safespot deriver models, so every stand comes off `bun tools/nav/jive-safespots.ts --target gutanoth` cross-referenced against those spawn tiles: each seed is a derived safespot, sits at least five tiles off the nearest of them, has neighbours to rotate onto, and sees as much of one dragon's wander as the cave allows.
// Why: a stand is chosen for how much of a dragon's wander it sees, not for seeing one dragon and no other. Requiring that first left the south dragon a stand that saw 11% of it, and a live run there took no kills at all in twenty minutes.
// Why: stand 1 is the proven one and stays first, at 79% of its dragon and ten tiles clear, which is more room than any other stand in the cave has.

const GUTANOTH_STANDS: DragonStand[] = [
    {
        label: 'the north dragon at 2590,9461',
        tiles: [new Tile(2585, 9468, 0), new Tile(2586, 9468, 0), new Tile(2584, 9468, 0)],
        anchor: new Tile(2588, 9468, 0)
    },
    {
        label: 'the west dragon at 2568,9437',
        tiles: [new Tile(2573, 9429, 0), new Tile(2572, 9429, 0), new Tile(2574, 9429, 0)],
        anchor: new Tile(2574, 9430, 0)
    },
    {
        label: 'the north-west dragon at 2579,9445',
        tiles: [new Tile(2587, 9449, 0), new Tile(2586, 9447, 0), new Tile(2587, 9447, 0)],
        anchor: new Tile(2586, 9449, 0)
    },
    {
        label: 'the south dragon at 2592,9431',
        tiles: [new Tile(2591, 9423, 0), new Tile(2590, 9423, 0), new Tile(2591, 9422, 0)],
        anchor: new Tile(2597, 9426, 0)
    },
    {
        label: 'the east dragon at 2604,9443',
        tiles: [new Tile(2611, 9441, 0), new Tile(2611, 9442, 0), new Tile(2610, 9442, 0)],
        anchor: new Tile(2610, 9441, 0)
    },
    {
        label: 'the far east dragon at 2609,9459',
        tiles: [new Tile(2604, 9466, 0), new Tile(2603, 9464, 0), new Tile(2603, 9465, 0)],
        anchor: new Tile(2606, 9466, 0)
    }
];

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
    // Why: `p_teleport(0_40_147_28_2)` drops you at the south end, so the approach is the walk up the middle of the cave and the fight loop takes it from wherever the chosen stand is.
    approach: [new Tile(2588, 9432, 0)],
    stands: GUTANOTH_STANDS,
    safespots: GUTANOTH_STANDS[0]!.tiles,
    meleeAnchor: GUTANOTH_STANDS[0]!.anchor,
    // Why: `[oploc1,enclavecave]` teleports to (2540,3054) on the Gu'Tanoth hillside, and it sits thirteen tiles east of the stand.
    exit: { locId: 2813, op: 'Enter', stand: new Tile(2597, 9468, 0) },
    bank: new Tile(2612, 3092, 0),
    // Why: the Watchtower spell needs the quest this site already needs, and lands two ladders and 111 tiles from the Yanille bank; every other spell lands further.
    escapeTeleportId: 'watchtower',
    walkOut: new Tile(2540, 3054, 0),
    food: 'Shark',
    // Why: the cave's greater demons cannot be camped at all, since the four in the east chamber wander into one shared body with no tile that sees one out of another's reach; the fifth stands within a cast of stand 1, so it is filler rather than a site of its own.
    alsoHunt: ['Greater demon'],
    lootSetting: 'lootEnclave',
    // Why: the stand is melee-proof but nothing in the cave is range-proof, and a live soak took 8 and 13 off it with one adult up, so a hit here is the room rather than the tile being wrong and the ladder must not rotate off it.
    rangedThreat: true,
    // Why: one box over the cave, which is its own region behind the guard's teleport.
    inArea: inBox({ minX: 2560, maxX: 2623, minZ: 9408, maxZ: 9471, level: 0 })
};

// Why: the dungeon is nine pockets joined by vines, stepping stones, a log and a pipe, all of them edges in transports.json, and the landing is sealed from everything else; the box covers all of it so the walk in from the landing is a walk to the stand and never a second payment.
const BRIMHAVEN_DUNGEON = inBox({ minX: 2624, maxX: 2751, minZ: 9408, maxZ: 9599, level: 0 });

// Why: derived by tools/nav/jive-safespots.ts --target iron --anywhere. A metal dragon parks at ten tiles and breathes, and the shield with an Antifire dose makes that 0, so the stand is not a melee-proof pocket but the open tile that sees the most dragons; losing one is harder than finding one. A camp still keeps out of every idle wander footprint and the tile beside it, iron and steel alike, since a dragon that wanders adjacent headbutts for fifteen a hit and did, from a camp four tiles off an iron spawn. Camp 1 sees the dragon at (2739,9450) over two thirds of its wander, camp 2 the one spawned on a blocked tile at (2736,9424) that the deriver used to drop, camp 3 the south-west one, all clear of the wild dogs, black demons and bronze dragons on the north edge.
const BRIMHAVEN_IRON_STANDS: DragonStand[] = [
    {
        label: 'the north-east corner from 2744,9457',
        tiles: [new Tile(2744, 9457, 0), new Tile(2743, 9457, 0), new Tile(2744, 9458, 0)],
        anchor: new Tile(2744, 9457, 0)
    },
    {
        label: 'the east wall from 2740,9434',
        tiles: [new Tile(2740, 9434, 0)],
        anchor: new Tile(2740, 9434, 0)
    },
    {
        label: 'the south-west from 2704,9417',
        tiles: [new Tile(2704, 9417, 0), new Tile(2703, 9417, 0), new Tile(2705, 9417, 0)],
        anchor: new Tile(2704, 9417, 0)
    }
];

// Why: every steel spawn sits among iron wander boxes, so the one camp outside all of them sees the west steel dragon at half its wander and an iron beside it, which the filler rule finishes when it bites.
const BRIMHAVEN_STEEL_STANDS: DragonStand[] = [
    {
        label: 'the west dragon from 2698,9440',
        tiles: [new Tile(2698, 9440, 0), new Tile(2698, 9439, 0), new Tile(2697, 9441, 0)],
        anchor: new Tile(2698, 9440, 0)
    }
];

// Why: the walk in is the landing pocket to the pipe, one obstacle a stop, so a leg that fails retries its own crossing rather than every crossing.
const BRIMHAVEN_APPROACH = [new Tile(2691, 9564, 0), new Tile(2649, 9562, 0), new Tile(2672, 9499, 0), new Tile(2682, 9506, 0), new Tile(2698, 9500, 0), new Tile(2698, 9492, 0)];

// Why: the Ardougne teleport lands twenty tiles from the east bank and the ferry to Brimhaven leaves from beside it, so the trip is spell, booth, fare, Saniboch, fare again; Falador is two boats further.
export const BRIMHAVEN_IRON: DragonSite = {
    key: 'brimhaven-iron',
    label: 'Brimhaven Dungeon iron dragons',
    target: 'Iron dragon',
    bones: 'Dragon bones',
    keyItem: null,
    gate: null,
    feeGate: {
        npc: 'Saniboch',
        op: 'Pay',
        coins: 875,
        stand: new Tile(2747, 3152, 0),
        entrance: { locId: 5083, op: 'Enter' },
        paidLine: /you pay saniboch 875 coins/i,
        prepaidLine: /already given me lots of nice coins/i
    },
    approach: BRIMHAVEN_APPROACH,
    stands: BRIMHAVEN_IRON_STANDS,
    safespots: BRIMHAVEN_IRON_STANDS[0]!.tiles,
    meleeAnchor: BRIMHAVEN_IRON_STANDS[0]!.anchor,
    // Why: `[oploc1,karam_dungeon_exit]` teleports to the tile beside Saniboch, and the loc is a wall piece on the landing's east side.
    exit: { locId: 5084, op: 'leave', stand: new Tile(2713, 9564, 0) },
    bank: new Tile(2655, 3283, 0),
    escapeTeleportId: 'ardougne',
    walkOut: new Tile(2745, 3152, 0),
    food: 'Shark',
    foodPerTrip: 8,
    lootSetting: 'lootIron',
    // Why: losing a metal dragon's aggro is hard, so whichever of the two kinds is biting gets finished, and auto-retaliate stays on for it.
    alsoHunt: ['Steel dragon'],
    fireAtRange: true,
    rangedThreat: true,
    antifire: true,
    // Why: 875 for Saniboch and 30 each way on the ferry, with a margin for a pile the run leaves behind.
    coins: 1000,
    axe: true,
    inArea: BRIMHAVEN_DUNGEON
};

export const BRIMHAVEN_STEEL: DragonSite = {
    ...BRIMHAVEN_IRON,
    key: 'brimhaven-steel',
    label: 'Brimhaven Dungeon steel dragons',
    target: 'Steel dragon',
    stands: BRIMHAVEN_STEEL_STANDS,
    safespots: BRIMHAVEN_STEEL_STANDS[0]!.tiles,
    meleeAnchor: BRIMHAVEN_STEEL_STANDS[0]!.anchor,
    alsoHunt: ['Iron dragon'],
    lootSetting: 'lootSteel'
};

export const DRAGON_SITES: Record<string, DragonSite> = {
    [TAVERLEY_BLUE.key]: TAVERLEY_BLUE,
    [TAVERLEY_BLACK.key]: TAVERLEY_BLACK,
    [HEROES_BLUE.key]: HEROES_BLUE,
    [GUTANOTH_BLUE.key]: GUTANOTH_BLUE,
    [BRIMHAVEN_IRON.key]: BRIMHAVEN_IRON,
    [BRIMHAVEN_STEEL.key]: BRIMHAVEN_STEEL
};

/** Every site whose stands are numbered, for the panel's stand picker. */
export const STAND_SITE_KEYS: string[] = Object.values(DRAGON_SITES).filter(s => (s.stands?.length ?? 0) > 1).map(s => s.key);

/** The most stands any site carries. */
export const MAX_STANDS: number = Math.max(...Object.values(DRAGON_SITES).map(s => s.stands?.length ?? 1));

/** Whether the run wears the Dragonfire shield: always for melee, and on a site that breathes at range for every style. */
export function needsShield(site: DragonSite, style: string): boolean {
    return style === 'melee' || site.fireAtRange === true;
}

export const SITE_OPTIONS: string[] = Object.keys(DRAGON_SITES);

// Why: the target comes first in the list, so a caller that wants one thing to hunt takes the head and a caller that wants everything takes the lot.
/** Every npc name this site kills: its target, then anything it fills downtime with. */
export function huntNames(site: DragonSite): string[] {
    return [site.target, ...(site.alsoHunt ?? [])];
}

// Why: a site with no stands keeps behaving as it always did, and a number past the end clamps rather than throwing on a settings typo.
/** The numbered stand to fight from, 1-based; the site's own tiles when it names none. */
export function standFor(site: DragonSite, n: number): DragonStand {
    const stands = site.stands;
    if (!stands || stands.length === 0) {
        return { label: site.label, tiles: [...site.safespots], anchor: site.meleeAnchor };
    }
    const i = Math.min(Math.max(1, Math.trunc(n) || 1), stands.length) - 1;
    return stands[i]!;
}

export function siteFor(key: string): DragonSite {
    return DRAGON_SITES[key] ?? TAVERLEY_BLUE;
}
