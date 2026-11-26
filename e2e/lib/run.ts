import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { errorTail } from '../../tools/lib/e2e-report.js';

export type Status = 'pass' | 'fail' | 'timeout' | 'skip';

const TTY = Boolean(process.stdout.isTTY);
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
/** How often a non-TTY run (cron, CI) prints a still-alive line. */
const HEARTBEAT_MS = 30_000;
const active = new Set<ChildProcess>();

function killTree(proc: ChildProcess): void {
    if (!proc.pid) return;
    if (process.platform === 'win32') {
        if (proc.exitCode !== null || proc.signalCode !== null) return;
        const result = spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', timeout: 1000 });
        if (result.status !== 0) proc.kill('SIGKILL');
        return;
    }
    try {
        process.kill(-proc.pid, 'SIGKILL');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
}

export function stopRuns(): void {
    for (const proc of active) killTree(proc);
}

function statusLine(label: string, started: number, last: string): void {
    const el = `${Math.floor((Date.now() - started) / 1000)}s`.padStart(5);
    const text = `  ⏳ ${label} ${el}  ${last}`.slice(0, (process.stdout.columns || 100) - 1);
    if (TTY) process.stdout.write(`\r\u001b[2K${text}`);
    else console.log(text);
}

export async function run(label: string, cmd: string[], logFile: string, budgetMs: number, verdict?: (text: string) => Status, caseEnv?: Readonly<Record<string, string>>): Promise<{ status: Status; ms: number; tail: string }> {
    const started = Date.now();
    const log = Bun.file(logFile).writer();
    // Why: the case env lands after HEADED so a case may ask for a headed run of its own.
    const proc = spawn(cmd[0], cmd.slice(1), {
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HEADED: '0', ...caseEnv }
    });
    active.add(proc);
    const completion = Promise.withResolvers<number | null | 'timeout'>();
    proc.once('close', completion.resolve);
    proc.once('error', completion.reject);
    const timer = setTimeout(() => completion.resolve('timeout'), budgetMs);
    const lines: string[] = [];
    let last = '';
    let beat = Date.now();

    for (const stream of [proc.stdout, proc.stderr]) {
        let buf = '';
        stream.setEncoding('utf8').on('data', (chunk: string) => {
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
        if (code === 'timeout') killTree(proc);
    } finally {
        active.delete(proc);
        clearTimeout(timer);
        proc.stdout.destroy();
        proc.stderr.destroy();
        if (ticker) clearInterval(ticker);
        if (TTY) process.stdout.write('\r\u001b[2K');
        await log.end();
    }

    const ms = Date.now() - started;
    const text = lines.join('\n');
    const tail = errorTail(lines);
    const status: Status = code === 'timeout' ? 'timeout' : verdict ? verdict(text) : code === 0 ? 'pass' : 'fail';
    return { status, ms, tail };
}
