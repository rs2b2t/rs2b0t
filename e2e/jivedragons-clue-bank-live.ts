import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser, setSettings, stopScript } from './lib/harness.js';
import { startScript } from './tutorial/harness.js';
import { cadence } from './fisher-shilo/cadence.js';
import { blackSettings } from './jivedragons-black-fixture.js';
import { seedClueBankFixture } from './jivedragons-clue-bank-fixture.js';
import { installClueBankTrace } from './jivedragons-clue-bank-trace.js';
import { assessClueBank } from './jivedragons-clue-bank-contract.js';
import { privateRunOutput } from './jive-private-boundary.mjs';
import { cleanupPrivate, confirmPrivateDisconnect, fetchPrivate, privateMainland, privateMutation, privatePage } from './jive-private-session.js';

const base = process.env.BASE, pagePath = process.env.E2E_CLIENT_PAGE, bundle = process.env.BLACK_BUNDLE;
const server = process.env.BLACK_SERVER_TRACE;
assert.equal(process.env.RUNTIME_AUTHORIZED, '1', 'parent runtime handoff required');
assert.equal(base, 'http://localhost:8891');
assert(process.env.ENGINE_DIR?.endsWith('/shilo-private/engine'));
assert.equal(process.env.HEADED, '1'); assert.equal(process.env.SLOWMO, '0');
assert(pagePath && bundle && server);
const out = privateRunOutput(process.env);
await mkdir(out, { recursive: false });
const html = await (await fetchPrivate(new URL(pagePath, base))).text();
const script = html.match(/src="([^"]*botclient\.js[^"]*)"/)?.[1];
assert(script);
const hash = (bytes: ArrayBuffer) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
const candidateHash = hash(await Bun.file(bundle).arrayBuffer());
assert.equal(hash(await (await fetchPrivate(new URL(script, `${base}${pagePath}`))).arrayBuffer()), candidateHash);
await Bun.write(`${out}/run.json`, JSON.stringify({ candidateHash, pagePath, clue: 2693, trailStatus: 0, preferredBank: { x: 2946, z: 3369 } }));
const browser = await launchBrowser({ swiftshader: true });
const user = `cb${Date.now().toString(36)}`;
const events: unknown[] = [];
try {
    const page = await privatePage(browser);
    try {
        await privateMainland(page, { user, pagePath, server });
        const timing = await privateMutation(server, user, () => cadence(page, true));
        assert(timing.after >= 150 && timing.after <= 250);
        const fixture = await privateMutation(server, user, () => seedClueBankFixture(page));
        await Bun.write(`${out}/fixture.json`, JSON.stringify({ user, timing, fixture }));
        await setSettings(page, 'JiveDragons', { ...blackSettings, site: 'taverley-blue', bankTile: '2946,3369,0',
            solveClues: true, rangingPotion: false, foodWithdraw: 10 });
        await installClueBankTrace(page);
        await privateMutation(server, user, () => startScript(page, 'JiveDragons'));
        const deadline = Date.now() + 240000;
        while (Date.now() < deadline) {
            await page.waitForTimeout(1000);
            events.push(...await page.evaluate(() => globalThis.__clueBankTrace?.events.splice(0) ?? []));
            const report = assessClueBank(events);
            if (report.passed || report.violations.length > 0) break;
        }
        await page.screenshot({ path: `${out}/final.png` });
    } finally {
        await cleanupPrivate([() => stopScript(page), async () => {
            events.push(...await page.evaluate(() => { const trace = globalThis.__clueBankTrace; trace?.restore(); return trace?.events ?? []; }));
            await Bun.write(`${out}/events.json`, JSON.stringify(events));
        }]);
    }
} finally {
    await cleanupPrivate([
        () => browser.close(),
        async () => { await Bun.write(`${out}/closed.json`, JSON.stringify({ user, at: Date.now(), closeAttempted: true })); },
        async () => { const result = await confirmPrivateDisconnect(server, user); await Bun.write(`${out}/disconnect.json`, JSON.stringify(result)); }
    ]);
}
const report = assessClueBank(events);
await Bun.write(`${out}/contract.json`, JSON.stringify(report, null, 2));
assert(report.passed, 'clue handoff failed or unobserved; inspect contract.json');
