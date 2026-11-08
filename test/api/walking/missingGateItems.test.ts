import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';

const missing = [{ name: 'Shantay pass', count: 1 }];
afterEach(() => { mock.restore(); WalkExecutor.lastOutcome = null; WalkExecutor.lastMissingGateItems = []; });

test('a missing pass reaches the caller before movement retries erase the diagnosis', async () => {
    spyOn(reader, 'worldTile').mockReturnValue({ x: 3222, z: 3218, level: 0 });
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(Reachability, 'canStep').mockReturnValue(false);
    const scene = spyOn(DirectNavigator, 'walkTo').mockResolvedValue(false);
    spyOn(WalkExecutor, 'tryNearbyDoor').mockResolvedValue(false);
    spyOn(WalkExecutor, 'probeDest').mockResolvedValue({ ok: false, terminal: null });
    let calls = 0;
    spyOn(WalkExecutor, 'walkTo').mockImplementation(async () => {
        WalkExecutor.lastOutcome = calls++ === 0 ? 'failed' : 'budget';
        WalkExecutor.lastMissingGateItems = calls === 1 ? missing : [];
        return false;
    });
    expect(await Traversal.walkResilient({ x: 3168, z: 3041, level: 0 }, { radius: 2, attempts: 4 })).toBe(false);
    expect(WalkExecutor.lastMissingGateItems).toEqual(missing);
    expect(WalkExecutor.walkTo).toHaveBeenCalledTimes(1);
    expect(scene).not.toHaveBeenCalled();
});
