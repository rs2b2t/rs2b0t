import { readdirSync, mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SPECIAL = ['desktop-test', 'hosted-proof-test', 'external-script-test', 'e2e-smoke', 'multibox-test', 'rendergate-test', 'merlin-tail-test', 'pip-solo-test'];

const DEFAULT_TIMEOUT = 360;
const LONG: Record<string, number> = { 'aio-quest-test': 1600, 'ardythiever-kite-test': 900, 'ardythiever-fight-test': 900, 'essminer-test': 900, 'shoprun-test': 900, 'cluesolve-test': 900, 'door-cross-test': 600, 'ardyfighter-clue-test': 900, 'autofighter-test': 900, 'cow-test': 600, 'greendragon-style-test': 600, 'mossgiant-style-test': 600, 'maze-test': 600, 'rockcrab-style-test': 600, 'rockcrab-multibot-test': 900, 'rockcrab-test': 900, 'fisher-banking-test': 900, 'bankfletcher-test': 600 };

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
