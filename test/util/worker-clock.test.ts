import { expect, test } from 'bun:test';

import { WorkerClock } from '#/util/WorkerClock.js';

// The worker path needs a real browser Worker executing a blob URL, which the
// happy-dom test env can't run; verify the graceful setTimeout fallback that
// engages when a worker can't be created (no Worker global / strict CSP).
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
