import { expect, test } from 'bun:test';

import { Loc } from '#/bot/api/model/Loc.js';
import Tile from '#/bot/geometry/Tile.js';
import GnomeMagicChopper from '#/bot/scripts/GnomeMagicChopper/GnomeMagicChopper.js';

function stair(x: number, z: number, level = 0): Loc {
    return new Loc({
        typecode: 0,
        id: level === 0 ? 1742 : 1744,
        name: 'Staircase',
        ops: [level === 0 ? 'Climb-up' : 'Climb-down'],
        tile: new Tile(x, z, level),
        distance: 0
    });
}

function botWith(stairs: Loc[]): GnomeMagicChopper {
    const bot = new GnomeMagicChopper();
    bot.queryClimbLocs = () => stairs;
    return bot;
}

test('accepts the real north bank staircase from the northern approach', () => {
    const north = stair(2445, 3434);
    const bot = botWith([stair(2444, 3414), north]);
    expect(bot.findClimbLoc(new Tile(2445, 3436, 0), 8, 'up')).toBe(north);
});

test('keeps the southern bank staircase available', () => {
    const south = stair(2444, 3414);
    expect(botWith([south, stair(2445, 3434)]).findClimbLoc(new Tile(2444, 3416, 0), 8, 'up')).toBe(south);
});

test('rejects stairs outside the bank pins and stairs on another floor', () => {
    const bot = botWith([stair(2445, 3443), stair(2445, 3434, 1)]);
    expect(bot.findClimbLoc(new Tile(2445, 3436, 0), 8, 'up')).toBeNull();
});
