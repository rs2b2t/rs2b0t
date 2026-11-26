import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../e2e/lib/run.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'e2e-run-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function fixture(label: string, script: string, verdict?: () => 'pass') {
    const cmd = ['sh', '-c', script, 'fixture', dir];
    return run(label, cmd, join(dir, label), 1500, verdict);
}

test('a zero exit in the last second of the budget passes', async () => {
    const result = await fixture('early', 'sleep 1 & wait');
    expect(result.status).toBe('pass');
});

test.each(['wait', 'exit 0'])('a timeout stops the inherited-pipe child and releases the worker (harness: %s)', async end => {
    const hung = await fixture('hung', `(echo ready; sleep 2; touch "$1/survived"; sleep 1) & ${end}`, () => 'pass');
    const next = await fixture('next', 'sleep 1; echo done >&2');
    expect(hung.status).toBe('timeout');
    expect(hung.ms).toBeLessThan(2500);
    expect(hung.tail).toBe('ready');
    expect(existsSync(join(dir, 'survived'))).toBe(false);
    expect(next.status).toBe('pass');
    expect(readFileSync(join(dir, 'next'), 'utf8')).toBe('done\n');
}, 7000);

test('a completed command uses its exit code or the supplied output verdict', async () => {
    const cmd = ['sh', '-c', 'echo "$HEADED" >&2; exit 7'];
    expect((await run('fail', cmd, join(dir, 'fail'), 1500)).status).toBe('fail');
    const result = await run('override', cmd, join(dir, 'override'), 1500,
        text => text === '1' ? 'pass' : 'fail', { HEADED: '1' });
    expect(result.status).toBe('pass');
});
