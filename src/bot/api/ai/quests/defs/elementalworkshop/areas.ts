import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot } from '../../engine/types.js';

export interface EwItem {
    id: number;
    name: string;
}

// Classic 2004 object ids (rs2b2t pack). Empty and full stone bowls both
// render as "A stone bowl", so every bowl check goes through id.
export const EW_ITEM = {
    BATTERED_BOOK: { id: 2886, name: 'Battered book' },
    BATTERED_KEY: { id: 2887, name: 'Battered key' },
    STONE_BOWL: { id: 2888, name: 'A stone bowl' },
    STONE_BOWL_FULL: { id: 2889, name: 'A stone bowl' },
    ELEMENTAL_SHIELD: { id: 2890, name: 'Elemental shield' },
    ELEMENTAL_ORE: { id: 2892, name: 'Elemental ore' },
    ELEMENTAL_METAL: { id: 2893, name: 'Elemental metal' },
    KNIFE: { id: 946, name: 'Knife' },
    NEEDLE: { id: 1733, name: 'Needle' },
    THREAD: { id: 1734, name: 'Thread' },
    LEATHER: { id: 1741, name: 'Leather' },
    COAL: { id: 453, name: 'Coal' },
    HAMMER: { id: 2347, name: 'Hammer' },
    COINS: { id: 995, name: 'Coins' }
} as const satisfies Record<string, EwItem>;

export const PICKAXES: readonly EwItem[] = [
    { id: 1275, name: 'Rune pickaxe' },
    { id: 1271, name: 'Adamant pickaxe' },
    { id: 1273, name: 'Mithril pickaxe' },
    { id: 1269, name: 'Steel pickaxe' },
    { id: 1267, name: 'Iron pickaxe' },
    { id: 1265, name: 'Bronze pickaxe' }
];

export const SEERS_BANK = new Tile(2725, 3491, 0);

// House south-west of Seers bank: bookcase on the east wall.
export const BOOKCASE = new Tile(2716, 3481, 0);
// House south of the smithy often has a ground Knife near the range.
export const KNIFE_SPAWN = new Tile(2714, 3477, 0);
// Outside the Seers smithy — walkable stand; the odd-looking wall tile itself is blocked.
export const SMITHY = new Tile(2709, 3499, 0);
// Spiral stairs land at 0_42_54_21_41 → (2709, 3497). Approach from the west.
export const STAIRS_TOP = new Tile(2708, 3497, 0);

// Spiral stairs land at 0_42_154_28_32 → (2716, 9888).
export const WORKSHOP_ARRIVAL = new Tile(2716, 9888, 0);
// West chamber approach — not the rock loc tile (that is unwalkable).
export const ROCK_STAND = new Tile(2705, 9888, 0);
export const WATER_STAND = new Tile(2719, 9904, 0);
export const BELLOWS_STAND = new Tile(2734, 9884, 0);
export const FURNACE_STAND = new Tile(2724, 9874, 0);
export const TROUGH_STAND = new Tile(2720, 9876, 0);
export const WORKBENCH_STAND = new Tile(2716, 9888, 0);
export const CRATE_HUB = new Tile(2718, 9892, 0);

const WORKSHOP_Z_MIN = 9850;
const WORKSHOP_Z_MAX = 9950;
const WORKSHOP_X_MIN = 2690;
const WORKSHOP_X_MAX = 2760;

type EwArea = 'workshop' | 'seers' | 'elsewhere' | 'unknown';

export function ewArea(tile: QuestSnapshot['tile']): EwArea {
    if (!tile) {
        return 'unknown';
    }
    if (
        tile.level === 0
        && tile.x >= WORKSHOP_X_MIN && tile.x <= WORKSHOP_X_MAX
        && tile.z >= WORKSHOP_Z_MIN && tile.z <= WORKSHOP_Z_MAX
    ) {
        return 'workshop';
    }
    if (tile.x >= 2680 && tile.x <= 2760 && tile.z >= 3460 && tile.z <= 3520) {
        return 'seers';
    }
    return 'elsewhere';
}
