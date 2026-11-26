import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { RUNES } from '#/bot/scripts/JiveRC/logic.js';

const pack = 'out/collision.lcnav.gz';

test.skipIf(!existsSync(pack))('Law takes the direct Entrana ferry and Draynor beats Falador and Catherby both ways', () => {
    const finder = new PathFinder(gunzipSync(readFileSync(pack)));
    loadDefaultNavEdges(finder);
    const law = RUNES['Law runes'];
    for (const returning of [false, true]) {
        const routes = ['Draynor', 'Falador East', 'Catherby'].map(name => {
            const bank = BANK_LOCATIONS.find(b => b.name === name)!.tile;
            return finder.findPath(returning ? law.ruins : bank, returning ? bank : law.ruins, {
                useTeleportCatalog: false, maxExpansions: 500_000,
                state: {
                    members: true, skills: {}, freeSlots: 0, entranaRestrictedGear: false,
                    quests: {}, items: {}, worn: {}
                }
            });
        });
        for (const [index, route] of routes.entries()) {
            if (!route.ok) throw new Error(JSON.stringify({ returning, index, route }));
        }
        const [draynor, falador, catherby] = routes;
        if (!draynor.ok || !falador.ok || !catherby.ok) throw new Error('Law bank route unavailable');
        expect(draynor.cost).toBeLessThan(falador.cost);
        expect(draynor.cost).toBeLessThan(catherby.cost);
        expect(draynor.hops.filter(h => h.kind === 'ship').map(h => h.locName)).toEqual(['Monk of Entrana']);
    }
});
