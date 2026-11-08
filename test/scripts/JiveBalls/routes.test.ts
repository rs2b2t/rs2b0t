import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { SHEEP_SITES } from '#/bot/scripts/JiveBalls/sites.js';

const pack = 'out/collision.lcnav.gz';

test.skipIf(!existsSync(pack))('every selectable flock has a bank round trip in the navigation graph', () => {
    const finder = new PathFinder(gunzipSync(readFileSync(pack)));
    loadDefaultNavEdges(finder);
    for (const site of SHEEP_SITES) {
        for (const [from, to] of [[site.pen, site.bank], [site.bank, site.pen]]) {
            const route = finder.findPath(from, to);
            expect(route.ok).toBe(true);
            if (!route.ok) throw new Error(`${site.label}: ${route.reason}`);
            expect(route.waypoints.at(-1)).toMatchObject({ x: to.x, z: to.z, level: to.level });
        }
    }
});
