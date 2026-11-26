import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { errorTail } from '../../tools/lib/e2e-report.js';

export type Status = 'pass' | 'fail' | 'timeout' | 'skip';

const TTY = Boolean(process.stdout.isTTY);
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
/** How often a non-TTY run (cron, CI) prints a still-alive line. */
const HEARTBEAT_MS = 30_000;
const CLEANUP_MS = 500;
const active = new Set<() => void>();
const spawnPosix = process.platform === 'win32' ? undefined : (await import('./posixHarness.js')).spawnHarness;

function openGroups() {
    let prefix = resolve(tmpdir(), 'e2e-groups-');
    // Why: macOS sockaddr_un has 104 bytes including the terminating NUL.
    if (Buffer.byteLength(prefix + 'XXXXXX/owner') >= 104) prefix = '/tmp/e2e-groups-';
    const dir = mkdtempSync(prefix);
    try {
        const owner = Bun.listen({ unix: join(dir, 'owner'), socket: { data() {} } });
        return { dir, owner };
    } catch (error) {
        rmSync(dir, { recursive: true, force: true });
        throw error;
    }
}

function closeGroups({ dir, owner }: ReturnType<typeof openGroups>): number[] {
    const closed = dir + '.closed';
    try {
        renameSync(dir, closed);
        return readdirSync(closed).filter(name => /^\d+$/.test(name)).map(Number);
    } finally {
        owner.stop(true);
        rmSync(closed, { recursive: true, force: true });
    }
}

function groupExists(id: number): boolean {
    try {
        process.kill(-id, 0);
        return true;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ESRCH') return false;
        if (code === 'EPERM') return true;
        throw error;
    }
}

export function stopRuns(): void {
    for (const stop of active) stop();
}

function statusLine(label: string, started: number, last: string): void {
    const el = `${Math.floor((Date.now() - started) / 1000)}s`.padStart(5);
    const text = `  ⏳ ${label} ${el}  ${last}`.slice(0, (process.stdout.columns || 100) - 1);
    if (TTY) process.stdout.write(`\r\u001b[2K${text}`);
    else console.log(text);
}

export async function run(label: string, cmd: string[], logFile: string, budgetMs: number, verdict?: (text: string) => Status, caseEnv?: Readonly<Record<string, string>>, ownsServices = false): Promise<{ status: Status; ms: number; tail: string }> {
    const started = Date.now();
    const log = Bun.file(logFile).writer();
    let groups: ReturnType<typeof openGroups> | undefined;
    const launch = () => {
        if (ownsServices && process.platform !== 'win32') groups = openGroups();
        const env = { ...process.env, HEADED: '0', ...caseEnv, E2E_SERVICE_GROUPS: groups?.dir };
        if (spawnPosix) return spawnPosix(cmd, env);
        const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env });
        const closed = new Promise<number | null>((resolve, reject) => {
            child.once('close', resolve);
            child.once('error', reject);
        });
        return { stdout: child.stdout, stderr: child.stderr, closed, stop: () => child.kill('SIGKILL'), pid: undefined };
    };
    let proc: ReturnType<typeof launch>;
    try {
        proc = launch();
    } catch (error) {
        if (groups) closeGroups(groups);
        await log.end();
        throw error;
    }
    let stoppingGroups: number[] = [];
    function stop(killHarness = true): void {
        if (!active.delete(stop)) return;
        try {
            if (groups) stoppingGroups = closeGroups(groups);
        } finally {
            if (proc.pid !== undefined || killHarness) proc.stop();
            if (proc.pid !== undefined) stoppingGroups.push(proc.pid);
        }
    }
    active.add(stop);
    const completion = Promise.withResolvers<number | null | 'timeout'>();
    void proc.closed.then(completion.resolve, completion.reject);
    const timer = setTimeout(() => completion.resolve('timeout'), Math.max(0, budgetMs - (Date.now() - started)));
    const lines: string[] = [];
    let last = '';
    let beat = Date.now();

    for (const stream of [proc.stdout, proc.stderr]) {
        let buf = '';
        stream?.setEncoding('utf8').on('data', (chunk: string) => {
            buf += chunk;
            const parts = buf.split('\n');
            buf = parts.pop() ?? '';
            for (const line of parts) {
                log.write(`${line}\n`);
                lines.push(line);
                if (lines.length > 400) lines.shift();
                const clean = line.trim();
                if (!clean) continue;
                last = clean;
                if (VERBOSE) {
                    if (TTY) process.stdout.write('\r\u001b[2K');
                    console.log(`     ${clean}`.slice(0, (process.stdout.columns || 100) - 1));
                } else if (TTY || Date.now() - beat > HEARTBEAT_MS) {
                    beat = Date.now();
                    statusLine(label, started, clean);
                }
            }
        });
    }

    const ticker = TTY && !VERBOSE ? setInterval(() => statusLine(label, started, last), 1000) : null;
    let code;
    try {
        code = await completion.promise;
        if (code === 'timeout' && 'exitCode' in proc) code = proc.exitCode() ?? 'timeout';
    } finally {
        clearTimeout(timer);
        proc.stdout?.destroy();
        proc.stderr?.destroy();
        if (ticker) clearInterval(ticker);
        if (TTY) process.stdout.write('\r\u001b[2K');
        try {
            stop(code === 'timeout');
            const deadline = performance.now() + CLEANUP_MS;
            while (performance.now() < deadline && stoppingGroups.some(groupExists)) await Bun.sleep(10);
        } finally {
            await log.end();
        }
    }

    const ms = Date.now() - started;
    const text = lines.join('\n');
    const tail = errorTail(lines);
    const status: Status = code === 'timeout' ? 'timeout' : verdict ? verdict(text) : code === 0 ? 'pass' : 'fail';
    return { status, ms, tail };
}
