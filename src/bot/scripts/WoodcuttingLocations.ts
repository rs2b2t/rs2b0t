import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from '../api/Tile.js';
import {
    locationOptions,
    resolveGatheringLocation,
    type GatheringLocation
} from './GatheringLocations.js';

/**
 * Woodcutting camps for GatheringBot / Woodcutter.
 *
 * Catalog from rs2b2tgathering.csv. Tree-cluster spots are seed data — banks are
 * known. Burn strips stay in FiremakingLogic (`fireSpot`); this table is chop
 * anchor + bank only. Run `bun tools/verify-gathering-locations.ts woodcutting`.
 */
export type WoodcuttingLocation = GatheringLocation;

const BANK = {
    draynor: new Tile(3093, 3243, 0),
    seers: new Tile(2725, 3491, 0),
    edgeville: new Tile(3094, 3493, 0),
    ardougneWest: new Tile(2616, 3332, 0)
} as const;

function camp(
    name: string,
    spot: Tile,
    bankStand: Tile,
    resources: readonly string[],
    notes?: string
): WoodcuttingLocation {
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
        new Tile(2726, 3476, 0),
        BANK.seers,
        ['logs'],
        'South of Seers bank'
    ),
    camp(
        'Seers Oaks',
        new Tile(2730, 3470, 0),
        BANK.seers,
        ['oak'],
        'South of Seers bank'
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
        new Tile(2735, 3462, 0),
        BANK.seers,
        ['yew'],
        'Cemetery south of Seers bank'
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
        BANK.ardougneWest,
        ['magic'],
        'No GS bank in BANK_LOCATIONS — Ardougne West fallback'
    )
];

export const WOODCUTTING_LOCATION_OPTIONS = locationOptions(WOODCUTTING_LOCATIONS);

export function resolveWoodcuttingLocation(
    setting: string,
    startTile: WorldTile
): WoodcuttingLocation | null {
    return resolveGatheringLocation(setting, startTile, WOODCUTTING_LOCATIONS);
}
