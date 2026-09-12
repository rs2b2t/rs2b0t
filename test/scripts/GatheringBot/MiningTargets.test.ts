import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { reader, type LocSnapshot, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { resolveRockIds } from '#/bot/data/miningRocks.js';
import Tile from '#/bot/geometry/Tile.js';
import { Input } from '#/bot/input/Input.js';
import GatheringBot from '#/bot/scripts/GatheringBot/GatheringBot.js';
import { Gather } from '#/bot/scripts/GatheringBot/GatheringBotTasks.js';

afterEach(() => mock.restore());

function rock(x: number, z: number, id = 2096): LocSnapshot {
    return { typecode: 2, id, name: 'Rocks', ops: ['Mine'], tile: new Tile(x, z, 0), distance: 0 };
}

function fixture() {
    const bot = new GatheringBot();
    bot['anchor'] = new Tile(3018, 3590, 0);
    bot['rockIds'] = resolveRockIds(['Coal']);
    const near = rock(3019, 3590);
    const far = rock(3020, 3591);
    const state = {
        here: new Tile(3018, 3590, 0),
        locs: [near, far],
        animating: false,
        used: 0,
        ticks: 0,
        clicks: new Array<WorldTile>(),
        advance: () => { state.animating = false; }
    };
    spyOn(Game, 'tile').mockImplementation(() => state.here);
    spyOn(Game, 'animating').mockImplementation(() => state.animating);
    spyOn(Game, 'inCombat').mockReturnValue(true);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Inventory, 'used').mockImplementation(() => state.used);
    spyOn(Inventory, 'isFull').mockReturnValue(false);
    spyOn(bot, 'hasGear').mockReturnValue(true);
    spyOn(bot, 'log').mockImplementation(() => {});
    spyOn(reader, 'players').mockReturnValue([]);
    spyOn(reader, 'locs').mockImplementation(() => state.locs.map(loc => ({
        ...loc, distance: state.here.distanceTo(loc.tile)
    })));
    spyOn(reader, 'toLocal').mockImplementation((x, z) => ({ lx: x - 3000, lz: z - 3500 }));
    spyOn(Input, 'interactLoc').mockImplementation((x, z) => {
        state.clicks.push(new Tile(x + 3000, z + 3500, 0));
        state.animating = true;
        return true;
    });
    spyOn(Traversal, 'walkTo').mockImplementation(async tile => {
        state.here = Tile.from(tile);
        return true;
    });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async (condition, maxTicks) => {
        for (let i = 0; i < maxTicks; i++) {
            if (condition()) return true;
            state.ticks++;
            state.advance();
        }
        return condition();
    });
    spyOn(Execution, 'delayTicks').mockImplementation(async ticks => { state.ticks += ticks; });
    const random = spyOn(Math, 'random').mockReturnValue(0.5);
    return { bot, state, near, far, random, task: new Gather(bot) };
}

describe('Miner target lifecycle', () => {
    for (const gotOre of [true, false]) {
        test(`leaves a depleted rock on the next tick while hit animations continue (ore=${gotOre})`, async () => {
            const { state, near, far, task } = fixture();
            state.advance = () => {
                near.id = 450;
                if (gotOre) state.used = 1;
            };

            await task.execute();

            expect(state.ticks).toBe(1);
            expect(state.clicks).toEqual([near.tile]);
            state.advance = () => { far.id = 452; };

            await task.execute();

            expect(state.clicks).toEqual([near.tile, far.tile]);
            expect(state.ticks).toBe(2);
        });
    }

    test('clicks its first rock even during a skeleton hit animation', async () => {
        const { state, near, task } = fixture();
        state.animating = true;
        state.advance = () => { near.id = 450; };

        await task.execute();

        expect(state.clicks).toEqual([near.tile]);
        expect(state.ticks).toBe(1);
    });

    test('keeps mining a live rock instead of switching when another rock depletes', async () => {
        const { state, near, far, task } = fixture();
        state.advance = () => {
            if (state.ticks === 1) far.id = 450;
            if (state.ticks === 3) near.id = 452;
        };

        await task.execute();

        expect(state.clicks).toEqual([near.tile]);
        expect(state.ticks).toBe(3);
    });

    test('a rock depleted before our mining animation starts is eligible as soon as it respawns', async () => {
        const { state, near, task } = fixture();
        spyOn(Input, 'interactLoc').mockImplementation((x, z) => {
            state.clicks.push(new Tile(x + 3000, z + 3500, 0));
            return true;
        });
        state.advance = () => { near.id = 450; };

        await task.execute();

        expect(state.ticks).toBe(1);
        near.id = 2096;
        await task.execute();
        expect(state.clicks).toEqual([near.tile, near.tile]);
    });
});

describe('Miner target choice', () => {
    test('chooses randomly below 10%, then chooses nearest at the boundary', async () => {
        const { state, near, far, random, task } = fixture();
        random.mockReturnValueOnce(0.099).mockReturnValueOnce(0.99).mockReturnValue(0.1);

        expect(task.validate()).toBe(true);
        await task.execute();
        expect(task.validate()).toBe(true);
        await task.execute();

        expect(state.clicks).toEqual([far.tile, near.tile]);
    });

    test('random selection excludes depleted, wrong-ore, gas, rejected and out-of-camp rocks', async () => {
        const { bot, state, near, far, random, task } = fixture();
        bot.reject('3021,3590');
        bot.cooldown('3022,3590');
        state.locs = [near, far, rock(3019, 3589, 450), rock(3019, 3591, 2092),
            rock(3019, 3592, 2125), rock(3021, 3590), rock(3022, 3590), rock(3050, 3590)];
        random.mockReturnValueOnce(0).mockReturnValue(0.99);

        await task.execute();

        expect(state.clicks).toEqual([far.tile]);
    });

    test('keeps a randomly selected rock through the approach walk', async () => {
        const { state, near, far, random, task } = fixture();
        far.tile = new Tile(3025, 3590, 0);
        random.mockReturnValueOnce(0).mockReturnValueOnce(0.99).mockReturnValue(0.5);
        spyOn(Traversal, 'walkTo').mockImplementation(async () => {
            state.here = new Tile(3023, 3590, 0);
            near.tile = new Tile(3023, 3591, 0);
            return true;
        });

        await task.execute();

        expect(state.clicks).toEqual([far.tile]);
    });

    test('does not click a randomly selected rock that depletes during the walk', async () => {
        const { state, near, far, random, task } = fixture();
        far.tile = new Tile(3025, 3590, 0);
        random.mockReturnValueOnce(0).mockReturnValueOnce(0.99).mockReturnValue(0.5);
        spyOn(Traversal, 'walkTo').mockImplementation(async () => {
            state.here = new Tile(3023, 3590, 0);
            far.id = 450;
            near.tile = new Tile(3023, 3591, 0);
            return true;
        });

        await task.execute();

        expect(state.clicks).toEqual([]);
        expect(state.ticks).toBe(0);
        await task.execute();
        expect(state.clicks).toEqual([near.tile]);
    });

    test('keeps a timed reclick target while walking without an animation', async () => {
        const { bot, state, near, far, random, task } = fixture();
        bot['tickManip'] = { ...bot.tickManipProfile(), method: 'iron-cadence', timedReclick: true };
        spyOn(bot, 'gatherCycleTicks').mockReturnValue(1);
        spyOn(Game, 'tick').mockImplementation(() => state.ticks);
        far.tile = new Tile(3025, 3590, 0);
        state.locs = [near, rock(3020, 3590), far];
        random.mockReturnValueOnce(0.5).mockReturnValueOnce(0).mockReturnValueOnce(0.99).mockReturnValue(0.5);
        spyOn(Input, 'interactLoc').mockImplementation((x, z) => {
            const tile = new Tile(x + 3000, z + 3500, 0);
            state.clicks.push(tile);
            state.animating = state.here.distanceTo(tile) <= 2;
            return true;
        });
        state.advance = () => {
            if (state.ticks === 1) {
                near.id = 450;
                state.used = 1;
            }
            if (state.ticks >= 3) state.animating = false;
        };

        await task.execute();
        await task.execute();

        expect(state.clicks).toEqual([near.tile, far.tile, far.tile]);
    });
});
