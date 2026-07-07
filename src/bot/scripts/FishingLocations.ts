import type { WorldTile } from '../adapter/ClientAdapter.js';
import { Area } from '../api/Area.js';
import Tile from '../api/Tile.js';

/**
 * Known fishing locations for the Fisher preset's `location` dropdown. Each
 * row pairs a spot cluster with the bank that serves it: GatheringBot anchors
 * on `spot` and runs BankCatch trips to `bankStand` while a row is active.
 * `verified: false` rows are best-guess coordinates — selecting one logs a
 * warning until someone runs them through the spec's verification protocol.
 */
export interface FishingLocation {
    /** Dropdown value (the settings panel snaps to this string). */
    name: string;
    /** Spot-cluster center; the bot's anchor while the row is active. */
    spot: Tile;
    /** Region used by Auto detection (start-tile containment, level-aware). */
    region: Area;
    /** Tile adjacent to a bank booth; bank runs walk here. */
    bankStand: Tile;
    boothName: string;
    boothOp: string;
    /** false → coordinates unverified; warn on select. */
    verified: boolean;
}

export const FISHING_LOCATIONS: FishingLocation[] = [
    {
        name: 'Draynor Village',
        spot: new Tile(3086, 3231, 0),
        region: Area.rectangular(new Tile(3070, 3210, 0), new Tile(3130, 3260, 0)),
        bankStand: new Tile(3092, 3243, 0),
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: true // full cycle confirmed in-game (tools/fisher-banking-test.ts)
    },
    {
        name: 'Catherby',
        spot: new Tile(2846, 3429, 0),
        region: Area.rectangular(new Tile(2800, 3410, 0), new Tile(2870, 3445, 0)),
        bankStand: new Tile(2809, 3441, 0),
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: false
    },
    {
        name: 'Fishing Guild',
        spot: new Tile(2603, 3417, 0),
        region: Area.rectangular(new Tile(2585, 3400, 0), new Tile(2630, 3435, 0)),
        bankStand: new Tile(2586, 3420, 0),
        boothName: 'Bank booth',
        boothOp: 'Use-quickly',
        verified: false
    }
];

/** Dropdown values for the Fisher preset's `location` setting. */
export const LOCATION_OPTIONS = ['Auto', ...FISHING_LOCATIONS.map(l => l.name), 'None'];

/**
 * Resolve the `location` setting: 'Auto' = the first row whose region
 * contains the start tile; a name = that row (case-insensitive); anything
 * else ('None', absent key) = null.
 */
export function resolveLocation(setting: string, startTile: WorldTile): FishingLocation | null {
    if (setting.toLowerCase() === 'auto') {
        return FISHING_LOCATIONS.find(l => l.region.contains(startTile)) ?? null;
    }
    return FISHING_LOCATIONS.find(l => l.name.toLowerCase() === setting.toLowerCase()) ?? null;
}
