import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';

import { reader } from '#/bot/adapter/ClientAdapter.js';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';
import { PathFinder, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import transports from '#/bot/event/webwalk/data/transports.json';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import * as liveState from '#/bot/event/webwalk/worldStateLive.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';

const inside = { x: 2465, z: 3493, level: 0 };
const outside = { x: 2465, z: 3491, level: 0 };
const door = { x: 2464, z: 3492 };
const executor = Object.getPrototypeOf(WalkExecutor);
let now: number;

function finder(): PathFinder {
    const bytes = new Uint8Array(10 + 3 + 4096 + 512);
    bytes.set([0x4c, 0x43, 0x4e, 0x56, 1, 1]);
    new DataView(bytes.buffer).setUint16(8, 1, true);
    bytes[10] = inside.x >> 6;
    bytes[11] = inside.z >> 6;
    bytes[12] = 1;
    const walk = bytes.subarray(13 + 4096);
    for (const tile of [inside, outside]) {
        const index = (tile.x & 63) * 64 + (tile.z & 63);
        walk[index >> 3] |= 1 << (index & 7);
    }
    const result = new PathFinder(bytes);
    result.addEdges([], transports as TransportEdgeData[]);
    return result;
}

class IdleBot extends LoopingBot {
    override loop(): void {}
}

async function restart(): Promise<void> {
    ScriptRunner.stop('navigation test restart');
    await Promise.resolve();
    await Promise.resolve();
    ScriptRunner.start({ name: 'Navigation probe', description: 'door recovery', create: () => new IdleBot() });
    await Promise.resolve();
    await Promise.resolve();
}

function refuse(): void {
    executor.noteDoorRefusal.call(WalkExecutor, {
        ...outside,
        transport: { locX: door.x, locZ: door.z, locName: 'Tree Door', action: 'Open', kind: 'door' }
    }, () => {});
}

beforeEach(async () => {
    now = 0;
    spyOn(Date, 'now').mockImplementation(() => now);
    spyOn(reader, 'attached').mockReturnValue(false);
    spyOn(reader, 'worldTile').mockReturnValue(inside);
    spyOn(Inventory, 'count').mockReturnValue(0);
    spyOn(Skills, 'level').mockReturnValue(1);
    spyOn(Quests, 'status').mockReturnValue('notStarted');
    spyOn(liveState, 'snapshotWorldStateData').mockImplementation(() => emptyWorldStateData());
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => { await Promise.resolve(); return predicate(); });
    const graph = finder();
    spyOn(Navigator, 'findPath').mockImplementation(async (from, to, options) => graph.findPath(from, to, {
        ...options, avoidDoors: new Set(options?.avoidDoors?.map(tile => `${tile.x}|${tile.z}`))
    }));
    await restart();
});

afterEach(async () => {
    ScriptRunner.stop('navigation test teardown');
    await Promise.resolve();
    await Promise.resolve();
    WalkExecutor.resetSession();
    mock.restore();
});

test('a fresh script can leave the Grand Tree after the previous script excluded its door', async () => {
    expect((await WalkExecutor.probeDest(outside, 100)).ok).toBe(true);
    WalkExecutor.blacklistDoor(door.x, door.z);
    expect((await WalkExecutor.probeDest(outside, 100)).ok).toBe(false);
    await restart();
    expect((await WalkExecutor.probeDest(outside, 100)).ok).toBe(true);
});

test('failed crossings are retried after a cooldown within the same run', async () => {
    refuse();
    refuse();
    refuse();
    expect((await WalkExecutor.probeDest(outside, 100)).ok).toBe(false);
    now = 59_999;
    expect((await WalkExecutor.probeDest(outside, 100)).ok).toBe(false);
    now = 60_000;
    expect((await WalkExecutor.probeDest(outside, 100)).ok).toBe(true);
    refuse();
    expect((await WalkExecutor.probeDest(outside, 100)).ok).toBe(true);
});

test('a confirmed quest lock stays excluded after the transient cooldown', async () => {
    refuse();
    refuse();
    refuse();
    WalkExecutor.blacklistDoor(door.x, door.z);
    now = 60_000;
    expect((await WalkExecutor.probeDest(outside, 100)).ok).toBe(false);
});
