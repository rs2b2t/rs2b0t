import { afterEach, beforeEach, expect, test } from 'bun:test';

import { reader, type NpcSnapshot, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { RandomEvents } from '#/bot/runtime/randomevents/RandomEvents.js';
import { Input } from '#/bot/input/Input.js';
import { stubProps } from '../../lib/stubSingletons.js';

const restores: (() => void)[] = [];
let damaged: boolean;
let npcs: NpcSnapshot[];
let walks: WorldTile[];

function npc(id = 431, name = 'Watchman'): NpcSnapshot {
    return {
        id, name, index: 7, anim: -1, level: 14, inCombat: false,
        tile: { x: 3201, z: 3200, level: 0 }, distance: 1,
        ops: [null, 'Attack', null, null, null], health: 20, totalHealth: 20,
        faceEntity: 32771
    };
}

beforeEach(() => {
    damaged = false;
    npcs = [npc()];
    walks = [];
    restores.push(stubProps(reader, {
        worldTile: () => ({ x: 3200, z: 3200, level: 0 }),
        npcs: () => npcs,
        locs: () => [],
        selfSlot: () => 3,
        selfFaceEntity: () => -1,
        inCombat: () => true,
        takingDamage: () => damaged
    }));
    restores.push(stubProps(Execution, {
        delayUntil: async condition => condition(),
        delayTicks: async () => {}
    }));
    restores.push(stubProps(Reachability, { canReach: () => true }));
    restores.push(stubProps(Traversal, {
        walkTo: async destination => {
            walks.push(destination);
            npcs = [];
            return true;
        }
    }));
});
afterEach(() => {
    while (restores.length) restores.pop()!();
});

test.each([-1, 32771, 32777])('a Watchman with faceEntity %i waits for damage then evades', async faceEntity => {
    npcs[0].faceEntity = faceEntity;
    expect(RandomEvents.detect()).toBeNull();
    expect(await RandomEvents.handle(() => {})).toBe(false);
    expect(walks).toEqual([]);

    damaged = true;
    expect(RandomEvents.detect()).toEqual({ kind: 'evade', name: 'watchman' });
    expect(await RandomEvents.handle(() => {})).toBe(true);
    expect(walks).toHaveLength(2);
    expect(walks[0]).not.toEqual({ x: 3200, z: 3200, level: 0 });
    expect(walks[1]).toEqual({ x: 3200, z: 3200, level: 0 });
    expect(RandomEvents.detect()).toBeNull();
});

test('a hostile plant follows the same damage gate', () => {
    npcs = [npc(408, 'Strange plant')];
    expect(RandomEvents.detect()).toBeNull();
    damaged = true;
    expect(RandomEvents.detect()).toEqual({ kind: 'evade', name: 'strange plant' });
});

test('a pickable plant still offers its fruit before any damage', () => {
    npcs = [{ ...npc(407, 'Strange plant'), ops: ['Pick'], faceEntity: -1 }];
    expect(RandomEvents.detect()).toEqual({ kind: 'pick', name: 'strange plant' });
});

test('a plant turning hostile during picking does not flee before damage', async () => {
    npcs = [{ ...npc(407, 'Strange plant'), ops: ['Pick'] }];
    restores.push(stubProps(Inventory, {
        count: () => {
            npcs = [npc(408, 'Strange plant')];
            return 0;
        }
    }));
    expect(await RandomEvents.handle(() => {})).toBe(true);
    expect(walks).toEqual([]);
    expect(RandomEvents.detect()).toBeNull();
});

test('does not lose damage while waiting for a plant to yield fruit', async () => {
    npcs = [{ ...npc(407, 'Strange plant'), ops: ['Pick'] }];
    restores.push(stubProps(Inventory, { count: () => 0 }));
    restores.push(stubProps(Input, { interactNpc: () => true }));
    restores.push(stubProps(Execution, {
        delayUntil: async condition => {
            if (npcs.some(n => n.id === 407)) {
                npcs = [npc(408, 'Strange plant')];
                damaged = true;
                if (!condition()) damaged = false;
            }
            return condition();
        },
        delayTicks: async () => { damaged = false; }
    }));

    expect(await RandomEvents.handle(() => {})).toBe(true);
    expect(walks).toHaveLength(2);
});
