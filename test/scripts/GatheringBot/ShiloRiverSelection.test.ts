import { afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { reader, type NpcSnapshot, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { FISHING_LOCATIONS } from '#/bot/data/fishingLocations.js';
import { FISHING_METHODS } from '#/bot/data/fishingMethods.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import Tile from '#/bot/geometry/Tile.js';
import { Input } from '#/bot/input/Input.js';
import GatheringBot from '#/bot/scripts/GatheringBot/GatheringBot.js';
import { Gather } from '#/bot/scripts/GatheringBot/GatheringBotTasks.js';

afterEach(() => mock.restore());

let finder: PathFinder;
const north = [[2850, 2976], [2855, 2977], [2860, 2976], [2869, 2977]] as const;
const camp = FISHING_LOCATIONS.find(location => location.name === 'Shilo Village');
if (!camp) throw new Error('Missing Shilo camp');

function fixture(tiles: readonly Tile[]) {
    const bot = new GatheringBot();
    bot['fishing'] = true;
    bot['location'] = camp ?? null;
    bot['anchor'] = new Tile(2841, 2970, 0);
    bot['leash'] = 48;
    bot['target'] = 'Fishing spot';
    bot['targetType'] = 'npc';
    bot['action'] = 'Lure';
    bot['fishMethod'] = FISHING_METHODS.find(method => method.op === 'Lure') ?? null;
    const state = {
        here: new Tile(2870, 2971, 0),
        visible: true,
        approaches: new Array<WorldTile>(),
        sweeps: new Array<WorldTile>()
    };
    spyOn(Game, 'tile').mockImplementation(() => state.here);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Game, 'animating').mockReturnValue(false);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(bot, 'hasGear').mockReturnValue(true);
    spyOn(bot, 'log').mockImplementation(() => {});
    spyOn(reader, 'npcs').mockImplementation(() => state.visible ? tiles.map((tile, index): NpcSnapshot => ({
        index, id: 317, anim: -1, name: 'Fishing spot', level: 0, size: 1, tile,
        distance: state.here.distanceTo(tile), ops: ['Lure', 'Bait'], inCombat: false,
        health: 0, totalHealth: 0, faceEntity: -1
    })) : []);
    const route = (dest: WorldTile) => {
        const path = finder.findPath(state.here, dest, { policy: { useTeleports: false } });
        expect(path.ok).toBe(true);
        if (!path.ok) throw new Error(path.reason);
        expect(path.hops).toEqual([]);
        const end = path.waypoints.at(-1);
        if (!end) throw new Error('Empty route');
        state.here = Tile.from(end);
        return true;
    };
    spyOn(Traversal, 'walkTo').mockImplementation(async dest => {
        state.approaches.push(dest);
        return route(dest);
    });
    spyOn(Traversal, 'walkResilient').mockImplementation(async dest => {
        state.sweeps.push(dest);
        return route(dest);
    });
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    const click = spyOn(Input, 'interactNpc').mockReturnValue(false);
    return { state, click, task: new Gather(bot) };
}

describe.skipIf(!existsSync('out/collision.lcnav.gz'))('Shilo stationary river selection (pack-gated)', () => {
    beforeAll(() => {
        finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
        loadDefaultNavEdges(finder);
    });

    for (const [x, z] of north) {
        test(`approaches and clicks stationary north NPC ${x},${z} instead of sweeping`, async () => {
            const tile = new Tile(x, z, 0);
            const { state, click, task } = fixture([tile]);

            await task.execute();

            expect(state.approaches).toEqual([tile]);
            expect(state.sweeps).toEqual([]);
            expect(state.here).toEqual(new Tile(x, z + 1, 0));
            expect(click).toHaveBeenCalledWith(0, 1);
        });
    }

    test('selects a north NPC when the entire visible scene is north-only', async () => {
        const { state, click, task } = fixture(north.map(([x, z]) => new Tile(x, z, 0)));

        await task.execute();

        expect(state.approaches).toEqual([new Tile(2869, 2977, 0)]);
        expect(click).toHaveBeenCalledWith(3, 1);
        expect(state.sweeps).toEqual([]);
    });

    test('keeps selecting the nearby healthy south spot', async () => {
        const south = new Tile(2862, 2972, 0);
        const { state, click, task } = fixture([south, new Tile(2850, 2976, 0)]);

        await task.execute();

        expect(state.approaches).toEqual([south]);
        expect(state.here).toEqual(new Tile(2862, 2971, 0));
        expect(click).toHaveBeenCalledWith(0, 1);
    });

    test('sweeps into an initially unseen north scene and selects its stationary NPC', async () => {
        const tile = new Tile(2869, 2977, 0);
        const { state, task } = fixture([tile]);
        state.here = new Tile(2841, 2970, 0);
        state.visible = false;

        for (let step = 0; step < 15 && state.approaches.length === 0; step++) {
            state.visible = state.here.z >= 2975 && state.here.distanceTo(tile) <= 16;
            await task.execute();
        }

        expect(state.sweeps.some(stop => stop.x === 2832 && stop.z === 2973)).toBe(true);
        expect(state.approaches).toEqual([tile]);
        expect(state.here).toEqual(new Tile(2869, 2978, 0));
    });

    test('walks the entire empty-scene sweep across both banks and wraps south', async () => {
        const { state, task } = fixture([]);
        state.here = new Tile(2841, 2970, 0);
        const stops = camp?.sweep ?? [];

        for (let step = 0; step <= stops.length; step++) await task.execute();

        expect(state.sweeps).toEqual([...stops, stops[0]]);
        expect(state.sweeps.some(stop => stop.z >= 2977)).toBe(true);
        expect(state.here).toEqual(new Tile(2862, 2971, 0));
    });
});
