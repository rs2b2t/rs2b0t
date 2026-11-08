import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';

const pack = 'out/collision.lcnav.gz';

test.skipIf(!existsSync(pack))('Ardougne sheep pen has a bank route in both directions through its stile', () => {
    const finder = new PathFinder(gunzipSync(readFileSync(pack)));
    loadDefaultNavEdges(finder);
    const pen = { x: 2654, z: 3367, level: 0 };
    const bank = { x: 2616, z: 3332, level: 0 };
    for (const [from, to] of [[pen, bank], [bank, pen]]) {
        const route = finder.findPath(from, to);
        expect(route.ok).toBe(true);
        if (!route.ok) throw new Error(route.reason);
        const stile = route.waypoints.find(w => w.transport?.locId === 993)?.transport;
        expect(stile).toMatchObject({ locName: 'Stile', action: 'Climb-over', locX: 2647, locZ: 3375 });
        expect(stile?.toTile).toEqual({ x: from === pen ? 2646 : 2649, z: 3375 });
    }
});
