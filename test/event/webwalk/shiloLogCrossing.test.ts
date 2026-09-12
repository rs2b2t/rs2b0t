import { afterEach, expect, test } from 'bun:test';

import { reader, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { specialCrossingForTransport } from '#/bot/event/webwalk/data/specialCrossings.js';
import transports from '#/bot/event/webwalk/data/transports.json';
import { handleSpecialCrossing } from '#/bot/event/webwalk/exec/specialCrossing.js';
import { findTransportLoc } from '#/bot/event/webwalk/exec/transportLoc.js';
import { Input } from '#/bot/input/Input.js';
import { stubProps } from '../../lib/stubSingletons.js';

const restores: (() => void)[] = [];
afterEach(() => {
    while (restores.length) restores.pop()!();
});

const directions = [
    { fromX: 2906, locX: 2907, toX: 2910 },
    { fromX: 2910, locX: 2909, toX: 2906 }
];

function logScene(tile: () => WorldTile): void {
    restores.push(stubProps(reader, {
        worldTile: tile,
        toLocal: (x, z) => ({ lx: x - 2880, lz: z - 3008 }),
        locs: () => [2907, 2909].map(x => ({
            id: 2332,
            typecode: 2332 << 14,
            name: 'A wooden log',
            ops: ['Cross', null, null, null, null],
            tile: { x, z: 3049, level: 0 },
            distance: Math.max(Math.abs(x - tile().x), Math.abs(3049 - tile().z))
        }))
    }));
}

function logTransport(fromX: number) {
    const edge = transports.find(t => t.debugName === 'zq_logbalance' && t.from.x === fromX)!;
    return {
        locName: edge.locName,
        action: edge.action,
        locId: edge.locId,
        locX: edge.locX!,
        locZ: edge.locZ!,
        toTile: edge.to
    };
}

test.each(directions)('resolves the Cross action on the Shilo log from $fromX', ({ fromX, locX }) => {
    logScene(() => ({ x: fromX, z: 3049, level: 0 }));
    const loc = findTransportLoc(logTransport(fromX));

    expect(loc).not.toBeNull();
    expect(loc!.tile()).toMatchObject({ x: locX, z: 3049, level: 0 });
});

async function crossLog(direction: typeof directions[number], outcome: 'cross' | 'midpoint' | 'unreachable') {
    const { fromX, locX, toX } = direction;
    const from = { x: fromX, z: 3049, level: 0 };
    const to = { x: toX, z: 3049, level: 0 };
    const transport = logTransport(fromX);
    const crossing = specialCrossingForTransport(transport, from, to);
    expect(crossing).not.toBeNull();

    let tile = { x: fromX < toX ? 2903 : 2913, z: 3050, level: 0 };
    let clicks = 0;
    let frames: WorldTile[] = [];
    logScene(() => tile);
    restores.push(stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false }));
    restores.push(stubProps(Input, {
        interactLoc: (lx, lz, _typecode, op) => {
            expect(tile).toEqual(from);
            expect({ lx, lz, op }).toEqual({ lx: locX - 2880, lz: 41, op: 1 });
            clicks++;
            frames = [{ x: 2908, z: 3049, level: 0 }];
            if (outcome === 'cross') frames.push(to);
            return true;
        }
    }));
    restores.push(stubProps(Execution, {
        delayTicks: async () => { tile = frames.shift() ?? tile; },
        delayUntil: async condition => condition()
    }));

    const ok = await handleSpecialCrossing(from, { ...to, transport }, crossing!, () => {}, async (destination, opts) => {
        expect(destination).toEqual(from);
        expect(opts?.radius).toBe(0);
        if (outcome === 'unreachable') return false;
        tile = { ...destination };
        return true;
    });
    return { ok, tile, clicks };
}

test.each(directions)('waits for the far bank after approaching from $fromX', async direction => {
    expect(await crossLog(direction, 'cross')).toEqual({
        ok: true,
        tile: { x: direction.toX, z: 3049, level: 0 },
        clicks: 1
    });
});

test.each(directions)('rejects the animation midpoint when crossing from $fromX', async direction => {
    expect(await crossLog(direction, 'midpoint')).toEqual({
        ok: false,
        tile: { x: 2908, z: 3049, level: 0 },
        clicks: 1
    });
});

test('does not click the log when the starting stand cannot be reached', async () => {
    const result = await crossLog(directions[0]!, 'unreachable');
    expect(result.ok).toBe(false);
    expect(result.clicks).toBe(0);
});
