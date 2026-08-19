import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from '../geometry/Tile.js';
import {
    locationOptions,
    resolveGatheringLocation,
    type GatheringLocation
} from './gatheringLocations.js';

/**
 * Mining camps for GatheringBot / Miner, catalogued from rs2b2tgathering.csv and polished via live verify and visual stand checks.
 * `recommendedCombat` is 2× the highest auto-aggressive NPC combat level + 1 (King Scorpion 32 → 65), omitted when no resident aggro is expected.
 */
export type MiningLocation = GatheringLocation & {
    /** Combat level at which resident aggressive NPCs stop auto-attacking (2×L+1). */
    recommendedCombat?: number;
};

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
    shantay: new Tile(3308, 3120, 0),
    grandTree: new Tile(2449, 3482, 1)
} as const;

function mine(
    name: string,
    spot: Tile,
    bankStand: Tile,
    resources: readonly string[],
    notes?: string,
    verified = true,
    recommendedCombat?: number
): MiningLocation {
    return {
        name,
        spot,
        bankStand,
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified,
        resources,
        notes,
        recommendedCombat
    };
}

/** UI label: "Dwarven Mine (65 Combat recommended)" when a rec is set. */
export function miningLocationLabel(loc: Pick<MiningLocation, 'name' | 'recommendedCombat'>): string {
    return loc.recommendedCombat != null
        ? `${loc.name} (${loc.recommendedCombat} Combat recommended)`
        : loc.name;
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
        'Underground seed; surface hop ~3019,3449',
        true,
        // King Scorpion 32 → 2×32+1
        65
    ),
    mine(
        'Edgeville Dungeon Mine',
        // Clear west-side stand beside the 3134–3143,9868–9880 mixed-rock field.
        // Navigation enters through the public Edgeville trapdoor when no Brass key is held, opens the two dungeon gates, and returns by the exit ladder.
        new Tile(3132, 9874, 0),
        BANK.edgeville,
        ['copper', 'tin', 'iron', 'coal', 'silver', 'mithril', 'adamantite'],
        'Underground; public Edgeville trapdoor route, no Brass key required',
        true,
        // Hobgoblin 42 → 2×42+1
        85
    ),
    mine(
        'Fight Arena Mine',
        // Adjacent stand: 2630,3145 is inside a rock loc.
        new Tile(2631, 3146, 0),
        BANK.ardougneEast,
        ['iron', 'mithril']
    ),
    mine(
        'Al Kharid Mine',
        // 3299,3297 sits inside a scenery object, so stand 2N.
        new Tile(3299, 3299, 0),
        BANK.alKharid,
        ['iron', 'silver', 'mithril', 'adamantite'],
        undefined,
        true,
        // Scorpion 14 → 2×14+1
        29
    ),
    mine(
        'Mining Guild',
        new Tile(3025, 9735, 0),
        BANK.faladorEast,
        ['iron', 'coal', 'mithril'],
        'Requires Mining 60; underground guild seed'
        // Inside guild door — no resident aggro; no combat rec.
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
        'West of Seers; seed spot',
        true,
        // Giant bat 27 → 2×27+1
        55
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
        // Adjacent stand: 2732,3223 is inside a rock loc.
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
        // Why: the classic west-coast seed is blue void on this engine, so the live mineable cluster is the east-swamp rocks near Urhney (~3233–3243, 3157–3167).
        // Stand a couple of tiles south of the rock tile to stay outside the loc.
        new Tile(3235, 3163, 0),
        BANK.draynor,
        ['mithril', 'adamantite'],
        'East swamp rock cluster (west coast unloaded/void on this map)'
    ),
    mine(
        'Grand Tree Mine',
        // Rocks at ~2472,9905; stand a few tiles north of 2465,9905.
        new Tile(2465, 9909, 0),
        BANK.grandTree,
        ['adamantite'],
        'Requires Grand Tree quest; bank is Grand Tree 1F (open, no quest gate)'
    ),
    mine(
        'Desert Mining Camp',
        // Why: this anchor keeps both the west copper/tin and northeast mithril/addy clusters inside the named-camp leash.
        new Tile(3323, 9458, 0),
        BANK.shantay,
        ['copper', 'tin', 'mithril', 'adamantite'],
        'Underground rocks; requires completed Tourist Trap, camp keys and slave gear',
        true,
        // Guard/Mercenary 45 → 2×45+1. Route food mitigates damage but does not make low combat safe.
        91
    ),
    mine(
        'Desert Mining Camp Surface',
        // Why: stand between the four coal rocks so iron/copper west and tin north stay inside the camp leash.
        new Tile(3293, 3016, 0),
        BANK.shantay,
        ['copper', 'tin', 'iron', 'coal'],
        'Surface rocks inside the camp; requires completed Tourist Trap and Metal key',
        true,
        // Guard/Mercenary 45 → 2×45+1. Same camp as the underground mine.
        91
    ),
    mine(
        'Lava Maze Runite Mine',
        new Tile(3058, 3884, 0),
        BANK.edgeville,
        ['runite'],
        'Wilderness — high risk; bank out at Edgeville',
        true,
        // Deadly red spider 34 → 2×34+1 (wildy may stay aggressive regardless)
        69
    ),
    mine(
        'Wilderness Hobgoblin Mine',
        // Level 30 Wilderness mine. This south-east stand is on walkable ground
        // among the broad iron/coal/mithril/adamantite rock field.
        new Tile(3093, 3751, 0),
        BANK.edgeville,
        ['iron', 'coal', 'mithril', 'adamantite'],
        'Wilderness — aggressive Hobgoblins; bank out at Edgeville',
        true,
        // Hobgoblin 28 → 2×28+1 (wildy may stay aggressive regardless)
        57
    ),
    mine(
        'Wilderness Skeleton Mine',
        // Walkable centre stand in the level-10 Wilderness coal field. The 34
        // coal-rock placements span 3009–3023,3586–3598 around this point.
        new Tile(3018, 3590, 0),
        BANK.edgeville,
        ['coal'],
        'Wilderness — aggressive Skeletons; bank out at Edgeville',
        true,
        // Skeleton 22 → 2×22+1 (wildy may stay aggressive regardless)
        45
    ),
    mine(
        'Heroes Guild',
        // Rune rocks ~2919,9917 / 2925,9909 — another +10 east of 2920 stand.
        new Tile(2930, 9911, 0),
        BANK.seers,
        ['runite'],
        "Requires Heroes' Quest; basement rune rocks east of ladder"
    ),
    mine(
        'South-east Ardougne Mine',
        // Monastery mine south of East Ardougne (~2621,3212). Members-only; ring of
        // iron/coal around the sewer entrance. Seed unverified — needs live polish.
        new Tile(2597, 3233, 0),
        BANK.ardougneEast,
        ['iron', 'coal'],
        'Members; Monastery mine, iron + coal; seed unverified.',
        false
    ),
    // Tick-manip iron camps, unpolished until live checks (#160).
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
].sort((a, b) => a.name.localeCompare(b.name));

export const MINING_LOCATION_OPTIONS = locationOptions(MINING_LOCATIONS);

/** Persisted option value → UI label with combat rec where set. */
export const MINING_LOCATION_OPTION_LABELS: Record<string, string> = Object.fromEntries(
    MINING_LOCATIONS.filter(l => l.recommendedCombat != null).map(l => [l.name, miningLocationLabel(l)])
);

export function resolveMiningLocation(setting: string, startTile: WorldTile): MiningLocation | null {
    return resolveGatheringLocation(setting, startTile, MINING_LOCATIONS);
}
