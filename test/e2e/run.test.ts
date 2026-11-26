import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../e2e/lib/run.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'e2e-run-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function fixture(label: string, script: string, budget = 1500, verdict?: () => 'pass') {
    return run(label, ['node', '-e', script], join(dir, label), budget, verdict);
}

function exited(pid: number): boolean {
    try {
        process.kill(pid, 0);
        // Why: a container's PID 1 may leave an exited orphan waiting to be reaped.
        return process.platform === 'linux' && /\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
    } catch (error) {
        if (['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) return true;
        throw error;
    }
}

async function waitFor(check: () => boolean) {
    const deadline = performance.now() + 2000;
    while (!check() && performance.now() < deadline) await Bun.sleep(10);
    expect(check()).toBe(true);
}

const serviceFixture = join(import.meta.dirname, 'fixtures/run-service.mjs');

test('a zero exit in the last second of the budget passes', async () => {
    const cmd = ['node', serviceFixture, 'parent', join(dir, 'service'), '800'];
    expect((await run('early', cmd, join(dir, 'early'), 1500)).status).toBe('pass');
});

test.skipIf(process.platform === 'win32')('an owned group stays live after its service and last child exit', async () => {
    const prefix = join(dir, 'short');
    const cmd = ['node', serviceFixture, 'parent'];
    const sibling = run('sibling', [...cmd, join(dir, 'sibling'), '1800', 'detached'], join(dir, 'sibling.log'), 5000);
    const harness = run('short', [...cmd, prefix, '0', 'detached', 'private', 'brief-child'], join(dir, 'case'), 5000);
    let leader: number;
    let last: number;
    try {
        await waitFor(() => existsSync(prefix + '.pid'));
        leader = Number(readFileSync(prefix + '.pid', 'utf8'));
        last = Number(readFileSync(prefix + '.last', 'utf8'));
        await waitFor(() => exited(leader) && exited(last));
        expect(() => process.kill(-leader, 0)).not.toThrow();
    } finally {
        writeFileSync(prefix + '.release', '');
        const [result, other] = await Promise.all([harness, sibling]);
        expect(result.status).toBe('pass');
        expect(other.status).toBe('pass');
        expect(other.tail).toContain('survived');
    }
    // Why: an unreaped orphan keeps its group ID allocated on Linux.
    if (process.platform === 'linux' && existsSync(`/proc/${last}/stat`)) return;
    await waitFor(() => {
        try { process.kill(-leader, 0); return false; }
        catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    });
}, 8000);

test.skipIf(process.platform === 'win32').each([
    [],
    ['exit'],
    ['detached'],
    ['detached', 'exit'],
    ['detached', 'private'],
    ['detached', 'private', 'exit'],
    ['detached', 'private', 'exit', 'hold-pipe']
].map(flags => ({ flags })))('cleans up the service and releases the worker ($flags)', async ({ flags }) => {
    const prefix = join(dir, 'service');
    const runtime = flags.includes('private') ? [process.execPath, '--no-env-file'] : ['node'];
    const cmd = [...runtime, serviceFixture, 'parent'];
    const concurrent = run('concurrent', [...cmd, join(dir, 'sibling'), '1800', 'detached'], join(dir, 'concurrent'), 4000);
    const start = performance.now();
    const result = await run('case', [...cmd, prefix, '6000', ...flags], join(dir, 'case'), 1500, () => 'pass');
    const elapsed = performance.now() - start;
    const next = await fixture('next', "console.error('done')");
    const other = await concurrent;

    expect(result.status).toBe(flags.includes('private') && flags.includes('exit') && !flags.includes('hold-pipe') ? 'pass' : 'timeout');
    expect(elapsed).toBeLessThan(2500);
    expect(flags.includes('private') ? readFileSync(prefix + '.log', 'utf8').trim() : result.tail).toBe('ready');
    expect(existsSync(prefix + '.exited')).toBe(flags.includes('exit'));
    expect(exited(Number(readFileSync(prefix + '.pid', 'utf8')))).toBe(true);
    expect(other.status).toBe('pass');
    expect(other.tail).toContain('survived');
    expect(next.status).toBe('pass');
    expect(readFileSync(join(dir, 'next'), 'utf8')).toBe('done\n');
}, 8000);

test('the deadline releases readers held by an unregistered child', async () => {
    const prefix = join(dir, 'unregistered');
    const start = performance.now();
    const result = await run('open pipes', ['node', serviceFixture, 'parent', prefix, '6000', 'detached', 'unregistered', 'exit'], join(dir, 'log'), 1500);
    const pid = Number(readFileSync(prefix + '.pid', 'utf8'));
    try {
        expect(result.status).toBe('timeout');
        expect(existsSync(prefix + '.exited')).toBe(true);
        expect(performance.now() - start).toBeLessThan(2500);
    } finally {
        if (!exited(pid)) process.kill(pid, 'SIGKILL');
    }
}, 8000);

test('a completed command uses its exit code or the supplied output verdict', async () => {
    const cmd = ['node', '-e', 'console.error(process.env.HEADED); process.exitCode = 7'];
    expect((await run('fail', cmd, join(dir, 'fail'), 1500)).status).toBe('fail');
    const result = await run('override', cmd, join(dir, 'override'), 1500,
        text => text === '1' ? 'pass' : 'fail', { HEADED: '1' });
    expect(result.status).toBe('pass');
});

test('a missing executable rejects with the spawn error', async () => {
    await expect(run('missing', ['missing-e2e-executable'], join(dir, 'log'), 1500, undefined, { PATH: dir })).rejects.toMatchObject({ code: 'ENOENT' });
});

test.skipIf(process.platform === 'win32')('a case resolves its executable from its own PATH', async () => {
    symlinkSync('/bin/cat', join(dir, 'echo'));
    const input = join(dir, '$1 with spaces');
    writeFileSync(input, 'fixture\n');
    const result = await run('path', ['echo', input], join(dir, 'path'), 1500, undefined, { PATH: dir });
    expect(result.tail).toBe('fixture');
});

test.skipIf(process.platform === 'win32')('runner exit stops registered services and removes their directory', async () => {
    const log = join(dir, 'case.log');
    const script = `
        import { run, stopRuns } from ${JSON.stringify(import.meta.resolve('../../e2e/lib/run.ts'))};
        process.once('exit', stopRuns);
        import { existsSync } from 'node:fs';
        run('interrupted', ${JSON.stringify(['node', serviceFixture, 'parent', join(dir, 'service'), '6000', 'detached', 'private'])}, ${JSON.stringify(log)}, 8000);
        const pidFile = ${JSON.stringify(join(dir, 'service.pid'))};
        const deadline = Date.now() + 3000;
        while (!existsSync(pidFile) && Date.now() < deadline) await Bun.sleep(10);
        process.exit(existsSync(pidFile) ? 0 : 1);
    `;
    const proc = Bun.spawn([process.execPath, '--no-env-file', '-e', script], { env: { ...process.env, TMPDIR: dir } });
    expect(await proc.exited).toBe(0);
    expect(readdirSync(dir).filter(file => file.startsWith('e2e-groups-'))).toEqual([]);
    const pid = Number(readFileSync(join(dir, 'service.pid'), 'utf8'));
    const deadline = Date.now() + 500;
    while (!exited(pid) && Date.now() < deadline) await Bun.sleep(10);
    expect(exited(pid)).toBe(true);
});
