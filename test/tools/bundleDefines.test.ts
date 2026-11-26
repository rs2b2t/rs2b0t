import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkBundleDefines } from '../../tools/check-bundle-defines.js';

test('checks every requested bundle for surviving process.env references', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-defines-'));
    try {
        const client = join(dir, 'client.js');
        const worker = join(dir, 'ondemandworker.js');
        writeFileSync(client, 'void 0;');
        const check = () => checkBundleDefines([client, worker]);
        expect(check).toThrow(worker);

        writeFileSync(worker, 'postMessage(process.env.TARGET);');
        expect(check).toThrow(`${worker} contains process.env`);

        writeFileSync(worker, 'postMessage("local");');
        expect(check).not.toThrow();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
