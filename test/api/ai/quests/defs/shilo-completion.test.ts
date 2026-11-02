import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { shilo } from '#/bot/api/ai/quests/defs/shilo/index.js';
import { deliverCorpse } from '#/bot/api/ai/quests/defs/shilo/cairn.js';
import { shiloArea } from '#/bot/api/ai/quests/defs/shilo/areas.js';
import * as prompts from '#/bot/api/ai/quests/exec/prompts.js';
import { Game } from '#/bot/api/game/Game.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import Tile from '#/bot/geometry/Tile.js';

afterEach(() => mock.restore());

test('leaves Bervirius tomb after completing Shilo before the host banks', async () => {
    let tile = new Tile(2765, 9364);
    let complete = false;
    spyOn(Game, 'tile').mockImplementation(() => tile);
    spyOn(Quests, 'status').mockImplementation(() => complete ? 'complete' : 'inProgress');
    spyOn(prompts, 'useOnLoc').mockImplementation(async () => {
        complete = true;
        return true;
    });
    spyOn(prompts, 'settleScene').mockResolvedValue();
    spyOn(prompts, 'promptLoc').mockImplementation(async () => {
        tile = new Tile(2764, 2976);
        return true;
    });
    expect(await deliverCorpse(() => {})).toBe(true);
    expect(await shilo.exit?.(() => {})).toBe(true);
    expect(Quests.status('Shilo Village')).toBe('complete');
    expect(shiloArea(Game.tile())).toBe('karamja');
});

test('retries a failed exit after the remains were already handed in', async () => {
    let tile = new Tile(2765, 9364);
    spyOn(Game, 'tile').mockImplementation(() => tile);
    spyOn(Quests, 'status').mockReturnValue('complete');
    let attempts = 0;
    spyOn(prompts, 'useOnLoc').mockResolvedValue(false);
    spyOn(prompts, 'settleScene').mockResolvedValue();
    spyOn(prompts, 'promptLoc').mockImplementation(async () => {
        if (++attempts === 1) return false;
        tile = new Tile(2764, 2976);
        return true;
    });
    expect(await shilo.exit?.(() => {})).toBe(false);
    expect(await shilo.exit?.(() => {})).toBe(true);
    expect(shiloArea(Game.tile())).toBe('karamja');
});
