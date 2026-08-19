import { describe, expect, test } from 'bun:test';

import { herdCost, herdDirections, herdDistance, herdDistances, herdPlan, pinned, pushable, risky, type HerdGrid } from '#/bot/api/ai/quests/defs/sheepherder/herdPath.js';

const SIZE = 9;

/** An open SIZE×SIZE field with the named tiles blocked; everything off the field is blocked too. */
function field(...walls: [number, number][]): HerdGrid {
    const blocked = new Set(walls.map(([x, z]) => `${x},${z}`));
    const walkable = (x: number, z: number): boolean =>
        x >= 0 && x < SIZE && z >= 0 && z < SIZE && !blocked.has(`${x},${z}`);
    return { walkable, canStep: (x, z, dx, dz) => walkable(x, z) && walkable(x + dx, z + dz) };
}

function column(x: number, z0: number, z1: number): [number, number][] {
    const tiles: [number, number][] = [];
    for (let z = z0; z <= z1; z++) {
        tiles.push([x, z]);
    }
    return tiles;
}

const PEN = { x0: 1, x1: 1, z0: 0, z1: 0 };

describe('herd path', () => {
    test('a push needs a standable tile behind the sheep', () => {
        const grid = field([4, 6]);

        expect(pushable(grid, 4, 5, { dx: 0, dz: -1 })).toBe(false);
        expect(pushable(grid, 4, 4, { dx: 0, dz: -1 })).toBe(true);
    });

    test('a push needs somewhere for the sheep to land', () => {
        const grid = field([4, 3]);

        expect(pushable(grid, 4, 4, { dx: 0, dz: -1 })).toBe(false);
    });

    test('a push needs the stand to be able to reach the sheep', () => {
        const open = field();
        // A fence between x = 4 and x = 5: both tiles walkable, neither side steppable.
        const fenced: HerdGrid = {
            walkable: open.walkable,
            canStep: (x, z, dx, dz) => open.canStep(x, z, dx, dz) && !(z === 6 && ((x === 4 && dx === 1) || (x === 5 && dx === -1)))
        };

        expect(fenced.walkable(5, 6)).toBe(true);
        expect(pushable(fenced, 4, 6, { dx: -1, dz: 0 })).toBe(false);
        expect(pushable(fenced, 4, 6, { dx: 0, dz: 1 })).toBe(true);
    });

    test('counts pushes, not tiles', () => {
        const dist = herdDistances(field(), { x: 4, z: 5 }, PEN);

        expect(herdDistance(dist, 4, 5)).toBe(3 + 5);
    });

    test('routes around a wall rather than through it', () => {
        const dist = herdDistances(field(...column(2, 0, 6)), { x: 4, z: 1 }, PEN);

        expect(herdDistance(dist, 4, 1)).toBe(6 + 3 + 7);
    });

    test('gives up on a sheep pinned where the push it needs has no stand', () => {
        const dist = herdDistances(field(...column(2, 0, 6)), { x: 4, z: 0 }, PEN);

        expect(herdDistance(dist, 4, 0)).toBeUndefined();
    });

    test('offers every legal push, closest to the pen first', () => {
        const dirs = herdDirections(field(), { x: 4, z: 4 }, PEN);

        expect(dirs).toHaveLength(4);
        expect(dirs.slice(0, 2)).toEqual(expect.arrayContaining([{ dx: -1, dz: 0 }, { dx: 0, dz: -1 }]));
    });

    test('reports nothing when the pen is walled off', () => {
        const grid = field(...column(3, 0, 8), ...column(0, 0, 8));

        expect(herdDirections(grid, { x: 5, z: 4 }, PEN)).toEqual([]);
    });

    test('a sheep already in the pen is zero pushes from it', () => {
        expect(herdDistance(herdDistances(field(), { x: 1, z: 0 }, PEN), 1, 0)).toBe(0);
    });

    /** (4,4) opens north and nowhere else, so its one push has no stand behind it. */
    const NOTCH = field([4, 3], [5, 4], [3, 4]);

    test('names a walkable tile with no standable side a trap', () => {
        expect(pinned(NOTCH, 4, 4)).toBe(true);
        expect(pinned(NOTCH, 4, 5)).toBe(false);
        expect(pinned(NOTCH, 4, 3)).toBe(false);
    });

    test('calls a tile touching a trap risky, out to the diagonals', () => {
        expect(risky(NOTCH, 4, 5)).toBe(true);
        expect(risky(NOTCH, 5, 5)).toBe(true);
        expect(risky(NOTCH, 4, 6)).toBe(false);
    });

    /** (4,4) is a trap, and the straight run west along z = 5 passes right beside it. */
    const CORRIDOR = field([4, 3], [3, 4], [5, 4]);
    const WEST_PEN = { x0: 1, x1: 1, z0: 5, z1: 5 };

    test('routes around a trap even when that costs pushes', () => {
        const plan = herdPlan(CORRIDOR, { x: 6, z: 5 }, WEST_PEN);

        expect(pinned(CORRIDOR, 4, 4)).toBe(true);
        expect(herdDistance(plan.any, 6, 5)).toBe(5);
        expect(herdDistance(plan.clear, 6, 5)).toBe(7);
    });

    test('falls back to the trap-blind route for a sheep already off the clear network', () => {
        const plan = herdPlan(CORRIDOR, { x: 4, z: 5 }, WEST_PEN);

        expect(herdDistance(plan.clear, 4, 5)).toBeUndefined();
        expect(herdDirections(CORRIDOR, { x: 4, z: 5 }, WEST_PEN)).not.toEqual([]);
    });

    test('costs every off-network tile above every clear one, so the two never swap potentials', () => {
        const plan = herdPlan(CORRIDOR, { x: 6, z: 5 }, WEST_PEN);

        expect(herdCost(plan, 6, 6)).toBe(6);
        expect(herdCost(plan, 4, 5)).toBeGreaterThan(100);
        expect(herdCost(plan, 8, 0)).toBeUndefined();
    });

    test('drops a pen tile no push could ever be issued at', () => {
        const grid = field([1, 1], [0, 0], [2, 0]);

        expect(herdDistance(herdDistances(grid, { x: 1, z: 0 }, PEN), 1, 0)).toBeUndefined();
    });
});
