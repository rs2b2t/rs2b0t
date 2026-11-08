import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import { allTransportRows, loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { matchesTransportLanding } from '#/bot/event/webwalk/exec/transportLoc.js';
import { meetsRequires } from '#/bot/event/webwalk/requires.js';
import { emptyWorldStateData, worldStateFromData } from '#/bot/event/webwalk/worldStateData.js';

const west = { x: 2837, z: 3518, level: 0 };
const east = { x: 2840, z: 3517, level: 0 };
const queen = { x: 2866, z: 9955, level: 0 };

for (const name of ['Bronze', 'Iron', 'Steel', 'Mithril', 'Adamant', 'Rune']) {
    test.each(['items', 'worn'] as const)(`${name} pickaxe in %s permits the rockslide both ways at 50 Mining`, location => {
        const state = worldStateFromData({ ...emptyWorldStateData(), skills: { mining: 50 }, [location]: { [`${name} pickaxe`]: 1 } });
        for (const [from, to] of [[west, east], [east, west]]) {
            const edges = allTransportRows().filter(e => e.locId === 2634 && e.from.x === from.x && e.from.z === from.z);
            const allowed = edges.find(e => meetsRequires(e.requires, state).ok);
            expect(allowed?.to).toEqual(to);
            expect(allowed?.action).toBe('Mine');
        }
    });
}

test.each([
    { mining: 49, items: { 'Rune pickaxe': 1 } },
    { mining: 50, items: { 'Rune pickaxe': 0 } }
])('the rockslide refuses insufficient Mining or a missing pickaxe: %j', ({ mining, items }) => {
    const edges = allTransportRows().filter(e => e.locId === 2634);
    expect(edges.length).toBeGreaterThan(0);
    const state = worldStateFromData({ ...emptyWorldStateData(), skills: { mining }, items });
    expect(edges.some(e => meetsRequires(e.requires, state).ok)).toBe(false);
});

test.skipIf(!existsSync('out/collision.lcnav.gz'))('Catherby reaches the Ice Queen through the rockslide and five ladders', () => {
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    loadDefaultNavEdges(finder);
    const state = { ...emptyWorldStateData(), skills: { mining: 50 }, items: { 'Bronze pickaxe': 1 } };
    const route = finder.findPath({ x: 2808, z: 3439, level: 0 }, queen, { state, useTeleportCatalog: false });
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.hops.filter(h => h.kind !== 'walk').length).toBeGreaterThan(0);
    const crossings = route.waypoints.filter(w => w.transport);
    expect(crossings[0].transport).toMatchObject({ locId: 2634, action: 'Mine', toTile: { x: 2840, z: 3517 } });
    expect(crossings.filter(w => w.transport?.locName === 'Ladder')).toHaveLength(5);
    for (const start of [east, ...crossings.filter(w => w.transport?.locName === 'Ladder')]) {
        expect(finder.findPath(start, queen, { state, useTeleportCatalog: false }).ok).toBe(true);
    }
});


test('mining animation frames do not count as crossing the rockslide', () => {
    const transport = { locName: 'Rock slide', action: 'Mine', locX: 2838, locZ: 3517, kind: 'shortcut', toTile: east };
    expect(matchesTransportLanding(transport, 0, west, west)).toBe(false);
    expect(matchesTransportLanding(transport, 0, west, { x: 2839, z: 3518, level: 0 })).toBe(false);
    expect(matchesTransportLanding(transport, 0, west, east)).toBe(true);
    const back = { ...transport, toTile: west };
    expect(matchesTransportLanding(back, 0, east, { x: 2838, z: 3517, level: 0 })).toBe(false);
    expect(matchesTransportLanding(back, 0, east, west)).toBe(true);
});
