import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser, setSettings, stopScript } from './lib/harness.js';
import { startScript } from './tutorial/harness.js';
import { cadence } from './fisher-shilo/cadence.js';
import { blackSettings, seedBlackFixture } from './jivedragons-black-fixture.js';
import { installBlackTrace } from './jivedragons-black-trace.js';
import { blackReport } from './jivedragons-black-report.js';
import { seedPolicyPack } from './jivedragons-policy-fixture.js';
import { privateRunOutput } from './jive-private-boundary.mjs';
import { cleanupPrivate, confirmPrivateDisconnect, fetchPrivate, privateMainland, privateMutation, privatePage } from './jive-private-session.js';

const base = process.env.BASE;
assert.equal(process.env.RUNTIME_AUTHORIZED, '1', 'parent runtime handoff required');
assert.equal(base, 'http://localhost:8891', 'private server only');
assert(process.env.ENGINE_DIR?.endsWith('/shilo-private/engine'), 'explicit private engine required');
assert.equal(process.env.HEADED, '1');
assert.equal(process.env.SLOWMO, '0');
const serverPath = process.env.BLACK_SERVER_TRACE;
assert(serverPath, 'BLACK_SERVER_TRACE required');
const argv = process.argv.slice(2);
const option = (name: string) => argv[argv.indexOf(name) + 1];
const site = option('--site');
assert(site === 'black' || site === 'blue');
assert.equal(option('--style'), 'range');
assert.equal(option('--stand'), '1');
assert.equal(option('--tick'), '200');
assert(argv.includes('--no-starve'));
const minutes = Number(option('--minutes') ?? 6);
assert(minutes > 0 && minutes <= 20);
const tag = process.env.RUN_TAG;
const out = privateRunOutput(process.env);
await mkdir(out, { recursive: false });
const scenario = process.env.BLACK_SCENARIO ?? 'full';
assert(scenario === 'full' || scenario === 'ammo' || scenario === 'capacity');
const pagePath = process.env.E2E_CLIENT_PAGE;
const bundlePath = process.env.BLACK_BUNDLE;
assert(pagePath && bundlePath, 'explicit candidate page and bundle required');
const html = await (await fetchPrivate(new URL(pagePath, base))).text();
const script = html.match(/src="([^"]*botclient\.js[^"]*)"/)?.[1];
assert(script, 'bot client script missing');
const served = await (await fetchPrivate(new URL(script, `${base}${pagePath}`))).arrayBuffer();
const digest = (value: ArrayBuffer) => createHash('sha256').update(new Uint8Array(value)).digest('hex');
const hash = digest(await Bun.file(bundlePath).arrayBuffer());
assert.equal(digest(served), hash);
await Bun.write(`${out}/run.json`, JSON.stringify({ tag, pagePath, hash, argv, fixture: 'bank verified, then pre-run teleport to existing stand; natural combat only' }));
const browser = await launchBrowser({ swiftshader: true });
const user = `br${Date.now().toString(36)}`;
try {
    const page = await privatePage(browser);
    try {
        await privateMainland(page, { user, pagePath, server: serverPath });
        const timing = await privateMutation(serverPath, user, () => cadence(page, true));
        assert(timing.after >= 150 && timing.after <= 250);
        await page.evaluate(label => { document.title = label; }, `CANDIDATE ${site.toUpperCase()} FULL-FOOD ${tag}`);
        await privateMutation(serverPath, user, () => seedBlackFixture(page, site));
        const policyPack = scenario === 'full' ? null : await privateMutation(serverPath, user, () => seedPolicyPack(page, scenario));
        await setSettings(page, 'JiveDragons', { ...blackSettings, site: `taverley-${site}`,
            ...(scenario === 'ammo' ? { lootBlack: `${blackSettings.lootBlack}, Bronze arrow`, lootBlue: `${blackSettings.lootBlack}, Bronze arrow` } : {}) });
        await installBlackTrace(page, site);
        await privateMutation(serverPath, user, () => startScript(page, 'JiveDragons'));
        await Bun.write(`${out}/fixture.json`, JSON.stringify({ user, timing, scenario, policyPack, started: Date.now() }));
        console.log('CANDIDATE FULL-FOOD RUN', site, out, user, hash);
        const deadline = Date.now() + minutes * 60000;
        while (Date.now() < deadline) {
            await page.waitForTimeout(5000);
            const events = await page.evaluate(() => globalThis.__blackTrace?.events.splice(0) ?? []);
            await Bun.write(`${out}/events-${Date.now()}.json`, JSON.stringify(events));
            console.log('captured', events.length, 'events');
        }
        await page.screenshot({ path: `${out}/final.png` });
    } finally {
        await cleanupPrivate([() => stopScript(page), async () => {
            const events = await page.evaluate(() => {
                const events = globalThis.__blackTrace?.events ?? [];
                globalThis.__blackTrace?.restore();
                return events;
            });
            await Bun.write(`${out}/events-final.json`, JSON.stringify(events));
        }]);
    }
} finally {
    await cleanupPrivate([
        () => browser.close(),
        async () => { await Bun.write(`${out}/closed.json`, JSON.stringify({ user, at: Date.now(), closeAttempted: true })); },
        async () => { const result = await confirmPrivateDisconnect(serverPath, user); await Bun.write(`${out}/disconnect.json`, JSON.stringify(result)); }
    ]);
}
const report = await blackReport(out, serverPath, 'candidate');
const accepted = scenario === 'full' ? report.corePassed : report.safetyPassed
    && (scenario === 'ammo' ? report.policy.merges > 0 && report.policy.otherArrowLoot > 0 : report.policy.capacityMadeRoom > 0);
await Bun.write(`${out}/scenario.json`, JSON.stringify({ scenario, passed: accepted, completeProofPassed: report.passed }));
assert(accepted, 'requested scenario failed; contract.json retains all unobserved coverage gaps');
