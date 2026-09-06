import Tile from '../../geometry/Tile.js';

export interface SpotStand {
    /** The water tile the spot teleports to. */
    spot: Tile;
    /** The bank tile beside it that the pack paths to. */
    stand: Tile;
    /** The stand is across the water, an 74 to 90 walk round against the 14 to 56 along the village bank. */
    far?: boolean;
}

/** The stretch of river a spot is fished from, both banks, west end to east end. */
export const SEARCH_AREA = { minX: 2820, maxX: 2871, minZ: 2966, maxZ: 2980 } as const;

// Why: `fishing_movement.enum` sends a Shilo spot to one of ten river tiles every 280 to 530 ticks and the map spawns three more, and `bun tools/nav/shilo-fishing-stands.ts` costs each stand from Fernahei's counter; the four the walker only reaches by going round are marked rather than dropped, since a spot lives three to five minutes and the walk round is under a minute.
/** Every tile a Shilo fly spot can occupy, with the bank tile it is fished from, west to east. */
export const SPOT_STANDS: readonly SpotStand[] = [
    { spot: new Tile(2822, 2969, 0), stand: new Tile(2822, 2968, 0) },
    { spot: new Tile(2834, 2974, 0), stand: new Tile(2834, 2975, 0) },
    { spot: new Tile(2835, 2974, 0), stand: new Tile(2835, 2975, 0) },
    { spot: new Tile(2836, 2971, 0), stand: new Tile(2836, 2970, 0) },
    { spot: new Tile(2841, 2971, 0), stand: new Tile(2841, 2970, 0) },
    { spot: new Tile(2850, 2976, 0), stand: new Tile(2850, 2977, 0), far: true },
    { spot: new Tile(2855, 2973, 0), stand: new Tile(2855, 2972, 0) },
    { spot: new Tile(2855, 2977, 0), stand: new Tile(2855, 2978, 0), far: true },
    { spot: new Tile(2856, 2973, 0), stand: new Tile(2856, 2972, 0) },
    { spot: new Tile(2857, 2973, 0), stand: new Tile(2857, 2972, 0) },
    { spot: new Tile(2860, 2976, 0), stand: new Tile(2860, 2977, 0), far: true },
    { spot: new Tile(2862, 2972, 0), stand: new Tile(2862, 2971, 0) },
    { spot: new Tile(2869, 2977, 0), stand: new Tile(2869, 2978, 0), far: true }
];

// Why: a spot is in the client's npc list only within about fifteen tiles, so the stops sit a view apart along the village bank and the walk between two of them is a few tiles rather than the length of the river.
/** The bank tiles the search walks between, east end to west end and back again. */
export const SWEEP: readonly Tile[] = [
    new Tile(2862, 2971, 0),
    new Tile(2856, 2972, 0),
    new Tile(2841, 2970, 0),
    new Tile(2836, 2970, 0),
    new Tile(2822, 2968, 0),
    new Tile(2836, 2970, 0),
    new Tile(2841, 2970, 0),
    new Tile(2856, 2972, 0)
];
