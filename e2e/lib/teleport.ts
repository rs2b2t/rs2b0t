import type { Page } from 'playwright-core';

import type { WorldTile } from '../../src/bot/adapter/ClientAdapter.js';
import { chebyshev } from '../../src/bot/event/webwalk/geometry/followMath.js';
import { cheatQuiet, teleCheat } from '../tutorial/harness.js';
import { fail } from './harness.js';

export function cheb(a: WorldTile, b: WorldTile): number {
    if (a.level !== b.level) return 9999;
    return chebyshev(a, b);
}

interface TeleportTiming {
    attempts?: number;
    polls?: number;
    pollMs?: number;
    settleMs?: number;
    checkClosed?: boolean;
}

export async function tryTeleport(page: Page, tile: WorldTile, radius: number, timing: TeleportTiming = {}): Promise<boolean> {
    const { attempts = 4, polls = 12, pollMs = 350, settleMs = 600, checkClosed = false } = timing;
    const command = teleCheat(tile);
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (checkClosed && page.isClosed()) throw new Error('page closed before tele');
        await cheatQuiet(page, command);
        for (let poll = 0; poll < polls; poll++) {
            if (checkClosed && page.isClosed()) throw new Error('page closed during tele settle');
            const at = await page.evaluate(() => {
                const g = globalThis as typeof globalThis & { __rs2b0t: { reader: { worldTile(): WorldTile | null } } };
                return g.__rs2b0t.reader.worldTile();
            });
            if (at && at.level === tile.level && chebyshev(at, tile) <= radius) {
                await page.waitForTimeout(settleMs);
                return true;
            }
            await page.waitForTimeout(pollMs);
        }
    }
    return false;
}

const ROUTE_TIMING = { attempts: 8, polls: 25, pollMs: 200, checkClosed: true };

export async function teleportForRoute(page: Page, tile: WorldTile, radius: number, timing: TeleportTiming = ROUTE_TIMING): Promise<void> {
    if (!(await tryTeleport(page, tile, radius, timing))) {
        throw new Error(`tele ${tile.x},${tile.z} failed`);
    }
}

export async function requireTeleport(page: Page, tile: WorldTile, radius: number, timing: TeleportTiming = { settleMs: 700 }): Promise<void> {
    if (!(await tryTeleport(page, tile, radius, timing))) {
        fail(`tele to ${tile.x},${tile.z} failed`);
    }
}
