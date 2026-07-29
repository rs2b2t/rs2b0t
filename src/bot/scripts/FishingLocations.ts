import type { WorldTile } from '../adapter/ClientAdapter.js';
import { Area } from '../api/Area.js';
import Tile from '../api/Tile.js';

export interface FishingLocation {
    name: string;
    spot: Tile;
    region: Area;
    bankStand: Tile;
    boothName: string;
    boothOp: string;
    verified: boolean;

    rangeStand?: Tile;
    rangeName?: string;

    obstacles?: string[];
}

export const FISHING_LOCATIONS: FishingLocation[] = [
    {
        name: 'Draynor Village',
        spot: new Tile(3086, 3231, 0),
        region: Area.rectangular(new Tile(3070, 3210, 0), new Tile(3130, 3260, 0)),
        bankStand: new Tile(3092, 3243, 0),
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: true

    },
    {
        name: 'Barbarian Village',
        spot: new Tile(3104, 3430, 0),
        region: Area.rectangular(new Tile(3080, 3420, 0), new Tile(3120, 3500, 0)),
        bankStand: new Tile(3094, 3494, 0),
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: false
    },
    {
        name: 'Catherby',
        spot: new Tile(2846, 3429, 0),
        region: Area.rectangular(new Tile(2800, 3410, 0), new Tile(2870, 3445, 0)),
        bankStand: new Tile(2809, 3441, 0),
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: false,
        rangeStand: new Tile(2817, 3443, 0),
        rangeName: 'Range',
        obstacles: ['door', 'gate']
    },
    {
        name: 'Fishing Guild',
        spot: new Tile(2603, 3417, 0),
        region: Area.rectangular(new Tile(2585, 3400, 0), new Tile(2630, 3435, 0)),
        bankStand: new Tile(2586, 3420, 0),
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: false

    },
    {


        name: 'Taverley Dungeon (lava eels)',
        spot: new Tile(2884, 9767, 0),
        region: Area.rectangular(new Tile(2865, 9745, 0), new Tile(2905, 9790, 0)),
        bankStand: new Tile(2946, 3368, 0),
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: false
    }
];

export const LOCATION_OPTIONS = ['Auto', ...FISHING_LOCATIONS.map(l => l.name), 'None'];

export function resolveLocation(setting: string, startTile: WorldTile): FishingLocation | null {
    if (setting.toLowerCase() === 'auto') {
        return FISHING_LOCATIONS.find(l => l.region.contains(startTile)) ?? null;
    }
    return FISHING_LOCATIONS.find(l => l.name.toLowerCase() === setting.toLowerCase()) ?? null;
}
