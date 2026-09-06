import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';

// Why: process.env.* survives into a browser bundle when bun.build's `define` map (bot.bundle.ts, bundle.ts)
// doesn't list a key some src/client module reads at top level, so it's bundled but never inlined, and the
// browser hits a bare `process` global and throws ReferenceError at class-definition/module-eval time. Reads
// the last build rather than building here: a real Bun.build per bundle is too slow for the suite.
const OUTPUTS = ['out/botclient.js', 'out/client.js', 'out/mapview.js', 'out/multibox.js', 'out/ondemandworker.js', 'out/navworker.js'];
const PRESENT = OUTPUTS.filter(f => fs.existsSync(f));

describe.skipIf(PRESENT.length === 0)('browser bundle outputs (build-gated)', () => {
    for (const path of PRESENT) {
        test(`${path} has no surviving process.env reference`, () => {
            const source = fs.readFileSync(path, 'utf8');
            expect(source).not.toContain('process.env');
        });
    }
});
