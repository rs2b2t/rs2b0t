import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { FISHING_LOCATIONS } from '#/bot/data/fishingLocations.js';
import Tile from '#/bot/geometry/Tile.js';
import GatheringBot from '#/bot/scripts/GatheringBot/GatheringBot.js';
import { Gather } from '#/bot/scripts/GatheringBot/GatheringBotTasks.js';

afterEach(() => mock.restore());

test('a Catherby gather miss moves along the shore until hopped spots become visible', async () => {
    const camp = FISHING_LOCATIONS.find(location => location.name === 'Catherby')!;
    const bot = new GatheringBot();
    bot['fishing'] = true;
    bot['location'] = camp;
    bot['anchor'] = camp.spot;
    bot['leash'] = camp.campRadius!;
    bot.bindLog(() => {});
    let here = new Tile(2860, 3428, 0);
    const walks: Tile[] = [];
    spyOn(Game, 'tile').mockImplementation(() => here);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Game, 'animating').mockReturnValue(false);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(reader, 'npcs').mockReturnValue([]);
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Traversal, 'walkResilient').mockImplementation(async tile => {
        here = Tile.from(tile);
        walks.push(here);
        return true;
    });
    const task = new Gather(bot);
    const westernSpot = new Tile(2836, 3431, 0);
    for (let tick = 0; tick < 4 && here.distanceTo(westernSpot) > 14; tick++) await task.execute();
    expect(walks.length).toBeGreaterThan(0);
    expect(here.distanceTo(westernSpot)).toBeLessThanOrEqual(14);
    const easternSpot = new Tile(2860, 3426, 0);
    for (let tick = 0; tick < 4 && here.distanceTo(easternSpot) > 14; tick++) await task.execute();
    expect(here.distanceTo(easternSpot)).toBeLessThanOrEqual(14);
});
