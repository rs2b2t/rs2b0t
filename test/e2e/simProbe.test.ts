import { describe, expect, test } from 'bun:test';
import { simUnreachable } from '../../e2e/lib/harness.js';

describe('simUnreachable', () => {
    test('names the url and the two local sims when nothing answers', async () => {
        const fetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')!;
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: async () => { throw new Error('ECONNREFUSED'); }
        });
        try {
            const why = await simUnreachable('http://127.0.0.1:1');
            expect(why).toContain('http://127.0.0.1:1/bot.html');
            expect(why).toContain('ECONNREFUSED');
            expect(why).toContain(':8890');
            expect(why).toContain(':8888');
        } finally {
            Object.defineProperty(globalThis, 'fetch', fetch);
        }
    });
});
