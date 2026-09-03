import { describe, expect, test } from 'bun:test';
import { simUnreachable } from '../../e2e/lib/harness.js';

// Why: the served-page cases need a listening socket, and the test environment's fetch shim rejects what Bun.serve sends, so every live harness run covers them instead.
describe('simUnreachable', () => {
    test('names the url and the two local sims when nothing answers', async () => {
        const why = await simUnreachable('http://127.0.0.1:1');
        expect(why).toContain('http://127.0.0.1:1/bot.html');
        expect(why).toContain(':8890');
        expect(why).toContain(':8888');
    });
});
