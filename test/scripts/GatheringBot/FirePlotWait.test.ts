import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type LocSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { FIRE_SPOTS } from '#/bot/api/firemaking/Firemaking.js';
import { waitForFireSpace } from '#/bot/api/firemaking/LightFire.js';
import { Game } from '#/bot/api/game/Game.js';

afterEach(() => mock.restore());

test('a full fire plot wakes when a local fire goes out', async () => {
    const plot = FIRE_SPOTS.Draynor;
    const fire = (x: number): LocSnapshot => ({
        tile: { x, z: plot.z0, level: 0 }, name: 'Fire', typecode: 1, id: 1, distance: 0, ops: []
    });
    let ticks = 0;
    const local = fire(plot.x0);
    const elsewhere = fire(plot.x1 + 1);
    spyOn(reader, 'locs').mockImplementation(() => ticks === 0 ? [local, elsewhere] : ticks < 4 ? [local] : []);
    spyOn(Game, 'sceneReady').mockImplementation(() => ticks !== 4);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async (ready, limit) => {
        while (ticks < limit && !ready()) ticks++;
        return ready();
    });
    await waitForFireSpace(plot, 25);
    expect(ticks).toBe(5);
});
