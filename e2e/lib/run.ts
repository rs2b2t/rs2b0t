import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSystemErrorName } from 'node:util';
import { errorTail } from '../../tools/lib/e2e-report.js';
import { ownedService } from './ownedService.mjs';

export type Status = 'pass' | 'fail' | 'timeout' | 'skip';

const TTY = Boolean(process.stdout.isTTY);
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
/** How often a non-TTY run (cron, CI) prints a still-alive line. */
const HEARTBEAT_MS = 30_000;
const CLEANUP_MS = 500;
const active = new Set<() => void>();

function openGroups() {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-groups-'));
    try {
        return { dir, fd: openSync(join(dir, 'owner'), 'wx+') };
    } catch (error) {
        rmSync(dir, { recursive: true, force: true });
        throw error;
    }
}

function closeGroups({ dir, fd }: ReturnType<typeof openGroups>): number[] {
    const closed = dir + '.closed';
    try {
        renameSync(dir, closed);
        return readdirSync(closed).filter(name => /^\d+$/.test(name)).map(Number);
    } finally {
        closeSync(fd);
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

export async function run(label: string, cmd: string[], logFile: string, budgetMs: number, verdict?: (text: string) => Status, caseEnv?: Readonly<Record<string, string>>): Promise<{ status: Status; ms: number; tail: string }> {
    const started = Date.now();
    // Why: the case env lands after HEADED so a case may ask for a headed run of its own.
    const env = { ...process.env, HEADED: '0', ...caseEnv, E2E_SERVICE_GROUPS: undefined };
    const log = Bun.file(logFile).writer();
    let groups: ReturnType<typeof openGroups> | undefined;
    const launch = () => {
        if (process.platform !== 'win32') groups = openGroups();
        const service = ownedService(cmd[0], env, groups?.dir);
        return spawn(service.executablePath, cmd.slice(1), {
            detached: !!groups,
            stdio: groups ? ['ignore', 'pipe', 'pipe', groups.fd] : ['ignore', 'pipe', 'pipe'],
            env: { ...service.env, E2E_RUNNER_LOCK_FD: groups ? '3' : undefined }
        });
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
        if (groups) stoppingGroups = closeGroups(groups);
        else if (killHarness) proc.kill('SIGKILL');
    }
    active.add(stop);
    const completion = Promise.withResolvers<number | null | 'timeout'>();
    proc.once('close', completion.resolve);
    proc.once('error', completion.reject);
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
        if (groups && code === 127) {
            const file = join(groups.dir, proc.pid + '.errno');
            if (existsSync(file)) {
                const errno = -Number(readFileSync(file, 'utf8'));
                const code = getSystemErrorName(errno);
                const syscall = 'spawn ' + cmd[0];
                throw Object.assign(new Error(syscall + ' ' + code), { code, errno, syscall, path: cmd[0], spawnargs: cmd.slice(1) });
            }
        }
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
