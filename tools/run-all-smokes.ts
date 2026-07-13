// Aggregate runner for the tools/*-test.ts live smokes. Deploys the current
// build once, then runs each smoke SEQUENTIALLY against the local engine (they
// share one engine + each spawns a headless WebGL client, so they can't run in
// parallel), printing a PASS/FAIL matrix with timings and the failing assertion.
// Each smoke's full output is saved to out/smoke-logs/<name>.log. Exit 1 if any
// smoke fails.
//
// Prereqs: the local engine running on the base URL (docs/DEV.md —
// `npm run quickstart` in ~/code/rs2b2t-engine, serves :8890). The deploy step
// needs Google Chrome installed (the smokes launch it headless).
//
// Usage:
//   bun tools/run-all-smokes.ts                       # deploy, then run the full sweep
//   bun tools/run-all-smokes.ts --only smelter,flax   # only smokes whose file matches
//   bun tools/run-all-smokes.ts --skip maze,tutorial  # exclude some
//   bun tools/run-all-smokes.ts --no-deploy           # skip the build+deploy step
//   bun tools/run-all-smokes.ts --timeout 300         # override kill timeout for ALL smokes (s)
//   bun tools/run-all-smokes.ts --base http://localhost:8890
//   bun tools/run-all-smokes.ts --list                # print what would run and exit
//
// NOTE: this is a long sweep — ~40 smokes × 2-5 min each is 2-3 hours. Use --only
// for a fast subset (e.g. the bank-cycle bots after a banking change).
//
// Each smoke is killed at DEFAULT_TIMEOUT (360s); a few legitimately-long smokes
// (see LONG below) get a bigger budget automatically. An explicit --timeout
// overrides that for every smoke.

import { readdirSync, mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Smokes that need a special environment (Electron desktop shell / prod origin /
// the multibox wall / a different port + Chrome channel) — not part of the
// local-engine bot sweep. Run these by hand when relevant.
const SPECIAL = ['desktop-test', 'hosted-proof-test', 'external-script-test', 'e2e-smoke', 'multibox-test'];

// Default per-smoke kill timeout (s). Smokes that legitimately run far longer
// than this (e.g. a full quest walk) get a bigger budget via LONG — keyed by
// filename substring → kill timeout (s). Both are only consulted when the user
// hasn't passed an explicit --timeout, which overrides everything.
const DEFAULT_TIMEOUT = 360;
const LONG: Record<string, number> = { 'rune-mysteries-test': 1600, 'ardythiever-kite-test': 900, 'ardythiever-fight-test': 900, 'essminer-test': 900 };

const args = process.argv.slice(2);
const optVal = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const hasFlag = (name: string): boolean => args.includes(name);
const splitList = (s: string | undefined): string[] => (s ?? '').split(',').map(x => x.trim()).filter(Boolean);

const base = optVal('--base') ?? 'http://localhost:8890';
const timeoutArg = optVal('--timeout');
const only = splitList(optVal('--only'));
const skip = splitList(optVal('--skip'));
const noDeploy = hasFlag('--no-deploy');
const listOnly = hasFlag('--list');

const LOG_DIR = 'out/smoke-logs';

// Per-smoke kill timeout (s). An explicit --timeout wins for every smoke;
// otherwise long-running smokes get their LONG entry, all others DEFAULT_TIMEOUT.
function killTimeoutSec(name: string): number {
    if (timeoutArg !== undefined) { return Number(timeoutArg); }
    const long = Object.entries(LONG).find(([sub]) => name.includes(sub));
    return long ? long[1] : DEFAULT_TIMEOUT;
}

function selectTests(): string[] {
    const all = readdirSync('tools').filter(f => f.endsWith('-test.ts')).sort();
    let tests = all.filter(f => !SPECIAL.some(s => f.includes(s)));
    if (only.length) { tests = tests.filter(f => only.some(o => f.includes(o))); }
    if (skip.length) { tests = tests.filter(f => !skip.some(s => f.includes(s))); }
    return tests;
}

async function engineUp(): Promise<boolean> {
    try {
        const r = await fetch(`${base}/bot.html`, { signal: AbortSignal.timeout(5000) });
        return r.ok;
    } catch {
        return false;
    }
}

async function deploy(): Promise<boolean> {
    console.log('deploying the current build (tools/deploy-local.sh)…');
    const proc = Bun.spawn(['sh', 'tools/deploy-local.sh'], { stdout: 'inherit', stderr: 'inherit' });
    return (await proc.exited) === 0;
}

type Result = { name: string; ok: boolean; sec: number; detail: string; timedOut: boolean };

async function runOne(name: string): Promise<Result> {
    const start = Date.now();
    // Write the child's stdout+stderr straight to the log file (an fd), NOT a
    // pipe: a timed-out smoke's orphaned headless-Chrome grandchild can hold the
    // stdout pipe open, so reading it back would hang the runner past the kill.
    // A file has no such dependency — SIGKILL the child, then read the file.
    const logPath = join(LOG_DIR, name.replace('.ts', '.log'));
    const fd = openSync(logPath, 'w');
    const proc = Bun.spawn(['bun', join('tools', name), base], { stdout: fd, stderr: fd });
    const timeoutSec = killTimeoutSec(name);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill(9); }, timeoutSec * 1000);
    const code = await proc.exited;
    clearTimeout(timer);
    closeSync(fd);

    const sec = Math.round((Date.now() - start) / 1000);
    const combined = readFileSync(logPath, 'utf8');

    const lines = combined.split('\n').map(l => l.trim()).filter(Boolean);
    // Ignore stack-trace / runtime-footer noise when picking a failure summary,
    // so a crash reports its actual error, not "Bun v1.3.14 (macOS arm64)".
    const junk = /^Bun v\d|^at\s|coreBundle|node_modules|^\^|^\d+\s*\||^\s*-\s/;
    const passLine = [...lines].reverse().find(l => /^PASS\b/.test(l));
    const failLine = [...lines].reverse().find(l => /^FAIL\b/.test(l));
    const errLine = [...lines].reverse().find(l => /\b(error|exception|timeout|assert|reject)/i.test(l) && !junk.test(l));
    const lastReal = [...lines].reverse().find(l => !junk.test(l));
    const ok = code === 0 && !timedOut;
    const raw = timedOut
        ? `timed out after ${timeoutSec}s`
        : ok
            ? (passLine ?? 'exit 0')
            : (failLine ?? errLine ?? lastReal ?? `exit ${code}`);
    const detail = raw.length > 140 ? `${raw.slice(0, 137)}…` : raw;
    return { name, ok, sec, detail, timedOut };
}

function hms(totalSec: number): string {
    const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
    return (h ? `${h}h ` : '') + (h || m ? `${m}m ` : '') + `${s}s`;
}

// --- main ---
const tests = selectTests();
if (tests.length === 0) { console.error('no smokes matched the filters'); process.exit(2); }

if (listOnly) {
    console.log(`${tests.length} smoke(s) would run against ${base}:`);
    for (const t of tests) { console.log(`  ${t.padEnd(34)} ${killTimeoutSec(t)}s timeout`); }
    process.exit(0);
}

if (!noDeploy) {
    if (!(await deploy())) { console.error('FAIL: deploy-local.sh failed — is ENGINE_DIR set / the engine checkout present?'); process.exit(2); }
}

if (!(await engineUp())) {
    console.error(`FAIL: engine not reachable at ${base}. Start it (\`npm run quickstart\` in ~/code/rs2b2t-engine) and retry.`);
    process.exit(2);
}

mkdirSync(LOG_DIR, { recursive: true });

const timeoutNote = timeoutArg !== undefined
    ? `${Number(timeoutArg)}s timeout each`
    : `${DEFAULT_TIMEOUT}s timeout each (longer for ${Object.keys(LONG).join(', ')})`;
console.log(`\nrunning ${tests.length} smoke(s) against ${base} — sequential, ${timeoutNote}. Logs → ${LOG_DIR}/\n`);
const runStart = Date.now();
const results: Result[] = [];
for (const t of tests) {
    process.stdout.write(`▶ ${t.padEnd(30)}`);
    const hb = setInterval(() => process.stdout.write('·'), 30000);
    const r = await runOne(t);
    clearInterval(hb);
    console.log(` ${r.ok ? '✓ PASS' : '✗ FAIL'} (${r.sec}s)${r.ok ? '' : ` — ${r.detail}`}`);
    results.push(r);
}

const passed = results.filter(r => r.ok);
const failed = results.filter(r => !r.ok);
const totalSec = Math.round((Date.now() - runStart) / 1000);

console.log('\n=== summary ===');
for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.replace('.ts', '').padEnd(28)} ${String(r.sec).padStart(4)}s  ${r.ok ? '' : r.detail}`);
}
console.log(`\n${passed.length}/${results.length} passed in ${hms(totalSec)}.`);
if (failed.length) {
    console.log(`${failed.length} failed:`);
    for (const r of failed) { console.log(`  ✗ ${r.name.replace('.ts', '')}: ${r.detail}  (log: ${LOG_DIR}/${r.name.replace('.ts', '.log')})`); }
}
process.exit(failed.length ? 1 : 0);
