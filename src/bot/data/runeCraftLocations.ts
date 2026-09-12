import Tile from '../geometry/Tile.js';

export interface RuneRoute {
    rune: string;
    talisman: string;
    level: number;
    bank: string;
    ruins: Tile;
}

/* Rune altar locations decoded from `runecraft.dbrow`; `exit_coord` is level_chunkX_chunkZ_offsetX_offsetZ with 64-tile chunks. */
export const RUNES: Record<string, RuneRoute> = {
    'Air rune': {
        rune: 'Air rune',
        talisman: 'Air talisman',
        level: 1,
        bank: 'Falador East',
        ruins: new Tile(2983, 3288, 0)
    },
    'Mind rune': {
        rune: 'Mind rune',
        talisman: 'Mind talisman',
        level: 2,
        bank: 'Edgeville',
        ruins: new Tile(2980, 3511, 0)
    },
    'Water rune': {
        rune: 'Water rune',
        talisman: 'Water talisman',
        level: 5,
        bank: 'Draynor',
        ruins: new Tile(3182, 3162, 0)
    },
    'Earth rune': {
        rune: 'Earth rune',
        talisman: 'Earth talisman',
        level: 9,
        bank: 'Varrock East',
        ruins: new Tile(3303, 3477, 0)
    },
    'Fire rune': {
        rune: 'Fire rune',
        talisman: 'Fire talisman',
        level: 14,
        bank: 'Al Kharid',
        ruins: new Tile(3310, 3252, 0)
    },
    'Body rune': {
        rune: 'Body rune',
        talisman: 'Body talisman',
        level: 20,
        bank: 'Edgeville',
        ruins: new Tile(3050, 3442, 0)
    },
    'Cosmic rune': {
        rune: 'Cosmic rune',
        talisman: 'Cosmic talisman',
        level: 27,
        bank: 'Draynor',
        ruins: new Tile(3173, 9501, 0)
    },
    'Chaos rune': {
        rune: 'Chaos rune',
        talisman: 'Chaos talisman',
        level: 35,
        bank: 'Edgeville',
        ruins: new Tile(3060, 3585, 0)
    },
    'Nature rune': {
        rune: 'Nature rune',
        talisman: 'Nature talisman',
        level: 44,
        bank: 'Draynor',
        ruins: new Tile(2865, 3022, 0)
    },
    'Law rune': {
        rune: 'Law rune',
        talisman: 'Law talisman',
        level: 54,
        bank: 'Catherby',
        ruins: new Tile(2858, 3378, 0)
    },
    'Death rune': {
        rune: 'Death rune',
        talisman: 'Death talisman',
        level: 65,
        bank: 'Edgeville',
        ruins: new Tile(3221, 3218, 0)
    }
};

export type RuneType = keyof typeof RUNES;
export const RUNE_OPTIONS: string[] = Object.keys(RUNES);
export const DEFAULT_RUNE: string = 'Air rune';
