import Tile from '../../geometry/Tile.js';

export interface SpotStand {
    /** The water tile the spot teleports to. */
    spot: Tile;
    /** The village-side bank tile beside it. */
    stand: Tile;
}

/** The stretch of river inside the village a spot is fished from, west end to east end. */
export const SEARCH_AREA = { minX: 2823, maxX: 2864, minZ: 2968, maxZ: 2976 } as const;

// Why: `fishing_movement.enum` sends a Shilo spot to one of ten river tiles every 280 to 530 ticks and the map spawns three more; `bun tools/nav/shilo-fishing-stands.ts` walks each from Fernahei's counter, and the four with only a far-bank neighbour (cost 74 to 90 against 14 to 56) are left out.
/** Every tile a Shilo fly spot can occupy that has a bank tile on the village side, west to east. */
export const SPOT_STANDS: readonly SpotStand[] = [
    { spot: new Tile(2822, 2969, 0), stand: new Tile(2822, 2968, 0) },
    { spot: new Tile(2834, 2974, 0), stand: new Tile(2834, 2975, 0) },
    { spot: new Tile(2835, 2974, 0), stand: new Tile(2835, 2975, 0) },
    { spot: new Tile(2836, 2971, 0), stand: new Tile(2836, 2970, 0) },
    { spot: new Tile(2841, 2971, 0), stand: new Tile(2841, 2970, 0) },
    { spot: new Tile(2855, 2973, 0), stand: new Tile(2855, 2972, 0) },
    { spot: new Tile(2856, 2973, 0), stand: new Tile(2856, 2972, 0) },
    { spot: new Tile(2857, 2973, 0), stand: new Tile(2857, 2972, 0) },
    { spot: new Tile(2862, 2972, 0), stand: new Tile(2862, 2971, 0) }
];

// Why: a spot is in the client's npc list only within view range, so the sweep stops where each stretch of the area comes into view and turns at both ends rather than bouncing between the two nearest stands.
/** The bank tiles the search walks between, in sweep order: east end, middle, west end, middle, and round again. */
export const SWEEP: readonly Tile[] = [
    new Tile(2862, 2971, 0),
    new Tile(2841, 2970, 0),
    new Tile(2823, 2968, 0),
    new Tile(2841, 2970, 0)
];
