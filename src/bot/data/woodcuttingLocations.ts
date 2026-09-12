import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from '../geometry/Tile.js';
import {
    locationOptions,
    resolveGatheringLocation,
    type GatheringLocation
} from './gatheringLocations.js';

/** Woodcutting camps from rs2b2tgathering.csv and live checks. Burn strips remain in FiremakingLogic. */
export type WoodcuttingLocation = GatheringLocation;

/**
 * Ent NPCs from macro_event_ent: IDs 444-452; 453 is a suit of armour.
 * Why: Ents share tree names and Chop down actions, so match by ID.
 */
export const ENT_NPC_IDS: Set<number> = new Set([444, 445, 446, 447, 448, 449, 450, 451, 452]);

/** Ent despawn timer in ticks. Same length as a smoking rock. */
export const ENT_LIFE_TICKS = 60;

export function isEntNpcId(id: number): boolean {
    return ENT_NPC_IDS.has(id);
}

export function entNpcOnTile(
    npcs: readonly { id: number; tile: { x: number; z: number; level: number } }[],
    tile: { x: number; z: number; level: number }
): boolean {
    return npcs.some(
        n => isEntNpcId(n.id) && n.tile.x === tile.x && n.tile.z === tile.z && n.tile.level === tile.level
    );
}

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
        new Tile(2724, 3474, 0),
        BANK.seers,
        ['logs'],
        'South of Seers bank'
    ),
    camp(
        'Seers Oaks',
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
    // Tick-manip camps, unpolished until live path/resource checks (#160).
    camp(
        'S Falador Oaks',
        // Oaks south of Falador walls (about 2949 to 3002, 3267 to 3314). Chickens near 2966,3346 for 2t retaliate.
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
        // Castle willows 3233 to 3234, 3238 to 3244, plus rats for retaliate methods.
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
