import assert from 'node:assert/strict';
import { mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { launchBrowser, setSettings, stopScript } from './lib/harness.js';
import { startScript } from './tutorial/harness.js';
import { cadence } from './fisher-shilo/cadence.js';
import { blackSettings } from './jivedragons-black-fixture.js';
import { assertPrivateEnvironment, privateScenario } from './jive-private-config.js';
import { seedPrivateClue } from './jive-private-fixture.js';
import { installPrivateTrace } from './jive-private-trace.js';
import { privateReport } from './jive-private-report.js';
import { readPrivateFrames } from './jive-private-server.js';
import type { PrivateEvent } from './jive-private-types.js';
import { privateRunOutput } from './jive-private-boundary.mjs';
import { cleanupPrivate, confirmPrivateDisconnect, privateMainland, privateMutation, privatePage } from './jive-private-session.js';

export function privateRunFailed(events: readonly Pick<PrivateEvent, 'kind' | 'status' | 'hp'>[]) {
    return events.some(e => e.hp <= 0 || e.status.startsWith('reward blocked:')
        || (e.kind === 'solver-end' && ['abandoned', 'guardian-lost', 'dead'].includes(e.status)));
}

export async function runPrivateClue() {
    const c = assertPrivateEnvironment(process.env);
    const out = privateRunOutput(process.env);
    assert.equal(await realpath(c.engine), await realpath('../shilo-private/engine'));
    const expectedFixture = process.env.JIVE_REWARD_FIXTURE_SHA256;
    assert(expectedFixture && /^[a-f0-9]{64}$/.test(expectedFixture), 'authorized private reward source hash required');
    const fetchLocal = async (url: URL) => {
        assert.equal(url.origin, c.base);
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
        assert(response.ok);
        return response;
    };
    const pageUrl = new URL(c.pagePath, c.base);
    const html = await (await fetchLocal(pageUrl)).text();
    const script = html.match(/src="([^"]*botclient\.js[^"]*)"/)?.[1];
    assert(script, 'candidate client script absent');
    const digest = (bytes: ArrayBuffer) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
    const bundleHash = digest(await Bun.file(c.bundle).arrayBuffer());
    assert.equal(digest(await (await fetchLocal(new URL(script, pageUrl))).arrayBuffer()), bundleHash);
    const beforeFrames = await readPrivateFrames(c.server);
    const fresh = beforeFrames.at(-1);
    assert(fresh && Date.now() - fresh.at < 1000 && fresh.players.length === 0, 'fresh empty private observer required');
    assert.equal(fresh.fixture, expectedFixture);
    const user = `jc${Date.now().toString(36)}`;
    await mkdir(out, { recursive: false });
    const f = privateScenario(c.scenario);
    await Bun.write(`${out}/run.json`, JSON.stringify({ ...c, bundleHash, expectedFixture, user, fixture: f,
        observer: resolve('e2e/jive-private-observer.mjs'), started: Date.now() }, null, 2));
    const browser = await launchBrowser({ swiftshader: true });
    const events: PrivateEvent[] = [];
    try {
        const page = await privatePage(browser);
        try {
            await privateMainland(page, { user, pagePath: c.pagePath, server: c.server });
            const timing = await privateMutation(c.server, user, () => cadence(page, true));
            assert(timing.after >= 150 && timing.after <= 250);
            const fixture = await privateMutation(c.server, user, () => seedPrivateClue(page, c.scenario, { server: c.server, user }));
            await Bun.write(`${out}/fixture.json`, JSON.stringify({ user, timing, fixture }, null, 2));
            await setSettings(page, 'JiveDragons', { ...blackSettings, site: 'taverley-blue', bankTile: '2946,3369,0',
                solveClues: true, rangingPotion: false, loadout: '', foodWithdraw: f.sharks, healTo: 90 });
            await installPrivateTrace(page, f.clueId);
            await page.screenshot({ path: `${out}/initial.png` });
            await privateMutation(c.server, user, () => startScript(page, 'JiveDragons'));
            const deadline = Date.now() + 600000;
            let blockedAt: number | null = null, solved = false;
            while (Date.now() < deadline) {
                await page.waitForTimeout(200);
                const batch = await page.evaluate(() => globalThis.__jivePrivate?.events.splice(0) ?? []);
                events.push(...batch);
                await Bun.write(`${out}/events.json`, JSON.stringify(events));
                if (batch.some(e => e.manifest.length > 0)) await page.screenshot({ path: `${out}/manifest.png` });
                solved ||= batch.some(e => e.kind === 'solved');
                if (batch.some(e => e.kind === 'solver-end' && /^(hard kit: |hard kit blocked)/.test(e.status))) blockedAt ??= Date.now();
                if ((blockedAt !== null && Date.now() - blockedAt >= 2000) || (solved && batch.some(e => e.kind === 'host-resume'))) break;
                if (privateRunFailed(batch)) break;
            }
            await page.screenshot({ path: `${out}/final.png` });
        } catch (error) {
            try { await page.screenshot({ path: `${out}/early-failure.png` }); }
            catch (captureError) { console.error('private failure screenshot failed', captureError); }
            throw error;
        } finally {
            try { await stopScript(page); }
            finally {
                events.push(...await page.evaluate(() => {
                    const trace = globalThis.__jivePrivate;
                    trace?.restore();
                    return trace?.events ?? [];
                }));
                await Bun.write(`${out}/events.json`, JSON.stringify(events));
            }
        }
    } finally {
        await cleanupPrivate([
            () => browser.close(),
            async () => { await Bun.write(`${out}/closed.json`, JSON.stringify({ user, at: Date.now(), closeAttempted: true })); },
            async () => { const result = await confirmPrivateDisconnect(c.server, user); await Bun.write(`${out}/disconnect.json`, JSON.stringify(result)); }
        ]);
        const frames = (await readPrivateFrames(c.server)).filter(f => f.at >= (events[0]?.at ?? Date.now()) - 500);
        await Bun.write(`${out}/server.json`, JSON.stringify(frames));
        const report = privateReport({ scenario: c.scenario, user, events, frames });
        await Bun.write(`${out}/contract.json`, JSON.stringify(report, null, 2));
    }
    const report = privateReport({ scenario: c.scenario, user, events, frames: await readPrivateFrames(c.server) });
    assert(report.passed, 'private scenario failed or unobserved; inspect contract.json');
}

if (import.meta.main) await runPrivateClue();
