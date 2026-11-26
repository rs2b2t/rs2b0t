import Tile from '../../../../geometry/Tile.js';

export interface JungleHerb {
    /** Every unid renders "Unidentified herb", so the pick is proved by id. */
    unidId: number;
    id: number;
    name: string;
    loc: string;
    stand: Tile;
}

export const SNAKE_WEED = {
    unidId: 1525,
    id: 1526,
    name: 'Snake weed',
    loc: 'Marshy jungle vine',
    stand: new Tile(2761, 3015, 0)
} as const;

export const ARDRIGAL = {
    unidId: 1527,
    id: 1528,
    name: 'Ardrigal',
    loc: 'Palm tree',
    stand: new Tile(2869, 3115, 0)
} as const;
