import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { SolveClue } from '#/bot/api/ai/clues/SolveClue.js';
import { Prayer } from '#/bot/api/prayer/Prayer.js';
import * as Altars from '#/bot/api/altar/Altars.js';
import { Game } from '#/bot/api/game/Game.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import Tile from '#/bot/geometry/Tile.js';

beforeEach(() => {
    spyOn(Prayer, 'max').mockReturnValue(60);
    spyOn(Prayer, 'full').mockReturnValue(false);
    spyOn(Game, 'tile').mockReturnValue(new Tile(3253, 3420, 0));
});
afterEach(() => mock.restore());
const task = () => new SolveClue({ log: () => {}, setStatus: () => {}, isFood: () => false, foodName: () => '', foodWithdraw: () => 0 });

test('missing altar blocks a hard trail with depleted prayer', async () => {
    spyOn(Altars, 'nearestAltar').mockResolvedValue(null);
    expect(await task()['topUpPrayer'](2723)).toBe(false);
});

test('failed altar navigation blocks a hard trail', async () => {
    spyOn(Altars, 'nearestAltar').mockResolvedValue({ name: 'church', loc: 'Altar', tile: new Tile(3253, 3420, 0) });
    spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    expect(await task()['topUpPrayer'](2723)).toBe(false);
});

test('an altar click without restored points blocks a hard trail', async () => {
    spyOn(Altars, 'nearestAltar').mockResolvedValue({ name: 'church', loc: 'Altar', tile: new Tile(3253, 3420, 0) });
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(Execution, 'delayUntil').mockImplementation(async fn => fn());
    const query = { name: () => query, action: () => query, nearest: () => ({ interact: async () => true }) };
    spyOn(Locs, 'query').mockReturnValue(query as never);
    expect(await task()['topUpPrayer'](2723)).toBe(false);
});
