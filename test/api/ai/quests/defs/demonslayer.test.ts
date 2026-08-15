import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import * as RealInventory from '#/bot/api/inventory/Inventory.js';
import { GroundItems } from '#/bot/api/grounditems/GroundItems.js';
import { Npcs } from '#/bot/api/npcs/Npcs.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

interface TestNpc {
    id: number;
    name: string;
    index: number;
    inCombat: boolean;
    distance(): number;
    targetsAnotherPlayer(): boolean;
    valid(): boolean;
    interact(action: string): Promise<boolean>;
}

interface TestGroundItem {
    id: number;
    name: string;
    distance(): number;
    interact(action: string): Promise<boolean>;
}

let boneCount: number;
let playerInCombat: boolean;
let npcs: TestNpc[];
let groundItems: TestGroundItem[];
let attackedIds: number[];
let takenIds: number[];
let walks: { x: number; z: number; level: number; radius: number }[];

// Why: Bun's mock.module is permanent for the process, so stub the singleton instead.
const restoreExec = stubProps(Execution, {
    delayUntil: async (condition: () => boolean): Promise<boolean> => condition(),
    delayTicks: async (): Promise<void> => {}
});
const restoreGame = stubProps(Game, {
    inCombat: (): boolean => playerInCombat,
    tile: () => ({ x: 3144, z: 3231, level: 0 })
});
const realInventoryFns = { ...RealInventory.Inventory };
const stubInventory = {
    count: (name: string): number => (name.toLowerCase() === 'bones' ? boneCount : 0),
    contains: (): boolean => false,
    first: () => null,
    isFull: (): boolean => false,
    items: () => []
};
const restoreTraversal = stubProps(Traversal, {
    walkResilient: async (
        tile: { x: number; z: number; level: number },
        options: { radius: number }
    ): Promise<boolean> => {
        walks.push({ ...tile, radius: options.radius });
        return true;
    }
});
const restoreGround = stubProps(GroundItems, {
    query: () => {
        let matches = [...groundItems];
        const chain = {
            name: (...names: string[]) => {
                matches = matches.filter(item => names.includes(item.name));
                return chain;
            },
            where: (predicate: (item: TestGroundItem) => boolean) => {
                matches = matches.filter(predicate);
                return chain;
            },
            within: (distance: number) => {
                matches = matches.filter(item => item.distance() <= distance);
                return chain;
            },
            nearest: () => matches.sort((a, b) => a.distance() - b.distance())[0] ?? null
        };
        return chain as never;
    }
});
const restoreNpcs = stubProps(Npcs, {
    query: () => {
        let matches = [...npcs];
        const chain = {
            name: (...names: string[]) => {
                matches = matches.filter(npc => names.includes(npc.name));
                return chain;
            },
            action: () => chain,
            where: (predicate: (npc: TestNpc) => boolean) => {
                matches = matches.filter(predicate);
                return chain;
            },
            within: (distance: number) => {
                matches = matches.filter(npc => npc.distance() <= distance);
                return chain;
            },
            nearest: () => matches.sort((a, b) => a.distance() - b.distance())[0] ?? null
        };
        return chain as never;
    },
    all: (() => npcs) as never
});
afterAll(() => {
    restoreExec();
    restoreGame();
    restoreTraversal();
    restoreGround();
    restoreNpcs();
    Object.assign(RealInventory.Inventory, realInventoryFns);
});

const { demonslayer } = await import('#/bot/api/ai/quests/defs/demonslayer.js');

function npc(id: number, name: string, distance: number, options: { inCombat?: boolean; targetsAnotherPlayer?: boolean } = {}): TestNpc {
    const index = id + distance;
    return {
        id,
        name,
        index,
        inCombat: options.inCombat ?? false,
        distance: () => distance,
        targetsAnotherPlayer: () => options.targetsAnotherPlayer ?? false,
        valid: () => npcs.some(candidate => candidate.index === index),
        interact: async (action: string): Promise<boolean> => {
            expect(action).toBe('Attack');
            attackedIds.push(id);
            npcs = npcs.filter(candidate => candidate.index !== index);
            return true;
        }
    };
}

function groundItem(id: number, name: string, distance: number): TestGroundItem {
    return {
        id,
        name,
        distance: () => distance,
        interact: async (action: string): Promise<boolean> => {
            expect(action).toBe('Take');
            takenIds.push(id);
            boneCount++;
            return true;
        }
    };
}

async function gatherBones(): Promise<boolean> {
    const step = demonslayer.gather?.bones?.(
        {
            journal: 'inProgress',
            inv: new Map(),
            worn: new Set(),
            noProgress: 0,
            bankCoins: 0
        },
        25
    );
    expect(step?.kind).toBe('custom');
    if (step?.kind !== 'custom') {
        throw new Error('Demon Slayer bones gather is not a custom step');
    }
    return step.run(() => {});
}

beforeEach(() => {
    Object.assign(RealInventory.Inventory, stubInventory);
    boneCount = 0;
    playerInCombat = false;
    npcs = [];
    groundItems = [];
    attackedIds = [];
    takenIds = [];
    walks = [];
});

describe('Demon Slayer Bones gather', () => {
    test('walks to the six level-2 Goblins west of Lumbridge', async () => {
        await gatherBones();

        expect(walks).toEqual([{ x: 3144, z: 3231, level: 0, radius: 3 }]);
        expect(demonslayer.grind).toContain('goblin');
        expect(demonslayer.grind).not.toContain('wizard');
    });

    test('attacks only the exact idle level-2 Goblin, never Wizards or stronger Goblins', async () => {
        npcs = [npc(13, 'Wizard', 2), npc(101, 'Goblin', 3), npc(100, 'Goblin', 4, { inCombat: true }), npc(100, 'Goblin', 5, { targetsAnotherPlayer: true }), npc(100, 'Goblin', 6)];

        await gatherBones();

        expect(attackedIds).toEqual([100]);
        expect(walks).toEqual([]);
    });

    test('takes exact plain Bones before starting another fight', async () => {
        groundItems = [groundItem(9_526, 'Bones', 1), groundItem(526, 'Bones', 2)];
        npcs = [npc(100, 'Goblin', 3)];

        await gatherBones();

        expect(takenIds).toEqual([526]);
        expect(attackedIds).toEqual([]);
    });

    test('does not walk away or attack another Goblin while already fighting', async () => {
        playerInCombat = true;
        npcs = [npc(100, 'Goblin', 3)];

        await gatherBones();

        expect(attackedIds).toEqual([]);
        expect(walks).toEqual([]);
    });

    test('finishes immediately at the 25-Bones requirement', async () => {
        boneCount = 25;
        npcs = [npc(100, 'Goblin', 3)];

        expect(await gatherBones()).toBe(true);
        expect(attackedIds).toEqual([]);
        expect(walks).toEqual([]);
    });
});
