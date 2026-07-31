import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from './Tile.js';
import {
    locationOptions,
    resolveGatheringLocation,
    type GatheringLocation
} from './GatheringLocations.js';

/**
 * Mining camps for GatheringBot / Miner.
 *
 * Catalog from rs2b2tgathering.csv, polished via live verify + visual stand checks.
 * All entries ship `verified: true` after pathability/resource confirmation.
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
    shantay: new Tile(3309, 3120, 0),
    grandTree: new Tile(2449, 3482, 1)
} as const;

function mine(
    name: string,
    spot: Tile,
    bankStand: Tile,
    resources: readonly string[],
    notes?: string,
    verified = true
): MiningLocation {
    return {
        name,
        spot,
        bankStand,
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified,
        resources,
        notes
    };
}

export const MINING_LOCATIONS: MiningLocation[] = [
    mine(
        'Southwest Varrock Mine',
        new Tile(3181, 3371, 0),
        BANK.varrockWest,
        // Live stand at seed: tin only in leash (no copper/clay/silver at 3181,3371).
        ['tin']
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
        // Adjacent stand — previous 2630,3145 was inside a rock loc.
        new Tile(2631, 3146, 0),
        BANK.ardougneEast,
        ['iron', 'mithril']
    ),
    mine(
        'Al Kharid Mine',
        // Prior 3299,3297 sat inside a scenery object — stand 2N.
        new Tile(3299, 3299, 0),
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
    // Rocks cluster ~3086,3416–3425; 3080,3420 was unpathable object center.
    // bank-locations.test still uses 3080,3420 as a village-area nearest-bank probe.
    mine(
        'Barbarian Village',
        new Tile(3084, 3417, 0),
        BANK.edgeville,
        ['tin', 'coal'],
        'Tin/coal rocks east of village center'
    ),
    mine(
        'North Brimhaven Mine',
        // Adjacent stand — previous 2732,3223 was inside a rock loc.
        new Tile(2733, 3224, 0),
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
        // Classic west-coast seed is blue void on this engine. Live mineable cluster is
        // the east-swamp rocks near Urhney (~3233–3243, 3157–3167). Stand a couple
        // tiles south of the rock tile so we are not inside a loc.
        new Tile(3235, 3163, 0),
        BANK.draynor,
        ['mithril', 'adamantite'],
        'East swamp rock cluster (west coast unloaded/void on this map)'
    ),
    mine(
        'Grand Tree Mine',
        // Rocks at ~2472,9905; stand a few tiles north of prior 2465,9905 seed.
        new Tile(2465, 9909, 0),
        BANK.grandTree,
        ['adamantite'],
        'Requires Grand Tree quest; bank is Grand Tree 1F (open, no quest gate)'
    ),
    mine(
        'Desert Mining Camp',
        // NE mithril/addy pocket past the wrought-iron gate (doors 3322–3323,9448).
        // 3325,9456 was almost on the rocks — small W/N stand nudge.
        // Surface door 3301,3036 — gather bot does not auto-enter.
        new Tile(3323, 9458, 0),
        BANK.shantay,
        ['mithril', 'adamantite'],
        'Underground NE rocks after Tourist Trap; not auto-entered from surface'
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
        // Rune rocks ~2919,9917 / 2925,9909 — another +10 east of 2920 stand.
        new Tile(2930, 9911, 0),
        BANK.seers,
        ['runite'],
        "Requires Heroes' Quest; basement rune rocks east of ladder"
    ),
    // #160 tick-manip iron camps — verified:false until live polish.
    mine(
        'Legends Guild Iron (west)',
        // Iron cluster west of Legends Guild ~2691–2697, 3328–3334.
        new Tile(2694, 3331, 0),
        BANK.ardougneEast,
        ['iron'],
        'Tick manip: iron cadence (3-rock). Unverified seed; bank Ardougne East.',
        false
    ),
    mine(
        'Legends Guild Iron (east)',
        // Iron cluster east of Legends Guild ~2710–2715, 3328–3332.
        new Tile(2712, 3330, 0),
        BANK.ardougneEast,
        ['iron'],
        'Tick manip: iron cadence (3-rock). Unverified seed; bank Ardougne East.',
        false
    )
];

export const MINING_LOCATION_OPTIONS = locationOptions(MINING_LOCATIONS);

export function resolveMiningLocation(setting: string, startTile: WorldTile): MiningLocation | null {
    return resolveGatheringLocation(setting, startTile, MINING_LOCATIONS);
}
