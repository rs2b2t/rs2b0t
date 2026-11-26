import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
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
    const result = await run('case', [...cmd, prefix, '6000', 'lock', ...flags], join(dir, 'case'), 1500, () => 'pass');
    const elapsed = performance.now() - start;
    const serviceExited = exited(Number(readFileSync(prefix + '.pid', 'utf8')));
    const lock = spawnSync('/usr/bin/python3', ['-I', '-c', 'import fcntl, sys; fcntl.flock(open(sys.argv[1], "r+"), fcntl.LOCK_EX | fcntl.LOCK_NB)', prefix + '.lock']);
    const next = await fixture('next', "console.error('done')");
    const other = await concurrent;

    expect(result.status).toBe(flags.includes('private') && flags.includes('exit') && !flags.includes('hold-pipe') ? 'pass' : 'timeout');
    expect(elapsed).toBeLessThan(2500);
    expect(flags.includes('private') ? readFileSync(prefix + '.log', 'utf8').trim() : result.tail).toBe('ready');
    expect(existsSync(prefix + '.exited')).toBe(flags.includes('exit'));
    expect(serviceExited).toBe(true);
    expect(lock.status).toBe(0);
    expect(other.status).toBe('pass');
    expect(other.tail).toContain('survived');
    expect(next.status).toBe('pass');
    expect(readFileSync(join(dir, 'next'), 'utf8')).toBe('done\n');
}, 8000);

test('the deadline releases readers held by an unregistered child', async () => {
    const prefix = join(dir, 'unregistered');
    const start = performance.now();
    const harness = run('open pipes', ['node', serviceFixture, 'parent', prefix, '6000', 'detached', 'unregistered', 'exit'], join(dir, 'log'), 1500);
    await waitFor(() => existsSync(prefix + '.exited') && exited(Number(readFileSync(prefix + '.exited', 'utf8'))));
    const parent = Number(readFileSync(prefix + '.exited', 'utf8'));
    const pid = Number(readFileSync(prefix + '.pid', 'utf8'));
    try {
        if (process.platform !== 'win32') expect(() => process.kill(-parent, 0)).not.toThrow();
        const result = await harness;
        expect(result.status).toBe('timeout');
        expect(existsSync(prefix + '.exited')).toBe(true);
        expect(performance.now() - start).toBeLessThan(2500);
    } finally {
        await harness;
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

test.skipIf(process.platform === 'win32')('the harness retains the default broken-pipe signal', async () => {
    const result = await run('pipe', ['/bin/sh', '-c', 'kill -PIPE $$'], join(dir, 'log'), 1500);
    expect(result.status).toBe('fail');
});

test('a missing executable rejects with the spawn error', async () => {
    await expect(run('missing', ['missing-e2e-executable'], join(dir, 'log'), 1500, undefined, { PATH: dir })).rejects.toMatchObject({ code: 'ENOENT' });
});

test.skipIf(process.platform === 'win32').each([
    ['ENOENT', '#!/missing-e2e-interpreter\n'],
    ['ENOEXEC', 'exit 0\n']
])('an invalid executable rejects before applying the output verdict (%s)', async (code, source) => {
    const script = join(dir, 'script');
    writeFileSync(script, source, { mode: 0o755 });
    await expect(run('invalid', [script], join(dir, 'log'), 1500, () => 'pass')).rejects.toMatchObject({ code });
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

test.skipIf(process.platform === 'win32').each(['SIGHUP', 'SIGKILL'] as const)('owner %s releases its groups', async signal => {
    const prefix = join(dir, 'service');
    const cmd = ['node', serviceFixture, 'parent', prefix, '4000', 'detached', 'exit'];
    const script = `
        import { run } from ${JSON.stringify(import.meta.resolve('../../e2e/lib/run.ts'))};
        await run('interrupted', ${JSON.stringify(cmd)}, ${JSON.stringify(join(dir, 'case.log'))}, 8000);
    `;
    const owner = Bun.spawn([process.execPath, '--no-env-file', '-e', script], { env: { ...process.env, TMPDIR: dir } });
    try {
        await waitFor(() => existsSync(prefix + '.exited'));
    } finally {
        owner.kill(signal);
        await owner.exited;
    }
    const service = Number(readFileSync(prefix + '.pid', 'utf8'));
    await waitFor(() => exited(service));
    if (process.platform === 'darwin') {
        for (const group of [service, Number(readFileSync(prefix + '.exited', 'utf8'))]) {
            await waitFor(() => {
                try { process.kill(-group, 0); return false; }
                catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
            });
        }
    }
    await waitFor(() => readdirSync(dir).every(file => !file.startsWith('e2e-groups-')));
});
