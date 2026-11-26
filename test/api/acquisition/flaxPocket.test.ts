import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import Tile from '#/bot/geometry/Tile.js';
import { Input } from '#/bot/input/Input.js';
import { carveFlaxPocket, findFlaxBoundary } from '#/bot/api/acquisition/flaxPocket.js';
import { Game } from '#/bot/api/game/Game.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';

afterEach(() => mock.restore());

test('a trapped player searches each exposed neighboring tile once on the current floor', () => {
    spyOn(Game, 'tile').mockReturnValue({ x: 5, z: 9, level: 2 });
    spyOn(Reachability, 'canStep').mockImplementation((_from, to) => to.z === 9 && (to.x === 5 || to.x === 6));
    const searched: number[][] = [];
    const boundary = findFlaxBoundary((x, z, level) => {
        searched.push([x, z, level]);
        return null;
    });
    expect(boundary).toEqual([]);
    expect(searched).toEqual([[4, 9, 2], [5, 10, 2], [5, 8, 2], [7, 9, 2], [6, 10, 2], [6, 8, 2]]);
});

test('open ground skips the search for blocking plants', () => {
    spyOn(Game, 'tile').mockReturnValue({ x: 5, z: 9, level: 0 });
    spyOn(Reachability, 'canStep').mockReturnValue(true);
    const search = mock(() => null);
    expect(findFlaxBoundary(search)).toBeNull();
    expect(search).not.toHaveBeenCalled();
});

for (const timing of ['ticks', 'time'] as const) {
    test(`carves toward the gate and waits for the picked plant using ${timing}`, async () => {
        let open = false;
        const stand = new Tile(20, 10, 0);
        const gate = new Tile(10, 10, 0);
        spyOn(Game, 'tile').mockReturnValue(stand);
        spyOn(Inventory, 'items').mockReturnValue([]);
        spyOn(Inventory, 'isFull').mockReturnValue(false);
        spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
        spyOn(EventSignal, 'pending').mockReturnValue(false);
        spyOn(Reachability, 'canStep').mockImplementation(() => open);
        spyOn(reader, 'locs').mockImplementation(() => open ? [] : [21, 19].map(x => ({
            id: 1, typecode: 1, tile: { x, z: 10, level: 0 }, name: 'Flax', ops: ['Pick'], distance: 1
        })));
        spyOn(reader, 'toLocal').mockImplementation((x, z) => ({ lx: x, lz: z }));
        const clicks: number[] = [];
        spyOn(Input, 'interactLoc').mockImplementation(x => { clicks.push(x); open = true; return true; });
        const waits: number[] = [];
        spyOn(Execution, 'delayUntil').mockImplementation(async (ready, ms = 6000) => { waits.push(ms); return ready(); });
        spyOn(Execution, 'delayUntilTicks').mockImplementation(async (ready, ticks) => { waits.push(ticks); return ready(); });
        const log = mock(() => {});

        await carveFlaxPocket({ name: 'Flax', op: 'Pick', gate, timing, log });
        expect(clicks).toEqual([19]);
        expect(waits).toEqual([timing === 'ticks' ? 7 : 4000]);
        expect(log).toHaveBeenCalledWith('carved back out to open ground');
    });
}
