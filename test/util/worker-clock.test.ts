import { expect, test } from 'bun:test';

import { WorkerClock } from '#/util/WorkerClock.js';

test('sleep falls back to setTimeout and resolves after ~ms when Worker is unavailable', async () => {
    const saved = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = undefined;
    try {
        const start = performance.now();
        await WorkerClock.sleep(20);
        expect(performance.now() - start).toBeGreaterThanOrEqual(15);
    } finally {
        (globalThis as { Worker?: unknown }).Worker = saved;
    }
});

test('sleep(0) resolves promptly', async () => {
    await expect(WorkerClock.sleep(0)).resolves.toBeUndefined();
});
