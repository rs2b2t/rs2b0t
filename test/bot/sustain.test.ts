import { afterEach, expect, test } from 'bun:test';
import { Sustain } from '#/bot/api/Sustain.js';

afterEach(() => Sustain.set(null));

test('run() is a no-op with no hook registered', async () => {
    Sustain.set(null);
    await Sustain.run(); // must not throw
});

test('run() awaits the registered hook', async () => {
    let calls = 0;
    Sustain.set(async () => {
        calls++;
    });
    await Sustain.run();
    await Sustain.run();
    expect(calls).toBe(2);
});

test('re-entrant run() is guarded (a hook that walks cannot recurse)', async () => {
    let depth = 0;
    let maxDepth = 0;
    Sustain.set(async () => {
        depth++;
        maxDepth = Math.max(maxDepth, depth);
        if (depth === 1) {
            await Sustain.run(); // simulates the hook's own waits reaching a walker loop
        }
        depth--;
    });
    await Sustain.run();
    expect(maxDepth).toBe(1);
});

test('a throwing hook releases the guard', async () => {
    let calls = 0;
    Sustain.set(async () => {
        calls++;
        throw new Error('boom');
    });
    await Sustain.run().catch(() => {});
    await Sustain.run().catch(() => {});
    expect(calls).toBe(2);
});
