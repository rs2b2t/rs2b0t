import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';

const exits = 13;
const walkable = exits + 4096;
const pack = new Uint8Array(walkable + 512 + 2048);
pack.set([0x4c, 0x43, 0x4e, 0x56, 2, 0, 0, 0, 1, 0, 50, 53, 1]);
pack.fill(0xff, walkable, walkable + 512);
const east = (x: number, z: number) => { pack[exits + (x & 63) * 64 + (z & 63)] = 2; };
east(3201, 3430);
for (let x = 3213; x < 3243; x++) east(x, 3424);

const finder = new PathFinder(pack);
const from = { x: 3201, z: 3430, level: 0 };
const to = { x: 3243, z: 3424, level: 0 };
finder.addEdges([], [{ from: { ...from, x: 3202 }, to, locName: 'Tunnel', action: 'Enter', kind: 'shortcut' }]);
const state = { members: true, skills: { magic: 25 }, quests: {}, freeSlots: 25, items: { 'Law rune': 1, 'Fire rune': 1, 'Air rune': 3 } };

for (const [useShortcuts, useTeleportCatalog, maxExpansions] of [
    [true, true, 100], [true, true, 10], [false, true, 100], [true, false, 100]
] as const) {
    const opts = { state, policy: { useShortcuts, useTeleports: true }, useTeleportCatalog, maxExpansions };
    for (let i = 0; i < 20; i++) finder.findPath(from, to, opts);
    let expanded = 0;
    let searchMs = 0;
    const outcomes: Record<string, number> = {};
    for (let i = 0; i < 61; i++) {
        const start = performance.now();
        const result = finder.findPath(from, to, opts);
        searchMs += performance.now() - start;
        expanded += result.expanded;
        const outcome = result.ok ? `${result.cost} via ${result.hops.map(h => h.kind).join('+')}` : result.reason;
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
    console.log({ useShortcuts, useTeleportCatalog, maxExpansions, outcomes, expanded, searchMs });
}
