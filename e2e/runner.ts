/** End-to-end runner: --level quick|smart|full, --only <names>, --gates-only, --verbose.
 *  Deploys once, runs the offline gates then the harnesses, and diffs the report against the previous run so the output names what changed. */

// Usage:
//   bun run e2e                     # quick: the fast harnesses
//   bun run e2e -- --level smart    # only what the working diff can affect
//   bun run e2e -- --level full     # every harness, quests included
//   bun run e2e -- --only troll,horror
//   bun run e2e -- --gates-only     # offline gates, no engine needed
//   bun run e2e -- --verbose        # stream every child line
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Why: e2e-report stays on the tools side because it needs no browser; e2e may import tools.
import { errorTail } from '../tools/lib/e2e-report.js';
import { CASES } from './manifest.js';
import { casesForLevel, selectByChanges } from './manifestQuery.js';
import type { Case, Level } from './manifestTypes.js';

type Status = 'pass' | 'fail' | 'timeout' | 'skip';
interface Result { name: string; kind: 'gate' | 'harness'; status: Status; ms: number; note: string; }
interface Run { startedAt: string; git: string; level: Level; results: Result[]; }

const OUT = 'out/e2e';
const LOGS = join(OUT, 'logs');
const LATEST = join(OUT, 'latest.json');

/** Minutes for a case that names no budgetMin of its own. */
const DEFAULT_BUDGET = 12;

/** `verdict` overrides the exit code where a tool reports its status in its output.
 *  Why: the generators print STALE and some then exit non-zero on an unrelated teardown crash in the vendored audio shim. */
const DRIFT = (text: string): Status => (/\bSTALE\b|does not match/i.test(text) ? 'fail' : 'pass');

interface Gate { name: string; cmd: string[]; verdict?: (text: string) => Status; }
const OFFLINE_GATES: Gate[] = [
    { name: 'unit tests', cmd: ['bun', 'test'] },
    { name: 'typecheck', cmd: ['bun', 'run', 'typecheck'] },
    { name: 'lint', cmd: ['bun', 'run', 'lint'] },
    { name: 'cluedb drift', cmd: ['bun', 'tools/clues/gen-cluedb.ts', '--check'], verdict: DRIFT },
    { name: 'dropdb drift', cmd: ['bun', 'tools/combat/gen-dropdb.ts', '--check'], verdict: DRIFT },
    { name: 'spelldb drift', cmd: ['bun', 'tools/combat/gen-spelldb.ts', '--check'], verdict: DRIFT },
    { name: 'itemdb drift', cmd: ['bun', 'tools/items/gen-itemdb.ts', '--check'], verdict: DRIFT },
    { name: 'shopdb drift', cmd: ['bun', 'tools/shops/gen-shopdb.ts', '--check'], verdict: DRIFT },
    { name: 'scriptdocs drift', cmd: ['bun', 'tools/gen-scriptdocs.ts', '--check'], verdict: DRIFT }
];

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

function pick(level: Level, only: string[]): { cases: Case[]; why: string } {
    let cases: Case[];
    let why: string;
    if (level === 'smart') {
        const changed = (Bun.spawnSync(['git', 'diff', '--name-only', 'origin/main...HEAD']).stdout.toString() +
                         Bun.spawnSync(['git', 'diff', '--name-only']).stdout.toString())
            .split('\n').map(s => s.trim()).filter(Boolean);
        ({ cases, why } = selectByChanges(CASES, [...new Set(changed)]));
    } else {
        cases = casesForLevel(CASES, level);
        why = `${level}: ${cases.length} case(s) from the manifest`;
    }
    if (only.length > 0) {
        // Why: --only reaches broken and manual cases, which no level selects.
        cases = CASES.filter(c => only.some(o => c.id.includes(o) || c.harness.includes(o)));
        why += '; filtered by --only';
    }
    return { cases, why };
}

const TTY = Boolean(process.stdout.isTTY);
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
/** How often a non-TTY run (cron, CI) prints a still-alive line. */
const HEARTBEAT_MS = 30_000;

function statusLine(label: string, started: number, last: string): void {
    const el = `${Math.floor((Date.now() - started) / 1000)}s`.padStart(5);
    const text = `  ⏳ ${label} ${el}  ${last}`.slice(0, (process.stdout.columns || 100) - 1);
    if (TTY) process.stdout.write(`\r\u001b[2K${text}`);
    else console.log(text);
}

async function run(label: string, cmd: string[], logFile: string, budgetMs: number, verdict?: (text: string) => Status, caseEnv?: Readonly<Record<string, string>>): Promise<{ status: Status; ms: number; tail: string }> {
    const started = Date.now();
    // Why: the case env lands after HEADED so a case may ask for a headed run of its own.
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HEADED: '0', ...caseEnv } });
    const timer = setTimeout(() => proc.kill(9), budgetMs);
    const log = Bun.file(logFile).writer();
    const lines: string[] = [];
    let last = '';
    let beat = Date.now();

    const pump = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
        const decoder = new TextDecoder();
        const rd = stream.getReader();
        let buf = '';
        for (;;) {
            const { done, value } = await rd.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
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
        }
    };

    const ticker = TTY && !VERBOSE ? setInterval(() => statusLine(label, started, last), 1000) : null;
    await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
    const code = await proc.exited;
    clearTimeout(timer);
    if (ticker) clearInterval(ticker);
    if (TTY) process.stdout.write('\r\u001b[2K');
    await log.end();

    const ms = Date.now() - started;
    const text = lines.join('\n');
    const timedOut = ms >= budgetMs - 1000;
    const tail = errorTail(lines);
    const status: Status = timedOut ? 'timeout' : verdict ? verdict(text) : code === 0 ? 'pass' : 'fail';
    return { status, ms, tail };
}

const mins = (ms: number): string => `${(ms / 60000).toFixed(1)}m`;
const ICON: Record<Status, string> = { pass: '✅', fail: '❌', timeout: '⏱', skip: '⏭' };

function report(now: Run, before: Run | null): string {
    const prev = new Map((before?.results ?? []).map(r => [r.name, r.status]));
    const newlyBroken = now.results.filter(r => r.status !== 'pass' && prev.get(r.name) === 'pass');
    const newlyFixed = now.results.filter(r => r.status === 'pass' && prev.has(r.name) && prev.get(r.name) !== 'pass');
    const stillBroken = now.results.filter(r => r.status !== 'pass' && prev.get(r.name) && prev.get(r.name) !== 'pass');
    const untracked = now.results.filter(r => r.status !== 'pass' && !prev.has(r.name));

    const rows = (rs: Result[]): string => rs.map(r => `| ${ICON[r.status]} ${r.name} | ${r.status} | ${mins(r.ms)} | ${r.note} |`).join('\n');
    const section = (title: string, rs: Result[], empty: string): string =>
        rs.length === 0 ? `## ${title}\n\n${empty}\n` : `## ${title}\n\n| Item | Status | Time | Last output |\n|---|---|---|---|\n${rows(rs)}\n`;

    const failed = now.results.filter(r => r.status !== 'pass' && r.status !== 'skip').length;
    const head = [
        '# Regression report',
        '',
        '| | |',
        '|---|---|',
        `| Started | ${now.startedAt} |`,
        `| Commit | \`${now.git}\` |`,
        `| Level | ${now.level} |`,
        `| Ran | ${now.results.length} |`,
        `| Failing | ${failed} |`,
        `| Baseline | ${before ? `${before.startedAt} (\`${before.git}\`)` : 'none — this is the first run'} |`,
        ''
    ].join('\n');

    return [
        head,
        section('Newly broken since the baseline', newlyBroken, 'Nothing regressed.'),
        section('Newly fixed', newlyFixed, 'Nothing newly fixed.'),
        section('Still broken', stillBroken, 'Nothing carried over.'),
        section('Failing, no baseline entry', untracked, 'Nothing new and failing.'),
        '## Everything\n\n| Item | Status | Time | Last output |\n|---|---|---|---|\n' +
            now.results.map(r => `| ${ICON[r.status]} ${r.name} | ${r.status} | ${mins(r.ms)} | ${r.note} |`).join('\n') + '\n',
        `Logs: \`${LOGS}/\`\n`
    ].join('\n');
}

const level = (arg('level') as Level | undefined) ?? 'quick';
const only = (arg('only') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const engine = arg('engine');

// Why: --list answers "what would run" without an engine, a deploy or a browser.
if (has('list')) {
    const byStatus = new Map<string, number>();
    for (const c of CASES) {
        byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
    }
    console.log(`${CASES.length} case(s): ${[...byStatus].map(([s, n]) => `${n} ${s}`).join(', ')}`);
    for (const lvl of ['quick', 'smart', 'full'] as const) {
        const { cases, why } = pick(lvl, only);
        console.log(`\n${lvl} — ${cases.length} case(s) — ${why}`);
        for (const c of cases) {
            const covers = [...(c.covers.scripts ?? []), ...(c.covers.subsystems ?? [])].join(', ');
            console.log(`  ${c.status.padEnd(10)} ${c.id.padEnd(34)} ${covers}`);
        }
    }
    process.exit(0);
}

mkdirSync(LOGS, { recursive: true });
const git = (await new Response(Bun.spawn(['git', 'rev-parse', '--short', 'HEAD'], { stdout: 'pipe' }).stdout).text()).trim();
const now: Run = { startedAt: new Date().toISOString(), git, level, results: [] };

console.log(`e2e: level=${level} commit=${git}`);

for (const { name, cmd, verdict } of OFFLINE_GATES) {
    const r = await run(name, cmd, join(LOGS, `${name.replace(/\W+/g, '-')}.log`), 20 * 60_000, verdict);
    now.results.push({ name, kind: 'gate', status: r.status, ms: r.ms, note: r.status === 'pass' ? '' : r.tail });
    console.log(`  ${ICON[r.status]} ${name} (${mins(r.ms)})${r.status === 'pass' ? '' : `\n      ${r.tail}`}`);
}

if (!has('gates-only')) {
    const gatesGreen = now.results.every(r => r.status === 'pass');
    if (!gatesGreen && !has('force')) {
        console.log('offline gates failed — skipping harnesses (pass --force to run anyway)');
    } else {
        const deploy = await run('deploy', ['sh', 'tools/deploy-local.sh'], join(LOGS, 'deploy.log'), 20 * 60_000);
        now.results.push({ name: 'deploy', kind: 'gate', status: deploy.status, ms: deploy.ms, note: deploy.status === 'pass' ? '' : deploy.tail });
        console.log(`  ${ICON[deploy.status]} deploy (${mins(deploy.ms)})`);

        if (deploy.status === 'pass') {
            const { cases, why } = pick(level, only);
            console.log(`${cases.length} case(s) — ${why}`);
            for (const [i, c] of cases.entries()) {
                const budget = (c.budgetMin ?? DEFAULT_BUDGET) * 60_000;
                const cmd = ['bun', join('e2e', c.harness), ...(c.args ?? []), '--no-deploy'];
                if (engine) cmd.push('--base', engine);
                const r = await run(`[${i + 1}/${cases.length}] ${c.id}`, cmd, join(LOGS, `${c.id}.log`), budget, undefined, c.env);
                now.results.push({ name: c.id, kind: 'harness', status: r.status, ms: r.ms, note: r.status === 'pass' ? '' : r.tail });
                console.log(`  ${ICON[r.status]} ${c.id} (${mins(r.ms)})${r.status === 'pass' ? '' : `\n      ${r.tail}`}`);
            }
        } else {
            console.log('deploy failed — harnesses would test a stale bundle, so none were run');
        }
    }
}

const before: Run | null = existsSync(LATEST) ? JSON.parse(readFileSync(LATEST, 'utf8')) as Run : null;
const md = report(now, before);
const stamp = now.startedAt.replace(/[:.]/g, '-');
writeFileSync(join(OUT, `${stamp}.json`), JSON.stringify(now, null, 1));
writeFileSync(join(OUT, 'report.md'), md);
writeFileSync(LATEST, JSON.stringify(now, null, 1));

console.log(`\n${md.split('## Everything')[0]}`);
console.log(`report: ${OUT}/report.md`);

const broken = now.results.filter(r => r.status !== 'pass' && r.status !== 'skip').length;
process.exit(broken > 0 ? 1 : 0);
