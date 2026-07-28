import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from '../api/Tile.js';
import {
    locationOptions,
    resolveGatheringLocation,
    type GatheringLocation
} from './GatheringLocations.js';

/**
 * Mining camps for GatheringBot / Miner.
 *
 * Catalog from rs2b2tgathering.csv. Most spots are seed coords (`verified: false`).
 * Prefer in-repo anchors where known (Rimmington Doric, Barb bank-tests, Tourist Trap).
 * Run `bun tools/verify-gathering-locations.ts mining` before flipping verified.
 */
export type MiningLocation = GatheringLocation;

const BANK = {
    varrockEast: new Tile(3253, 3420, 0),
    varrockWest: new Tile(3185, 3440, 0),
    alKharid: new Tile(3269, 3167, 0),
    draynor: new Tile(3093, 3243, 0),
    faladorEast: new Tile(3013, 3355, 0),
    faladorWest: new Tile(2946, 3369, 0),
    edgeville: new Tile(3094, 3493, 0),
    seers: new Tile(2725, 3491, 0),
    ardougneEast: new Tile(2655, 3283, 0),
    ardougneWest: new Tile(2616, 3332, 0),
    shilo: new Tile(2852, 2954, 0),
    shantay: new Tile(3309, 3120, 0)
} as const;

function mine(
    name: string,
    spot: Tile,
    bankStand: Tile,
    resources: readonly string[],
    notes?: string
): MiningLocation {
    return {
        name,
        spot,
        bankStand,
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: false,
        resources,
        notes
    };
}

export const MINING_LOCATIONS: MiningLocation[] = [
    mine(
        'Southwest Varrock Mine',
        new Tile(3181, 3371, 0),
        BANK.varrockWest,
        ['clay', 'copper', 'tin', 'silver']
    ),
    mine(
        'Southeast Varrock Mine',
        new Tile(3285, 3366, 0),
        BANK.varrockEast,
        ['clay', 'copper', 'tin', 'iron']
    ),
    // Doric quest copper/clay/iron anchors cluster around Rimmington mine.
    mine(
        'Rimmington Mine',
        new Tile(2978, 3247, 0),
        BANK.faladorEast,
        ['clay', 'copper', 'tin', 'iron'],
        'Seed from Doric ore anchors'
    ),
    mine(
        'Dwarven Mine',
        // Surface trapdoor hop is 3019,3449; seed underground rock cluster near Nurmof.
        new Tile(3021, 9800, 0),
        BANK.faladorEast,
        ['copper', 'tin', 'coal', 'iron'],
        'Underground seed; surface hop ~3019,3449'
    ),
    mine(
        'Fight Arena Mine',
        new Tile(2630, 3145, 0),
        BANK.ardougneEast,
        ['iron', 'mithril']
    ),
    mine(
        'Al Kharid Mine',
        new Tile(3299, 3297, 0),
        BANK.alKharid,
        ['iron', 'silver', 'mithril', 'adamantite']
    ),
    mine(
        'Mining Guild',
        new Tile(3025, 9735, 0),
        BANK.faladorEast,
        ['iron', 'coal', 'mithril'],
        'Requires Mining 60; underground guild seed'
    ),
    mine(
        'Crafting Guild',
        new Tile(2939, 3282, 0),
        BANK.faladorWest,
        ['silver', 'gold'],
        'Requires Crafting 40 + brown apron'
    ),
    mine(
        'Coal Trucks',
        new Tile(2582, 3481, 0),
        BANK.seers,
        ['coal'],
        'West of Seers; seed spot'
    ),
    // bank-locations.test uses ~3080,3420 for Barb → Edgeville nearest-bank.
    mine(
        'Barbarian Village',
        new Tile(3080, 3420, 0),
        BANK.edgeville,
        ['tin', 'coal'],
        'Approx from bank-distance tests'
    ),
    mine(
        'North Brimhaven Mine',
        new Tile(2732, 3223, 0),
        BANK.ardougneEast,
        ['gold'],
        'No local bank — ship/path to Ardougne East'
    ),
    mine(
        'Shilo Village',
        new Tile(2825, 2997, 0),
        BANK.shilo,
        ['gem rocks'],
        'Requires Shilo Village quest; bank gated'
    ),
    mine(
        'West Lumbridge Swamp Mine',
        new Tile(3148, 3147, 0),
        BANK.draynor,
        ['mithril', 'adamantite']
    ),
    mine(
        'Grand Tree Mine',
        new Tile(2461, 9890, 0),
        BANK.ardougneWest,
        ['adamantite'],
        'Requires Grand Tree quest; no GS bank — Ardougne West fallback'
    ),
    mine(
        'Desert Mining Camp',
        new Tile(3301, 3036, 0),
        BANK.shantay,
        ['adamantite'],
        'Tourist Trap camp entrance seed; underground free-mine may be limited'
    ),
    mine(
        'Lava Maze Runite Mine',
        new Tile(3058, 3884, 0),
        BANK.edgeville,
        ['runite'],
        'Wilderness — high risk; bank out at Edgeville'
    ),
    mine(
        'Heroes Guild',
        new Tile(2898, 9911, 0),
        BANK.seers,
        ['runite'],
        "Requires Heroes' Quest; basement seed"
    )
];

export const MINING_LOCATION_OPTIONS = locationOptions(MINING_LOCATIONS);

export function resolveMiningLocation(setting: string, startTile: WorldTile): MiningLocation | null {
    return resolveGatheringLocation(setting, startTile, MINING_LOCATIONS);
}
