import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { reader, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { DS_ID } from '#/bot/api/ai/quests/defs/dragonslayer/areas.js';
import { MazeRun } from '#/bot/api/ai/quests/defs/dragonslayer/maze.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Input } from '#/bot/input/Input.js';
import { stubProps } from '../../../lib/stubSingletons.js';

let here: WorldTile;
let keys: Set<number>;
let walks: WorldTile[];
let restore: (() => void)[];

beforeEach(() => {
    here = { x: 3069, z: 3518, level: 0 };
    keys = new Set([DS_ID.MAZE_KEY]);
    walks = [];
    restore = [
        stubProps(reader, {
            worldTile: () => here,
            bankComId: () => -1,
            inventory: () => [...keys].map((id, slot) => ({ id, slot, name: 'Key', count: 1, ops: [], comId: 3214 })),
            groundItems: () => [],
            npcs: () => []
        }),
        stubProps(Traversal, {
            walkResilient: async to => {
                walks.push({ x: to.x, z: to.z, level: to.level });
                return false;
            }
        })
    ];
});

afterEach(() => restore.reverse().forEach(fn => fn()));

const log = () => {};

describe('MazeRun recovery', () => {
    for (const [name, facing, expectedAttacks] of [
        ['idle while the key rat attacks', -1, 1],
        ['targeting a decoy while the key rat attacks', 5553, 1],
        ['already attacking the key rat', 5546, 0]
    ] as const) test(name, async () => {
        here = { x: 2933, z: 3254, level: 0 };
        const attacks: number[] = [];
        const waits: number[] = [];
        restore.push(
            stubProps(reader, {
                selfSlot: () => 493,
                selfFaceEntity: () => facing,
                npcs: () => [{
                    index: 5546, id: 748, name: 'Giant rat', tile: { x: 2932, z: 3255, level: 0 },
                    distance: 2, ops: [null, 'Attack'], anim: 138, level: 6, size: 2,
                    inCombat: false, health: 3, totalHealth: 10, faceEntity: 32768 + 493
                }],
                locs: () => [{ typecode: 0, id: 1535, name: 'Door', tile: here, distance: 1, ops: ['Open'] }]
            }),
            stubProps(Input, { interactNpc: index => { attacks.push(index); return true; } }),
            stubProps(Execution, {
                delayTicks: async ticks => { waits.push(ticks); },
                delayUntil: async (check, timeout) => {
                    if (timeout === 60_000 && attacks.length > 0) keys.add(DS_ID.RED_KEY);
                    return check();
                }
            })
        );
        expect(await new MazeRun().step(log)).toBe(expectedAttacks > 0);
        expect(attacks).toEqual(expectedAttacks ? [5546] : []);
        expect(waits).toEqual(expectedAttacks ? [] : [2]);
    });

    test('a fresh run from Oziach walks to the front door', async () => {
        expect(await new MazeRun().step(log)).toBe(false);
        expect(walks).toEqual([{ x: 2941, z: 3248, level: 0 }]);
    });

    test('returning to Oziach after reaching Melzar restarts at the front door', async () => {
        const run = new MazeRun();
        here = { x: 2931, z: 9643, level: 0 };
        keys.add(DS_ID.BLUE_KEY);
        await run.step(log);
        keys.delete(DS_ID.BLUE_KEY);
        here = { x: 2929, z: 9649, level: 0 };
        await run.step(log);
        expect(walks.at(-1)).toEqual({ x: 2929, z: 9649, level: 0 });

        here = { x: 3069, z: 3518, level: 0 };
        walks = [];
        expect(await run.step(log)).toBe(false);
        expect(await run.step(log)).toBe(false);
        expect(walks).toEqual([
            { x: 2941, z: 3248, level: 0 },
            { x: 2941, z: 3248, level: 0 }
        ]);
    });

    test('a coloured key outside the maze cannot skip the front door', async () => {
        keys.add(DS_ID.BLUE_KEY);
        expect(await new MazeRun().step(log)).toBe(false);
        expect(walks).toEqual([{ x: 2941, z: 3248, level: 0 }]);
    });

    test('spending the blue key inside keeps the route moving to Melzar', async () => {
        const run = new MazeRun();
        here = { x: 2931, z: 9643, level: 0 };
        keys.add(DS_ID.BLUE_KEY);
        await run.step(log);
        keys.delete(DS_ID.BLUE_KEY);
        here = { x: 2930, z: 9643, level: 0 };
        await run.step(log);
        expect(walks).toEqual([
            { x: 2931, z: 9643, level: 0 },
            { x: 2929, z: 9649, level: 0 }
        ]);
    });
});
