import { describe, expect, test } from 'bun:test';
import stairsJson from '#/bot/event/webwalk/data/stairEdges.json';

interface StairRow {
    from: { x: number; z: number; level: number };
    to: { x: number; z: number; level: number };
    locX?: number;
    locZ?: number;
    debugName?: string;
    disabledReason?: string;
}

const rows = stairsJson as unknown as StairRow[];
const cheb = (ax: number, az: number, bx: number, bz: number): number =>
    Math.max(Math.abs(ax - bx), Math.abs(az - bz));

// A climb-up must be anchored on the tile its own climb-down lands on; teleporting ladders are exempt.
// Why: `derive-ladders.snap()` scans tiles around the loc and can settle on a diagonal the server refuses.
describe('ladder climb-up approaches', () => {
    const downLandings = new Map<string, Set<string>>();
    for (const r of rows) {
        if (r.locX === undefined || r.locZ === undefined || r.to.level >= r.from.level) {
            continue;
        }
        const key = `${r.locX}|${r.locZ}|${r.to.level}`;
        const set = downLandings.get(key) ?? new Set<string>();
        set.add(`${r.to.x}|${r.to.z}`);
        downLandings.set(key, set);
    }

    test('every two-way ladder climbs up from where it drops you', () => {
        const wrong: string[] = [];
        for (const r of rows) {
            if (r.locX === undefined || r.locZ === undefined || r.to.level <= r.from.level) {
                continue;
            }
            const landings = downLandings.get(`${r.locX}|${r.locZ}|${r.from.level}`);
            if (!landings || landings.size !== 1) {
                continue;
            }
            const [only] = [...landings];
            const [lx, lz] = only!.split('|').map(Number);
            if (cheb(lx!, lz!, r.locX, r.locZ) > 2) {
                continue; // teleporting ladder — its landing is not the foot
            }
            if (`${r.from.x}|${r.from.z}` !== only) {
                wrong.push(
                    `loc (${r.locX},${r.locZ}) ${r.debugName ?? '?'}: up from (${r.from.x},${r.from.z}) but down lands (${lx},${lz})`
                );
            }
        }
        expect(wrong).toEqual([]);
    });

    test('the Seers house ladder that made clue 3507 unsolvable is anchored at its foot', () => {
        const up = rows.find(
            r => r.locX === 2807 && r.locZ === 3454 && r.to.level > r.from.level && !r.disabledReason
        );
        expect(up).toBeDefined();
        expect({ x: up!.from.x, z: up!.from.z }).toEqual({ x: 2808, z: 3454 });
    });
});
