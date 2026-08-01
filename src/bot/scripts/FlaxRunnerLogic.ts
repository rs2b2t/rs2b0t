import Tile from '../api/Tile.js';

export const FLAX_FIELD = new Tile(2741, 3444, 0);
export const FLAX_GATE = new Tile(2736, 3443, 0);
export const SPINNING_WHEEL_AREA = new Tile(2711, 3471, 1);
export const BANK_ENTRANCE = new Tile(2726, 3487, 0);
export const BANK_STAND = new Tile(2725, 3493, 0);
/** Walkable stand tile inside the wheel house beside the ladder. */
export const LADDER_TILE = new Tile(2714, 3471, 0);
/**
 * Runner↔Spinner handoff tile — outside the wheel house, a few tiles east of the
 * east-wall door at (2716,3472). Meeting inside meant a closed door left partners
 * "at meet" (LEASH) but unable to trade or path through.
 */
export const MEET_TILE = new Tile(2719, 3471, 0);

export const TRADE_RANGE = 2;

export const FLAX = 'Flax';
export const BOW_STRING = 'Bow string';
export const SPINNING_WHEEL = 'Spinning wheel';
export const SPIN_OP = 'Spin';
export const PICK_OP = 'Pick';
export const BOOTH_NAME = 'Bank booth';
export const LADDER_NAME = 'Ladder';
export const CLIMB_UP = 'Climb-up';
export const CLIMB_DOWN = 'Climb-down';

export const FIELD_SCOPE = 12;
export const FIELD_ARRIVE = 3;

/** Prefer flax within this Chebyshev distance before considering farther plants. */
export const LOCAL_PICK_RADIUS = 4;
/** Reachable-tile BFS cap when detecting a flax enclosure. */
export const POCKET_CAP = 40;
/** Flax to drop so we can pick a path through solid plants. */
export const CARVE_DROP = 5;
