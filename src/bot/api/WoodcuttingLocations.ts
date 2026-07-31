import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from './Tile.js';
import {
    locationOptions,
    resolveGatheringLocation,
    type GatheringLocation
} from './GatheringLocations.js';

/**
 * Woodcutting camps for GatheringBot / Woodcutter.
 *
 * Catalog from rs2b2tgathering.csv, polished via live verify + visual stand checks.
 * Burn strips stay in FiremakingLogic (`fireSpot`); this table is chop anchor + bank.
 * All entries ship `verified: true` after pathability/resource confirmation.
 */
export type WoodcuttingLocation = GatheringLocation;

const BANK = {
    draynor: new Tile(3093, 3243, 0),
    seers: new Tile(2725, 3491, 0),
    edgeville: new Tile(3094, 3493, 0),
    faladorWest: new Tile(2946, 3369, 0),
    ardougneWest: new Tile(2616, 3332, 0),
    grandTree: new Tile(2449, 3482, 1)
} as const;

function camp(
    name: string,
    spot: Tile,
    bankStand: Tile,
    resources: readonly string[],
    notes?: string,
    verified = true
): WoodcuttingLocation {
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

export const WOODCUTTING_LOCATIONS: WoodcuttingLocation[] = [
    camp(
        'Draynor (trees)',
        new Tile(3098, 3242, 0),
        BANK.draynor,
        ['logs'],
        'Normal trees near Draynor bank'
    ),
    camp(
        'Draynor Oaks',
        new Tile(3105, 3245, 0),
        BANK.draynor,
        ['oak'],
        'East of Draynor bank'
    ),
    camp(
        'Draynor Willows',
        new Tile(3087, 3234, 0),
        BANK.draynor,
        ['willow'],
        'Southwest of Draynor bank'
    ),
    camp(
        'Seers (trees)',
        // Couple tiles WSW of prior 2726,3476 seed.
        new Tile(2724, 3474, 0),
        BANK.seers,
        ['logs'],
        'South of Seers bank'
    ),
    camp(
        'Seers Oaks',
        // ~3–5 south of prior bank-door stand (2721,3487).
        new Tile(2721, 3483, 0),
        BANK.seers,
        ['oak'],
        'Just SW/S of Seers bank door'
    ),
    camp(
        'Seers Willows',
        new Tile(2711, 3500, 0),
        BANK.seers,
        ['willow'],
        'Northwest of Seers bank'
    ),
    camp(
        'Seers Maples',
        new Tile(2728, 3501, 0),
        BANK.seers,
        ['maple'],
        'North of Seers bank'
    ),
    camp(
        'Seers Yews (cemetery)',
        // Previous 2735,3462 was party-room area; church/cemetery is further SW.
        new Tile(2708, 3462, 0),
        BANK.seers,
        ['yew'],
        'Church/cemetery SW of Seers (not party room)'
    ),
    camp(
        'Edgeville Yews',
        new Tile(3087, 3470, 0),
        BANK.edgeville,
        ['yew'],
        'South of Edgeville bank'
    ),
    camp(
        "Sorcerer's Tower",
        new Tile(2702, 3398, 0),
        BANK.seers,
        ['magic'],
        'Magic trees south of Sorcerer\'s Tower / far south of Seers'
    ),
    camp(
        'Gnome Stronghold',
        new Tile(2434, 3425, 0),
        BANK.grandTree,
        ['magic'],
        'Bank is Grand Tree 1F booths (open, no quest gate) — seed stand'
    ),
    // #160 tick-manip camps — verified:false until live path/resource polish.
    camp(
        'S Falador Oaks',
        // Oaks south of Falador walls (~2949–3002, 3267–3314). Chickens ~2966,3346 for 2t retaliate.
        new Tile(2976, 3290, 0),
        BANK.faladorWest,
        ['oak'],
        'Tick manip: 2t retaliate oaks (chickens nearby). Unverified seed.',
        false
    ),
    camp(
        'Lumbridge Farmer Willows',
        // Sheep-farm willows + farmer (~3221,3290 / farmer ~3227,3290). Bank Draynor.
        new Tile(3221, 3290, 0),
        BANK.draynor,
        ['willow'],
        'Tick manip: 3t farmer willows (6-tick cycle). Unverified seed.',
        false
    ),
    camp(
        'Lumbridge Castle Willows',
        // Castle willows ~3233–3234, 3238–3244 + rats for retaliate methods.
        new Tile(3233, 3241, 0),
        BANK.draynor,
        ['willow'],
        'Tick manip: 3t shortbow rapid / retaliate willows. Unverified seed.',
        false
    )
];

export const WOODCUTTING_LOCATION_OPTIONS = locationOptions(WOODCUTTING_LOCATIONS);

export function resolveWoodcuttingLocation(
    setting: string,
    startTile: WorldTile
): WoodcuttingLocation | null {
    return resolveGatheringLocation(setting, startTile, WOODCUTTING_LOCATIONS);
}
