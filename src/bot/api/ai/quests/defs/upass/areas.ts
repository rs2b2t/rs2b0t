import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot } from '../../engine/types.js';

export interface UpassItem {
    id: number;
    name: string;
}

// Why: the four orbs all display as "Orb of light" and two of the three badges as "Paladin's badge", so every lookup goes through the id.
export const UP_ITEM = {
    COINS: { id: 995, name: 'Coins' },
    LOBSTER: { id: 379, name: 'Lobster' },
    TINDERBOX: { id: 590, name: 'Tinderbox' },
    BUCKET: { id: 1925, name: 'Bucket' },
    ROPE: { id: 954, name: 'Rope' },
    SPADE: { id: 952, name: 'Spade' },
    GAS_MASK: { id: 1506, name: 'Gas mask' },
    SHORTBOW: { id: 841, name: 'Shortbow' },
    BRONZE_ARROW: { id: 882, name: 'Bronze arrow' },
    DAMP_CLOTH: { id: 1485, name: 'Damp cloth' },
    UNLIT_ARROW: { id: 598, name: 'Unlit arrows' },
    LIT_ARROW: { id: 942, name: 'Lit arrows' },
    ORB1: { id: 1481, name: 'Orb of light' },
    ORB2: { id: 1482, name: 'Orb of light' },
    ORB3: { id: 1483, name: 'Orb of light' },
    ORB4: { id: 1484, name: 'Orb of light' },
    RAILING: { id: 1486, name: 'Piece of railing' },
    UNICORN_HORN: { id: 1487, name: 'Unicorn horn' },
    BADGE_JERRO: { id: 1488, name: "Paladin's badge" },
    BADGE_CARL: { id: 1489, name: "Paladin's badge" },
    BADGE_HARRY: { id: 1490, name: "Paladin's badge" },
    WITCH_CAT: { id: 1491, name: 'Witches cat' },
    DOLL: { id: 1492, name: 'Doll of iban' },
    HISTORY: { id: 1494, name: 'History of iban' },
    GAUNTLETS: { id: 1495, name: "Klank's gauntlets" },
    DOVE: { id: 1496, name: "Iban's dove" },
    AMULET_OTHAINIAN: { id: 1497, name: 'Amulet of othanian' },
    AMULET_DOOMION: { id: 1498, name: 'Amulet of doomion' },
    AMULET_HOLTHION: { id: 1499, name: 'Amulet of holthion' },
    SHADOW: { id: 1500, name: "Iban's shadow" },
    DWARF_BREW: { id: 1501, name: 'Dwarf brew' },
    ASHES: { id: 1502, name: "Iban's ashes" },
    IBAN_STAFF: { id: 1409, name: "Iban's staff" },
    ZAM_TOP: { id: 1035, name: 'Robe of zamorak' },
    ZAM_BOTTOM: { id: 1033, name: 'Robe of zamorak' }
} as const satisfies Record<string, UpassItem>;

export const UP_ORBS: readonly UpassItem[] = [UP_ITEM.ORB1, UP_ITEM.ORB2, UP_ITEM.ORB3, UP_ITEM.ORB4];
export const UP_BADGES: readonly UpassItem[] = [UP_ITEM.BADGE_JERRO, UP_ITEM.BADGE_CARL, UP_ITEM.BADGE_HARRY];
export const UP_AMULETS: readonly UpassItem[] = [UP_ITEM.AMULET_DOOMION, UP_ITEM.AMULET_OTHAINIAN, UP_ITEM.AMULET_HOLTHION];

// Why: five distinct NPCs all render as "Koftik", so the guide is matched by id and never by name.
export const UP_NPC = {
    KOFTIK_SURFACE: 972,
    KOFTIK_BRIDGE: 973,
    KOFTIK_GRID: 974,
    KOFTIK_INSANE: 975,
    KOFTIK_LAST: 976,
    BOULDER: 986,
    PALADIN_JERRO: 988,
    PALADIN_CARL: 989,
    PALADIN_HARRY: 990,
    WITCH: 992,
    WITCH_CAT: 993,
    NILHOOF: 994,
    KLANK: 995,
    KAMEN: 996,
    KALRAG: 997,
    OTHAINIAN: 998,
    DOOMION: 999,
    HOLTHION: 1000,
    DISCIPLE: 1002,
    IBAN: 1003
} as const;

export const UP_LOC = {
    CAVE_ENTRANCE: 3213,
    CAVE_EXIT: 3214,
    GUIDEROPE: 3340,
    BRIDGE_LEVER: 3241,
    LOGTRAP_TRIGGER: 3339,
    ORB_VIS: 3361,
    SPEARTRAP: 3234,
    SPRINGTRAP: 3230,
    FURNACE: 3294,
    WELL: 3264,
    // Why: `Read` on a stone tablet only prints a plaque, which makes it the one op-click in the orb corridor with no cost, the walk to it is what the stall is for. The west tablet is the only loc within one loaded scene of every orb, the furnace and the well at once.
    TABLET_WEST: 3298,
    TABLET_EAST: 3297,
    PORTCULLIS_LEVER: 3337,
    PORTCULLIS: 3303,
    GRID_HANDHOLDS: 3365,
    RAILINGS_LOCKED: 3266,
    RAILINGS_LOOSE: 3267,
    RAILINGS_HARD: 3268,
    MUDPILE: 3307,
    UNICORN_CAGE: 3308,
    UNICORN_DOOR_R: 3218,
    UNICORN_DOOR_L: 3219,
    BLOODWELL: 3305,
    TEMPLE_DOOR_L: 3220,
    TEMPLE_DOOR_R: 3221,
    TUNNEL_DOWN: 3222,
    TUNNEL_UP: 3223,
    LEDGE: 3238,
    ROCK_BRIDGE: 3276,
    ROCKSWING: 2275,
    ROCKSWING_ANCHOR: 2276,
    ROCKSWING_BACK: 2274,
    ROCKSLIDE: 3309,
    COLLAPSED_A: 3254,
    COLLAPSED_B: 3255,
    WITCH_DOOR: 3270,
    WITCH_CHEST: 3272,
    // Why: `[oploc1,cavewitchchest]` runs `loc_change(cavewitchchestopen, 20)` before it searches, so for twenty ticks Kardia's chest is a DIFFERENT loc carrying a different op, 3273 with `Search` rather than 3272 with `Open`. Both run `@search_cavewitch_chest`.
    WITCH_CHEST_OPEN: 3273,
    SEALED_CHEST: 3274,
    CAGE_DOVE: 3351,
    CAGE_EMPTY: 3352,
    BREW_BARREL: 3344,
    IBAN_TOMB_L: 3353,
    IBAN_TOMB_R: 3354,
    IBAN_DOOR_R: 3333,
    IBAN_DOOR_L: 3334,
    IBAN_ALTAR: 3359,
    LAST_OUT: 3224,
    FOOD_CRATE: 3360,
    PIPE_AREA1: 3235,
    PIPE_AREA2: 3237,
    MUD_DIG: 3216,
    WALL_DOOR_L: 2048,
    WALL_DOOR_R: 2049
} as const;

// Why: every tile here that fronts a loc is a STAND, not the loc's own origin, a multi-tile loc covers
// its origin, so walking to it fails outright and the step reads as a missing loc.
export const UP_TILE = {
    ARDOUGNE_BANK: new Tile(2655, 3283, 0),
    AEMAD: new Tile(2613, 3294, 0),
    LOWE: new Tile(3231, 3421, 0),
    LATHAS: new Tile(2578, 3293, 1),
    CASTLE_STAIRS: new Tile(2572, 3296, 0),
    WALL_GATE_EAST: new Tile(2559, 3300, 0),
    WALL_GATE_WEST: new Tile(2555, 3300, 0),
    CAVE_MOUTH: new Tile(2436, 3315, 0),
    CAVE_ENTRANCE: new Tile(2433, 3313, 0),

    AREA1_LANDING: new Tile(2494, 9716, 0),
    KOFTIK_BRIDGE: new Tile(2449, 9716, 0),
    GUIDEROPE_SHOT: new Tile(2448, 9721, 0),
    BRIDGE_WEST: new Tile(2442, 9716, 0),
    BRIDGE_LEVER: new Tile(2436, 9716, 0),

    ROCKSWING_WEST: new Tile(2462, 9699, 0),
    ROCKSWING_EAST: new Tile(2466, 9699, 0),
    GRID_EAST: new Tile(2477, 9677, 0),
    // Why: the stall is launched from Koftik's lip, not the handhold return tile, a tile further out is
    // needed so the journal is up before the player is on the trapped ground, and nothing east of here routes.
    GRID_APPROACH: new Tile(2479, 9679, 0),
    GRID_WEST: new Tile(2467, 9677, 0),
    PORTCULLIS_LEVER: new Tile(2466, 9672, 0),
    FURNACE: new Tile(2454, 9682, 0),
    ORB2: new Tile(2386, 9677, 0),
    ORB3: new Tile(2385, 9685, 0),
    ORB4: new Tile(2416, 9698, 0),
    LOGTRAP: new Tile(2382, 9668, 0),
    WELL: new Tile(2416, 9674, 0),
    CORRIDOR_HUB: new Tile(2422, 9671, 0),

    AREA2_LANDING: new Tile(2423, 9660, 0),
    RAILINGS_LOOSE: new Tile(2397, 9606, 0),
    // Why: the boulder's own tile is a fourteen-tile nook of its own, walled off from the cavern floor,
    // this is the nearest stand a walk can reach, and the use is sent from there.
    BOULDER: new Tile(2398, 9596, 0),
    UNICORN_CAGE: new Tile(2375, 9604, 0),
    MUDPILE: new Tile(2423, 9661, 0),
    MUD_DIG: new Tile(2393, 9650, 0),

    PALADINS: new Tile(2424, 9719, 0),
    BLOODWELL: new Tile(2373, 9718, 0),
    TEMPLE_DOOR: new Tile(2370, 9718, 0),

    MAIN_LANDING: new Tile(2173, 4725, 1),
    CAGE_DOVE: new Tile(2134, 4702, 1),

    // Why: the dwarf camp and Kalrag's cave hang off two different level-1 tunnels, so each side keeps both ends.
    TUNNEL_TO_DWARVES: new Tile(2150, 4545, 1),
    TUNNEL_FROM_DWARVES: new Tile(2336, 9793, 0),
    TUNNEL_TO_KALRAG: new Tile(2112, 4729, 1),
    TUNNEL_FROM_KALRAG: new Tile(2304, 9915, 0),

    NILHOOF: new Tile(2315, 9806, 0),
    KLANK: new Tile(2323, 9804, 0),
    KAMEN: new Tile(2325, 9799, 0),
    BREW_BARREL: new Tile(2327, 9799, 0),
    IBAN_TOMB: new Tile(2357, 9800, 0),
    KALRAG: new Tile(2356, 9911, 0),

    WITCH_DOOR: new Tile(2158, 4566, 1),
    WITCH_DOOR_OUT: new Tile(2158, 4567, 1),
    WITCH_CHEST: new Tile(2157, 4564, 1),
    WITCH_CAT: new Tile(2131, 4602, 1),
    SEALED_CHEST: new Tile(2136, 4578, 1),
    DOOMION: new Tile(2134, 4565, 1),
    HOLTHION: new Tile(2132, 4554, 1),
    OTHAINIAN: new Tile(2122, 4562, 1),

    DISCIPLE: new Tile(2159, 4646, 1),
    IBAN_DOOR: new Tile(2144, 4647, 1),
    IBAN_ALTAR: new Tile(2136, 4647, 1),
    IBAN_THROWN_OUT: new Tile(2482, 9607, 0),
    LAST_OUT: new Tile(2438, 9607, 0),
    CAVE_EXIT: new Tile(2496, 9714, 0),
    WELL_OF_VOYAGE: new Tile(2008, 4711, 1)
} as const;

// Why: the level-1 platforms are a graph of pockets joined by identical collapsed bridges, and a runtime search over it wanders. One run crossed four of them in thirty-five minutes, none toward its target. The graph is static, so `tools/nav/upass-platform-route.ts` solves it against the collision pack and emits this. Each link names the bridge, the tile to stand on for each side, and which pocket that side is in.
export interface PlatformLink {
    bridge: Tile;
    a: { tile: Tile; pocket: string };
    b: { tile: Tile; pocket: string };
}

// Why: the first cavern is a pocket graph too, and the runtime search fails it the same way the platforms failed, an end-to-end run swung the rope onto 9a025db and then could not see the rockslide that leaves it, because that rockslide is twenty-one tiles east and the client's build area lags the player. It stood there naming eight rockslides it could not reach until the run ran out. These two are the ones the route from the bridge to the grid needs, and they are the ones a scene query does not reliably hold.
export const CAVERN_LINKS: readonly PlatformLink[] = [
    { bridge: new Tile(2491, 9691, 0), a: { tile: new Tile(2491, 9692, 0), pocket: '9a025db' }, b: { tile: new Tile(2491, 9690, 0), pocket: '9b225ca' } },
    { bridge: new Tile(2482, 9679, 0), a: { tile: new Tile(2483, 9679, 0), pocket: '9b225ca' }, b: { tile: new Tile(2481, 9679, 0), pocket: '9a225c9' } }
];

export const PLATFORM_LINKS: readonly PlatformLink[] = [
    { bridge: new Tile(2123, 4582, 1), a: { tile: new Tile(2123, 4581, 1), pocket: '84811d6' }, b: { tile: new Tile(2123, 4585, 1), pocket: '84b11e9' } },
    { bridge: new Tile(2126, 4566, 1), a: { tile: new Tile(2125, 4566, 1), pocket: '84811d6' }, b: { tile: new Tile(2129, 4566, 1), pocket: '85111c9' } },
    { bridge: new Tile(2127, 4592, 1), a: { tile: new Tile(2127, 4591, 1), pocket: '84b11e9' }, b: { tile: new Tile(2130, 4592, 1), pocket: '84711f5' } },
    { bridge: new Tile(2136, 4584, 1), a: { tile: new Tile(2135, 4584, 1), pocket: '85211e7' }, b: { tile: new Tile(2139, 4584, 1), pocket: '84711f5' } },
    { bridge: new Tile(2142, 4562, 1), a: { tile: new Tile(2142, 4561, 1), pocket: '85111c9' }, b: { tile: new Tile(2142, 4565, 1), pocket: '84711f5' } },
    { bridge: new Tile(2143, 4604, 1), a: { tile: new Tile(2142, 4604, 1), pocket: '84711f5' }, b: { tile: new Tile(2146, 4604, 1), pocket: '86211fc' } },
    { bridge: new Tile(2147, 4583, 1), a: { tile: new Tile(2146, 4583, 1), pocket: '84711f5' }, b: { tile: new Tile(2150, 4583, 1), pocket: '86311db' } },
    { bridge: new Tile(2156, 4582, 1), a: { tile: new Tile(2155, 4582, 1), pocket: '86311db' }, b: { tile: new Tile(2159, 4582, 1), pocket: '84111c4' } },
    { bridge: new Tile(2161, 4599, 1), a: { tile: new Tile(2161, 4598, 1), pocket: '86811f4' }, b: { tile: new Tile(2161, 4602, 1), pocket: '86211fc' } },
    { bridge: new Tile(2121, 4686, 1), a: { tile: new Tile(2120, 4686, 1), pocket: '84111c4' }, b: { tile: new Tile(2124, 4686, 1), pocket: '84c124e' } },
    { bridge: new Tile(2145, 4717, 1), a: { tile: new Tile(2145, 4716, 1), pocket: '84c124e' }, b: { tile: new Tile(2145, 4720, 1), pocket: '8601270' } },
    { bridge: new Tile(2154, 4690, 1), a: { tile: new Tile(2154, 4689, 1), pocket: '84c124e' }, b: { tile: new Tile(2154, 4693, 1), pocket: '869125a' } },
    { bridge: new Tile(2155, 4704, 1), a: { tile: new Tile(2155, 4703, 1), pocket: '869125a' }, b: { tile: new Tile(2155, 4707, 1), pocket: '86b1263' } },
    { bridge: new Tile(2155, 4718, 1), a: { tile: new Tile(2155, 4717, 1), pocket: '86b1263' }, b: { tile: new Tile(2155, 4721, 1), pocket: '8601270' } },
    { bridge: new Tile(2158, 4724, 1), a: { tile: new Tile(2157, 4724, 1), pocket: '8601270' }, b: { tile: new Tile(2161, 4724, 1), pocket: '84111c4' } },
    { bridge: new Tile(2164, 4686, 1), a: { tile: new Tile(2163, 4686, 1), pocket: '869125a' }, b: { tile: new Tile(2167, 4686, 1), pocket: '84111c4' } },
    { bridge: new Tile(2123, 4616, 1), a: { tile: new Tile(2123, 4615, 1), pocket: '8491201' }, b: { tile: new Tile(2123, 4619, 1), pocket: '84a120f' } },
    { bridge: new Tile(2127, 4610, 1), a: { tile: new Tile(2126, 4610, 1), pocket: '8491201' }, b: { tile: new Tile(2130, 4610, 1), pocket: '84a120f' } },
    { bridge: new Tile(2148, 4614, 1), a: { tile: new Tile(2147, 4614, 1), pocket: '84a120f' }, b: { tile: new Tile(2151, 4614, 1), pocket: '86211fc' } },
    { bridge: new Tile(2160, 4625, 1), a: { tile: new Tile(2160, 4624, 1), pocket: '86211fc' }, b: { tile: new Tile(2160, 4628, 1), pocket: '86f1218' } },
    { bridge: new Tile(2161, 4637, 1), a: { tile: new Tile(2161, 4636, 1), pocket: '86f1218' }, b: { tile: new Tile(2161, 4640, 1), pocket: '8611226' } },
    { bridge: new Tile(2161, 4654, 1), a: { tile: new Tile(2161, 4653, 1), pocket: '8611226' }, b: { tile: new Tile(2161, 4657, 1), pocket: '8701233' } },
    { bridge: new Tile(2162, 4663, 1), a: { tile: new Tile(2162, 4662, 1), pocket: '8701233' }, b: { tile: new Tile(2162, 4666, 1), pocket: '84c124e' } },
];

export type UpassArea =
    | 'mainland'
    | 'westardougne'
    | 'area1'
    | 'area2'
    | 'gridpit'
    | 'main'
    | 'witch'
    | 'temple'
    | 'dwarves'
    | 'kalrag'
    | 'voyage'
    | 'unknown';

/**
 * Which sealed pocket of the pass the player is standing in.
 * Why: the pass is a chain of one-way `p_teleport` hops between map squares the navigator cannot route across, so every leg first asks where it already is.
 */
export function upassArea(tile: QuestSnapshot['tile']): UpassArea {
    if (!tile) {
        return 'unknown';
    }
    const { x, z, level } = tile;
    // Why: the cavern platforms sit at level 1 under z 5000, which is the same band as the surface, the x window is what separates them.
    if (level === 1 && x >= 2112 && x <= 2175) {
        if (z >= 4672 && z <= 4735) return 'main';
        if (z >= 4608 && z <= 4671) return 'temple';
        if (z >= 4544 && z <= 4607) return 'witch';
    }
    if (level === 1 && x >= 1984 && x <= 2047 && z >= 4672 && z <= 4735) {
        return 'voyage';
    }
    if (x >= 2304 && x <= 2367) {
        if (z >= 9856 && z <= 9919) return 'kalrag';
        if (z >= 9792 && z <= 9855) return 'dwarves';
    }
    if (z >= 9536 && z <= 9599) return 'gridpit';
    if (z >= 9600 && z <= 9663) return 'area2';
    if (z >= 9664 && z <= 9727) return 'area1';
    if (z >= 5000) {
        return 'unknown';
    }
    // Why: West Ardougne is sealed behind the wall, the only way in is the Plague City sewer pipe, so it
    // is its own region rather than part of the mainland the navigator can route across.
    return level === 0 && x >= 2433 && x <= 2556 && z >= 3266 && z <= 3334 ? 'westardougne' : 'mainland';
}

export function held(snap: QuestSnapshot, item: UpassItem): number {
    return snap.invIds?.get(item.id) ?? 0;
}

export function banked(snap: QuestSnapshot, item: UpassItem): number {
    return snap.bankIds?.get(item.id) ?? 0;
}

export function owned(snap: QuestSnapshot, item: UpassItem): number {
    return held(snap, item) + banked(snap, item);
}

export function worn(snap: QuestSnapshot, item: UpassItem): boolean {
    return snap.wornIds?.has(item.id) ?? false;
}

export function carried(snap: QuestSnapshot, item: UpassItem): number {
    return held(snap, item) + (worn(snap, item) ? 1 : 0);
}

/** How many of a set the pack holds, the orbs, the badges and the amulets all share a display name. */
export function countHeld(snap: QuestSnapshot, items: readonly UpassItem[]): number {
    return items.filter(item => held(snap, item) > 0).length;
}

/** The trapped rectangle of the spiked grid: `inzone(upass_grid_col5, upass_grid_col1 + (1,0,9))`. */
export const GRID_ZONE = { minX: 2467, maxX: 2476, minZ: 9673, maxZ: 9682 } as const;

// Why: a flood fill of the first cavern on foot gives four pockets, and two of them overlap on a rectangle: the orb corridor is x 2380-2466 / z 9664-9698 and the bridge-and-rope shelf is x 2431-2464 / z 9686-9731. A plain box therefore reads the shelf as the corridor, which is what let one run declare the grid crossed while it was still standing on the wrong side of it. The corridor's own ground is what is left after the shelf is taken out, everything below the shelf, plus everything west of where the shelf starts.
const CORRIDOR = { maxX: 2464, westOfShelf: 2430, belowShelf: 9685, minZ: 9664 } as const;

/** West of the spiked grid, in the corridor it opens onto. The crossing is behind the character. */
// Why: Kardia's house is a sealed fifteen-tile pocket, a flood of the collision pack from inside gives x 2151-2157 by z 4565-4567 and stops at her door, which the pack calls blocked because it is a door. The chest is in there, so every leg that lifts the doll ends shut in, and every walk out reads as unreachable.
const WITCH_HOUSE = { minX: 2151, maxX: 2157, minZ: 4565, maxZ: 4567 } as const;

export function insideWitchHouse(tile: QuestSnapshot['tile']): boolean {
    return tile !== null && tile !== undefined && tile.level === 1
        && tile.x >= WITCH_HOUSE.minX && tile.x <= WITCH_HOUSE.maxX
        && tile.z >= WITCH_HOUSE.minZ && tile.z <= WITCH_HOUSE.maxZ;
}

// Why: stage 7 and stage 8 print the same journal text, so the doors being open is not readable, the
// only honest answer to "am I past them" is standing west of them on the temple floor.
export function insideIbanTemple(tile: QuestSnapshot['tile']): boolean {
    return tile !== null && tile !== undefined && tile.level === 1
        && tile.x < UP_TILE.IBAN_DOOR.x && tile.x >= 2128
        && tile.z >= 4640 && tile.z <= 4656;
}

export function pastGridTile(tile: QuestSnapshot['tile']): boolean {
    return tile !== null
        && tile !== undefined
        && tile.x <= CORRIDOR.maxX
        && tile.z >= CORRIDOR.minZ
        && (tile.z <= CORRIDOR.belowShelf || tile.x <= CORRIDOR.westOfShelf);
}
