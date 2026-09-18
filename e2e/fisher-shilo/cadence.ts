import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { cheatQuiet } from '../tutorial/harness.js';
import './trace.js';

async function measure(page: Page): Promise<number> {
    return page.evaluate(() => new Promise<number>((resolve, reject) => {
        const intervals: number[] = [];
        let previous = performance.now();
        const stop = globalThis.rs2b0t.host.addTickListener(() => {
            const now = performance.now();
            intervals.push(now - previous);
            previous = now;
            if (intervals.length === 12) {
                stop();
                clearTimeout(timeout);
                const sorted = intervals.slice(1).sort((a, b) => a - b);
                resolve(sorted[5]);
            }
        });
        const timeout = setTimeout(() => { stop(); reject(new Error('server tick measurement timed out')); }, 15000);
    }));
}

export async function cadence(page: Page, allowChange: boolean) {
    const before = await measure(page);
    let confirmation: string | undefined;
    if (allowChange && (before < 150 || before > 250)) {
        assert(await cheatQuiet(page, 'speed 200'), 'speed command not sent');
        confirmation = await page.evaluate(() => globalThis.rs2b0t.reader.chat(20)
            .find(line => line.text.includes('World speed was changed to 200ms'))?.text);
        assert(confirmation, 'global world speed change was not confirmed');
    }
    const after = confirmation ? await measure(page) : before;
    const changed = confirmation !== undefined;
    console.log('server cadence', { before, after, changed, confirmation });
    return { before, after, changed, confirmation, setting: 'World.tickRate (global)' };
}
