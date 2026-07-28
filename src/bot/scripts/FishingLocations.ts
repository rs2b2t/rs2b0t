import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from '../api/Tile.js';
import {
    locationOptions,
    resolveGatheringLocation,
    type GatheringLocation
} from './GatheringLocations.js';

/**
 * Fishing camps for GatheringBot / Fisher.
 *
 * Seed catalog from rs2b2tgathering.csv + legacy presets. Run
 * `bun tools/verify-gathering-locations.ts fishing` before flipping verified.
 */
export interface FishingLocation extends GatheringLocation {
    rangeStand?: Tile;
    rangeName?: string;
}

const BANK = {
    draynor: new Tile(3093, 3243, 0),
    catherby: new Tile(2809, 3441, 0),
    fishingGuild: new Tile(2586, 3420, 0),
    edgeville: new Tile(3094, 3493, 0),
    seers: new Tile(2725, 3491, 0),
    faladorWest: new Tile(2946, 3369, 0)
} as const;

export const FISHING_LOCATIONS: FishingLocation[] = [
    {
        name: 'Draynor Village',
        spot: new Tile(3086, 3231, 0),
        bankStand: BANK.draynor,
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: true,
        resources: ['shrimp', 'anchovies', 'sardine', 'herring']
    },
    {
        name: 'Catherby',
        spot: new Tile(2846, 3429, 0),
        bankStand: BANK.catherby,
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: false,
        resources: ['mackerel', 'cod', 'bass', 'tuna', 'lobster', 'swordfish', 'shark'],
        rangeStand: new Tile(2817, 3443, 0),
        rangeName: 'Range',
        obstacles: ['door', 'gate']
    },
    {
        name: 'Fishing Guild',
        spot: new Tile(2603, 3417, 0),
        bankStand: BANK.fishingGuild,
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: false,
        resources: ['mackerel', 'cod', 'bass', 'tuna', 'lobster', 'swordfish', 'shark'],
        notes: 'Bank requires Fishing 68'
    },
    {
        name: 'Barbarian Village',
        spot: new Tile(3104, 3430, 0),
        bankStand: BANK.edgeville,
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: false,
        resources: ['trout', 'salmon', 'pike'],
        notes: 'Fly/bait river; seed spot — verify before marking verified'
    },
    {
        name: 'Seers (fly fishing)',
        spot: new Tile(2715, 3530, 0),
        bankStand: BANK.seers,
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: false,
        resources: ['trout', 'salmon', 'pike'],
        notes: 'River north of Seers toward Rellekka; seed spot'
    },
    {
        name: 'Karamja (Musa Point)',
        // Near Luthas / cage-harpoon pier (ship landing ~2956,3143)
        spot: new Tile(2924, 3178, 0),
        bankStand: BANK.draynor,
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: false,
        resources: ['tuna', 'lobster', 'swordfish'],
        notes: 'No local bank — deposit via ship to Draynor / Port Sarim area'
    },
    {
        name: 'Taverley Dungeon (lava eels)',
        spot: new Tile(2884, 9767, 0),
        bankStand: BANK.faladorWest,
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: false,
        resources: ['lava eel'],
        notes: 'Dungeon spot; surface bank at Falador West'
    }
];

export const FISHING_LOCATION_OPTIONS = locationOptions(FISHING_LOCATIONS);

/** @deprecated Use FISHING_LOCATION_OPTIONS */
export const LOCATION_OPTIONS = FISHING_LOCATION_OPTIONS;

export function resolveFishingLocation(setting: string, startTile: WorldTile): FishingLocation | null {
    return resolveGatheringLocation(setting, startTile, FISHING_LOCATIONS);
}

/** @deprecated Use resolveFishingLocation */
export function resolveLocation(setting: string, startTile: WorldTile): FishingLocation | null {
    return resolveFishingLocation(setting, startTile);
}
