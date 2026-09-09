import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';

// Why: a process.env read that survives bundling throws in the browser at load; bun tests never see it.
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
