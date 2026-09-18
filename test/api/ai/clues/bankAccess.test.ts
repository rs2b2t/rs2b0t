import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Game } from '#/bot/api/game/Game.js';
import { openClueBank } from '#/bot/api/ai/clues/bankAccess.js';

afterEach(() => mock.restore());

test('the Duel Arena return opens the chest instead of searching for a booth', async () => {
    spyOn(Game, 'tile').mockReturnValue({ x: 3382, z: 3269, level: 0 });
    const opened: string[] = [];
    spyOn(Bank, 'openNearest').mockResolvedValue(false);
    spyOn(Bank, 'openNearestAccess').mockImplementation(async access => { opened.push(access.name); return true; });
    expect(await openClueBank()).toBe(true);
    expect(opened).toEqual(['Open chest']);
});
