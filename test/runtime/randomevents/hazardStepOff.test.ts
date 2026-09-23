import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { reader, type LocSnapshot, type NpcSnapshot, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { HAZARD_STEP, RandomEvents } from '#/bot/runtime/randomevents/RandomEvents.js';
import { stubProps } from '../../lib/stubSingletons.js';

const ME = { x: 3200, z: 3200, level: 0 };
const restores: (() => void)[] = [];
let locs: LocSnapshot[];
let npcs: NpcSnapshot[];
let walks: WorldTile[];

const chebyshev = (a: WorldTile, b: WorldTile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** The whirlpool a fishing spot turns into, three tiles east and inside the detection radius. */
function whirlpool(): NpcSnapshot {
    return {
        id: 403, name: 'Fishing spot', index: 9, anim: -1, level: -1, size: 1,
        tile: { x: 3203, z: 3200, level: 0 }, distance: 3, ops: [], inCombat: false,
        health: 0, totalHealth: 0, faceEntity: -1
    };
}

/** The trapped chest that vents gas, one tile north. */
function gasChest(): LocSnapshot {
    return { typecode: 0, id: 2141, name: 'Chest', ops: ['Search'], tile: { x: 3200, z: 3201, level: 0 }, distance: 1 };
}

beforeEach(() => {
    locs = [];
    npcs = [];
    walks = [];
    restores.push(stubProps(reader, {
        worldTile: () => ME,
        npcs: () => npcs,
        locs: () => locs,
        groundItems: () => [],
        selfSlot: () => 3,
        selfFaceEntity: () => -1,
        takingDamage: () => false
    }));
    restores.push(stubProps(Game, { tile: () => ME, animating: () => false }));
    restores.push(stubProps(Inventory, { items: () => [], contains: () => false }));
    restores.push(stubProps(Execution, {
        delayUntil: async condition => condition(),
        delayTicks: async () => {}
    }));
    restores.push(stubProps(Reachability, { canReach: () => true }));
    restores.push(stubProps(Traversal, {
        walkTo: async destination => {
            walks.push(destination);
            locs = [];
            npcs = [];
            return true;
        }
    }));
});

afterEach(() => {
    while (restores.length) restores.pop()!();
});

describe('stepping off a hazard', () => {
    test('a whirlpool to the east sends the step west, not into it', async () => {
        npcs = [whirlpool()];
        const spot = npcs[0].tile;
        expect(RandomEvents.detect()).toMatchObject({ kind: 'hazard', name: 'whirlpool' });

        expect(await RandomEvents.handle(() => {})).toBe(true);
        expect(walks).toHaveLength(1);
        expect(walks[0].x).toBeLessThan(ME.x);
        expect(chebyshev(walks[0], ME)).toBe(HAZARD_STEP);
        expect(chebyshev(walks[0], spot)).toBeGreaterThan(chebyshev(ME, spot));
    });

    test('a gas chest to the north sends the step south', async () => {
        locs = [gasChest()];
        const chest = locs[0].tile;
        expect(RandomEvents.detect()).toMatchObject({ kind: 'hazard', name: 'poisonous gas' });

        expect(await RandomEvents.handle(() => {})).toBe(true);
        expect(walks[0].z).toBeLessThan(ME.z);
        expect(chebyshev(walks[0], chest)).toBeGreaterThan(chebyshev(ME, chest));
    });

    test('the hazard tile rides along with the detection, so the handler knows which way is away', () => {
        npcs = [whirlpool()];
        expect(RandomEvents.detect()?.tile).toEqual({ x: 3203, z: 3200, level: 0 });
    });
});
