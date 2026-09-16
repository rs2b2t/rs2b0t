import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '../../src/bot/adapter/ClientAdapter.js';
import { Execution } from '../../src/bot/api/execution/Execution.js';
import { Game } from '../../src/bot/api/game/Game.js';
import { Input } from '../../src/bot/input/Input.js';
import { descend } from '../../src/bot/scripts/JiveKQ/route.js';

afterEach(() => mock.restore());

test('an unacknowledged rope click retries without a five-second backoff', async () => {
    let tile = { x: 3226, z: 3108, level: 0 };
    let clicks = 0;
    let elapsed = 0;
    spyOn(Game, 'tile').mockImplementation(() => tile);
    spyOn(reader, 'locs').mockReturnValue([{ id: 3828, name: 'Tunnel entrance', tile: { x: 3226, z: 3106, level: 0 }, distance: 2, ops: ['Climb-down'], typecode: 1 }]);
    spyOn(reader, 'toLocal').mockReturnValue({ lx: 50, lz: 50 });
    spyOn(Input, 'interactLoc').mockImplementation(() => {
        if (++clicks === 2) tile = { x: 3483, z: 9510, level: 2 };
        return true;
    });
    spyOn(Execution, 'delayUntil').mockImplementation(async (condition, ms = 6000) => {
        if (condition()) return true;
        elapsed += ms;
        return false;
    });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async (condition, ticks) => {
        if (condition()) return true;
        elapsed += ticks * 600;
        return false;
    });
    expect(await descend('surface')).toBe(false);
    expect(await descend('surface')).toBe(true);
    expect(elapsed).toBeLessThan(3000);
});
