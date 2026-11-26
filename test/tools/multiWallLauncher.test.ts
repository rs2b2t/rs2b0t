import { expect, test } from 'bun:test';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('multi-wall launcher builds through the existing launcher once with the requested count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wall-launch-'));
    try {
        const script = join(dir, 'b0t-multi.sh');
        copyFileSync(join(import.meta.dir, '../../tools/b0t-multi.sh'), script);
        writeFileSync(join(dir, 'b0t.sh'), 'echo "started $B0T_WALL_COUNT"\n');
        const run = (...args: string[]) => spawnSync('sh', [script, ...args], {
            encoding: 'utf8', env: { ...process.env, B0T_VIEWER: 'electron', B0T_NO_OPEN: '0' }
        });
        expect(run().stdout.trim()).toBe('started 3');
        expect(run('5').stdout.trim()).toBe('started 5');
        for (const value of ['0', '-1', '1.5', 'two']) expect(run(value).status).toBe(2);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
