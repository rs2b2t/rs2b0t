import Tile from '../../geometry/Tile.js';

export interface SpotStand {
    /** The water tile the spot teleports to. */
    spot: Tile;
    /** The village-side bank tile beside it. */
    stand: Tile;
}

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

/** Bank tiles to look for spots from; together they put every fishable spot tile inside npc view range. */
export const SCAN_STANDS: readonly Tile[] = [
    new Tile(2857, 2972, 0),
    new Tile(2841, 2970, 0),
    new Tile(2822, 2968, 0)
];
