import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Loc } from '#/bot/api/model/Loc.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import { RouteState } from '#/bot/event/webwalk/routeState.js';

const west = { x: 2837, z: 3518, level: 0 };
const east = { x: 2840, z: 3517, level: 0 };

afterEach(() => { mock.restore(); RouteState.reset(); GameMessages.reset(); });

for (const [approach, destination, start] of [
    [west, east, { x: 2837, z: 3517, level: 0 }],
    [east, west, { x: 2840, z: 3518, level: 0 }]
]) {
    test.each([true, false])(`rockslide from ${start.x},${start.z} only mines after reaching the planned stand: %s`, canStand => {
        return runCrossing(approach, destination, start, canStand);
    });
}

async function runCrossing(approach: typeof west, destination: typeof west, start: typeof west, canStand: boolean): Promise<void> {
    let here = start;
    let mines = 0;
    spyOn(reader, 'worldTile').mockImplementation(() => here);
    spyOn(reader, 'locs').mockReturnValue([{
        id: 2634, name: 'Rock slide', typecode: 10, ops: ['Examine', 'Mine'],
        tile: { x: 2838, z: 3517, level: 0 }, distance: 1
    }]);
    spyOn(DirectNavigator, 'walkTo').mockImplementation(async (tile, radius) => {
        expect(radius).toBe(0);
        if (canStand) here = tile;
        return canStand;
    });
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Loc.prototype, 'interact').mockImplementation(function (action) {
        expect(action).toBe('Mine');
        mines++;
        here = here.x > 2838 ? { ...here, x: here.x - 3, z: here.z + 1 } : { ...here, x: here.x + 3, z: here.z - 1 };
        return true;
    });
    const step = {
        ...destination,
        transport: { locId: 2634, locName: 'Rock slide', locX: 2838, locZ: 3517, action: 'Mine', kind: 'shortcut', toTile: destination }
    };
    expect(await WalkExecutor['handleTransport'](approach, step, () => {})).toBe(canStand);
    expect(mines).toBe(canStand ? 1 : 0);
    expect(here).toEqual(canStand ? destination : start);
}
