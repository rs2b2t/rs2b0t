import Tile from '../../geometry/Tile.js';

/** Verified iron camps; anchors are the stand tiles probed by `e2e/power-miner/probe.ts`. */
export type CampRock = { x: number; z: number };

export type PowerMineCamp = {
    name: string;
    anchor: Tile;
    /** Search radius for the live-rock query. */
    radius: number;
    /** Iron rocks for the manual route order. */
    rocks?: readonly CampRock[];
    note?: string;
};

export const POWER_MINE_CAMPS: readonly PowerMineCamp[] = [
    {
        name: 'Legends Guild Iron (east)',
        // 6 iron; 5-rock nav cycle (1.0 travel/click, far-west rock excluded).
        // Measured 42k/hr at the local ~18t respawn and 50.4k at ~6t.
        anchor: new Tile(2714, 3331, 0),
        // 4 includes the far-west 2710,3328 for the 6-rock quiet route.
        radius: 4,
        rocks: [
            { x: 2714, z: 3330 },
            { x: 2715, z: 3331 },
            { x: 2713, z: 3332 },
            { x: 2712, z: 3329 },
            { x: 2711, z: 3329 },
            { x: 2710, z: 3328 },
        ],
    },
    {
        name: 'Legends Guild Iron (west)',
        // 2 iron within 2, 5 within 3.
        anchor: new Tile(2692, 3329, 0),
        radius: 5,
        rocks: [
            { x: 2692, z: 3328 },
            { x: 2691, z: 3329 },
            { x: 2693, z: 3329 },
            { x: 2696, z: 3333 },
            { x: 2697, z: 3334 },
        ],
    },
    {
        name: 'Rellekka Mine',
        // 9 iron + 2 mithril east of Rellekka, no monsters. 2724,3695 has 3 adjacent.
        // Quiet alternative: nav cycle 1.6 travel/click, ~38k/hr normalized local.
        anchor: new Tile(2724, 3695, 0),
        radius: 4,
        rocks: [
            { x: 2722, z: 3695 },
            { x: 2723, z: 3692 },
            { x: 2723, z: 3695 },
            { x: 2723, z: 3696 },
            { x: 2724, z: 3688 },
            { x: 2725, z: 3691 },
            { x: 2725, z: 3694 },
            { x: 2727, z: 3692 },
            { x: 2728, z: 3695 },
        ],
    },
    {
        name: 'Wilderness Hobgoblin Mine',
        // Dense field, but the player drifts and the self-tuner climbs to 6t;
        // measured ~31k. Wilderness: aggressive hobgoblins, auto-retaliate off.
        anchor: new Tile(3100, 3767, 0),
        radius: 3,
        rocks: [
            { x: 3099, z: 3765 },
            { x: 3099, z: 3766 },
            { x: 3099, z: 3767 },
            { x: 3099, z: 3768 },
            { x: 3100, z: 3765 },
            { x: 3100, z: 3766 },
            { x: 3101, z: 3765 },
            { x: 3101, z: 3768 },
        ],
        note: 'Wilderness — aggressive hobgoblins; no banking, drop only'
    },
    {
        name: 'Fight Arena Mine',
        // 4 iron within 5 of the south stand.
        anchor: new Tile(2631, 3146, 0),
        radius: 6,
        rocks: [
            { x: 2625, z: 3150 },
            { x: 2625, z: 3151 },
            { x: 2626, z: 3149 },
            { x: 2626, z: 3150 },
            { x: 2627, z: 3142 },
            { x: 2628, z: 3140 },
            { x: 2628, z: 3141 },
        ],
    },
    {
        name: 'Southeast Varrock Mine',
        // 3 iron within 3; a fallback when the guild is busy.
        anchor: new Tile(3285, 3366, 0),
        radius: 4,
        rocks: [
            { x: 3285, z: 3368 },
            { x: 3285, z: 3369 },
            { x: 3286, z: 3369 },
            { x: 3288, z: 3370 },
        ],
    }
] as const;

export const CUSTOM_LOCATION = 'Use Custom Position';

export const POWER_MINE_LOCATION_OPTIONS: readonly string[] = [
    ...POWER_MINE_CAMPS.map(camp => camp.name),
    CUSTOM_LOCATION
];

export const POWER_MINE_RADIUS = 6;

/** Anchor for the chosen setting; unknown names fall back to the custom tile. */
export function resolvePowerMineAnchor(setting: string, custom: Tile): Tile {
    if (setting === CUSTOM_LOCATION) {
        return custom;
    }
    return POWER_MINE_CAMPS.find(camp => camp.name === setting)?.anchor ?? custom;
}

export function powerMineCamp(setting: string): PowerMineCamp | undefined {
    return POWER_MINE_CAMPS.find(camp => camp.name === setting);
}
