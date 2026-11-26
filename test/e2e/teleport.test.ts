import { expect, spyOn, test } from 'bun:test';
import type { Page } from 'playwright-core';

import type { WorldTile } from '../../src/bot/adapter/ClientAdapter.js';
import { requireTeleport, teleportForRoute, tryTeleport } from '../../e2e/lib/teleport.js';

const target = { x: 3215, z: 3151, level: 1 };

function fixture(tiles: (WorldTile | null)[] = [], closedAfterSends = Infinity) {
    const commands: string[] = [];
    const waits: number[] = [];
    const page = {
        evaluate(_fn: unknown, command?: string) {
            if (command === undefined) return tiles.shift() ?? null;
            commands.push(command);
            return true;
        },
        waitForTimeout(ms: number) { waits.push(ms); },
        isClosed() { return commands.length >= closedAfterSends; }
    } as unknown as Page;
    return { page, commands, waits };
}

test('retries after null and wrong-plane samples, then settles inside a square radius', async () => {
    const { page, commands, waits } = fixture([null, { ...target, level: 0 }, { ...target, x: 3218, z: 3154 }]);
    expect(await tryTeleport(page, target, 3, { attempts: 2, polls: 2 })).toBe(true);
    expect(commands).toEqual(['tele 1,50,49,15,15', 'tele 1,50,49,15,15']);
    expect(waits).toEqual([700, 350, 350, 700, 600]);
});

test('returns false after the last poll of the last attempt', async () => {
    const { page, commands, waits } = fixture();
    expect(await tryTeleport(page, target, 3, { attempts: 2, polls: 2, pollMs: 200 })).toBe(false);
    expect(commands).toHaveLength(2);
    expect(waits).toEqual([700, 200, 200, 700, 200, 200]);
});

test('route failures keep distinct errors before sending, during polling and after exhaustion', async () => {
    await expect(teleportForRoute(fixture([], 0).page, target, 3)).rejects.toThrow('page closed before tele');
    await expect(teleportForRoute(fixture([], 1).page, target, 3)).rejects.toThrow('page closed during tele settle');
    const { page, commands, waits } = fixture();
    await expect(teleportForRoute(page, target, 3)).rejects.toThrow('tele 3215,3151 failed');
    expect(commands).toHaveLength(8);
    expect(waits.filter(ms => ms === 200)).toHaveLength(8 * 25);
});

test('required placement waits for a full scene settle after success', async () => {
    const { page, waits } = fixture([target]);
    await requireTeleport(page, target, 0);
    expect(waits).toEqual([700, 700]);
});

test('required placement exits after reporting the target', async () => {
    const { page } = fixture();
    const error = spyOn(console, 'error').mockImplementation(() => {});
    const exit = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
        await expect(requireTeleport(page, target, 3)).rejects.toThrow('exit');
        expect(exit).toHaveBeenCalledWith(1);
        expect(error).toHaveBeenCalledWith('FAIL: tele to 3215,3151 failed');
    } finally {
        exit.mockRestore();
        error.mockRestore();
    }
});
