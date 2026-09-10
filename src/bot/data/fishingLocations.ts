import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from '../geometry/Tile.js';

export const SHILO_WATER_VENDOR = { keeper: 'Obli', stand: new Tile(2825, 2959, 0), item: 'Vial of water' } as const;
import { cookSurfaceForFishCamp } from './cookingRanges.js';
import {
    locationOptions,
    resolveGatheringLocation,
    type GatheringLocation
} from './gatheringLocations.js';

/**
 * Fishing camps for GatheringBot / Fisher, catalogued from rs2b2tgathering.csv plus legacy presets and polished via live verify and visual stand checks.
 * Cook surfaces ({@link rangeStand}) come from {@link CookingRanges} when a Range/Fire is within a useful walk of the pier (Catherby, Seers fly, Barb fires, …).
 */
export interface FishingLocation extends GatheringLocation {
    rangeStand?: Tile;
    rangeName?: string;
}

function withCampCook(loc: FishingLocation): FishingLocation {
    if (loc.rangeStand) {
        return loc;
    }
    // Default pin is pier surface (cook-then-bank). bank-raw-then-cook re-resolves
    // at runtime via resolveCookScene + CookSurfaceRole 'bank'.
    const cook = cookSurfaceForFishCamp(loc.name, 'pier');
    if (!cook) {
        return loc;
    }
    return {
        ...loc,
        rangeStand: cook.stand,
        rangeName: cook.locName,
        obstacles: loc.obstacles ?? ['door', 'gate'],
        notes: [loc.notes, cook.notes ? `cook: ${cook.label ?? cook.locName}` : null]
            .filter(Boolean)
            .join('; ')
    };
}

const BANK = {
    draynor: new Tile(3093, 3243, 0),
    catherby: new Tile(2809, 3441, 0),
    fishingGuild: new Tile(2586, 3420, 0),
    edgeville: new Tile(3094, 3493, 0),
    seers: new Tile(2725, 3491, 0),
    faladorWest: new Tile(2946, 3369, 0),
    grandTree: new Tile(2449, 3482, 1),
    shilo: new Tile(2852, 2954, 0)
} as const;

export const FISHING_LOCATIONS: FishingLocation[] = (
    [
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
            // Shore stand: 2846,3429 sits on the fishing-spot tile, in water.
            spot: new Tile(2845, 3431, 0),
            bankStand: BANK.catherby,
            boothName: 'Bank booth',
            boothOp: 'Use-quickly',
            // Long shore hops: spots reach past ~72, beyond the old pin-disk radius.
            campRadius: 80,
            chaseRadius: 28,
            verified: true,
            resources: ['mackerel', 'cod', 'bass', 'tuna', 'lobster', 'swordfish', 'shark'],
            // rangeStand filled by withCampCook (Catherby bank-house Range)
            obstacles: ['door', 'gate']
        },
        {
            name: 'Fishing Guild',
            // Dock walkway, previous 2603,3417 was unpathable dock-center over water.
            spot: new Tile(2604, 3420, 0),
            bankStand: BANK.fishingGuild,
            boothName: 'Bank booth',
            boothOp: 'Use-quickly',
            campRadius: 80,
            chaseRadius: 28,
            verified: true,
            resources: ['mackerel', 'cod', 'bass', 'tuna', 'lobster', 'swordfish', 'shark'],
            baitVendor: { keeper: 'Roachey', stand: new Tile(2596, 3399, 0), price: 2, item: 'Feather' },
            notes: 'Bank requires Fishing 68'
        },
        {
            name: 'Barbarian Village',
            spot: new Tile(3104, 3430, 0),
            bankStand: BANK.edgeville,
            boothName: 'Bank booth',
            boothOp: 'Use-quickly',
            campRadius: 72,
            chaseRadius: 28,
            verified: true,
            resources: ['trout', 'salmon', 'pike'],
            notes: 'Fly/bait river'
        },
        {
            name: 'Seers (fly fishing)',
            // Pathable shore stand (2716,3532), do not offset into the river.
            spot: new Tile(2716, 3532, 0),
            bankStand: BANK.seers,
            boothName: 'Bank booth',
            boothOp: 'Use-quickly',
            campRadius: 80,
            chaseRadius: 28,
            verified: true,
            resources: ['trout', 'salmon', 'pike'],
            // Sinclair range approach: Gate + Door + Large door (walkOpening).
            obstacles: ['door', 'gate'],
            notes: 'River north of Seers toward Rellekka; shore stand'
        },
        {
            name: 'Karamja (Musa Point)',
            // Near Luthas / cage-harpoon pier (ship landing ~2956,3143)
            spot: new Tile(2924, 3178, 0),
            bankStand: BANK.draynor,
            boothName: 'Bank booth',
            boothOp: 'Use-quickly',
            campRadius: 72,
            chaseRadius: 28,
            verified: true,
            resources: ['tuna', 'lobster', 'swordfish'],
            notes: 'No local bank — deposit via ship to Draynor / Port Sarim area'
        },
        {
            name: 'Taverley Dungeon (lava eels)',
            spot: new Tile(2884, 9767, 0),
            bankStand: BANK.faladorWest,
            boothName: 'Bank booth',
            boothOp: 'Use-quickly',
            verified: true,
            resources: ['lava eel'],
            notes: 'Dungeon spot; surface bank at Falador West'
        },
        // Seed camp; stays unverified until live polish (#160).
        {
            name: 'Gnome Stronghold (fishing)',
            spot: new Tile(2388, 3420, 0),
            bankStand: BANK.grandTree,
            boothName: 'Bank booth',
            boothOp: 'Use-quickly',
            campRadius: 72,
            chaseRadius: 28,
            verified: false,
            resources: ['trout', 'salmon'],
            notes: 'Tick manip: Tannerfishing (fly + cook/eat). Unverified seed; bank Grand Tree 1F'
        },
        {
            name: 'Shilo Village',
            spot: new Tile(2841, 2970, 0),
            bankStand: BANK.shilo,
            campRadius: 48,
            chaseRadius: 28,
            verified: false,
            resources: ['trout', 'salmon'],
            avoidSpots: [
                new Tile(2850, 2976, 0),
                new Tile(2855, 2977, 0),
                new Tile(2860, 2976, 0),
                new Tile(2869, 2977, 0)
            ],
            sweep: [
                new Tile(2862, 2971, 0),
                new Tile(2856, 2972, 0),
                new Tile(2841, 2970, 0),
                new Tile(2836, 2970, 0),
                new Tile(2822, 2968, 0)
            ],
            baitVendor: { keeper: 'Fernahei', stand: new Tile(2870, 2971, 0), price: 2, item: 'Feather' },
            notes: 'Requires Shilo Village quest; fly only, the teller banks and Fernahei sells the feathers.'
        }
    ] as FishingLocation[]
).map(withCampCook);

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
