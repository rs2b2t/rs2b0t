import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { launchBrowser, setSettings } from './lib/harness.js';
import { mainlandAccount, startScript, cheatQuiet, clearChatDialogs, relog, teleTo } from './tutorial/harness.js';
import { cadence } from './fisher-shilo/cadence.js';
import { cleanLogout } from './fisher-shilo/cleanup.js';
import { assessNorthTrip } from './fisher-shilo/north-contract.js';
import { installNorthTrace, readNorthTrace } from './fisher-shilo/north-trace.js';
import { parseNorthServer, verifyNorthServer } from './fisher-shilo/north-server.js';

async function main(): Promise<void> {
    const base = process.env.BASE ?? 'http://localhost:8891';
    assert.equal(base, 'http://localhost:8891', 'private fixture origin required');
    assert.equal(process.env.HEADED, '1', 'headed proof required');
    const client = process.env.E2E_CLIENT_PAGE;
    assert(client?.startsWith('/bot-north-'), 'isolated private client required');
    const observer = process.env.NORTH_SERVER_TRACE;
    assert(observer && observer.includes('/shilo-private/'), 'private server observer required');
    const deadlineMs = Number(process.env.NORTH_DEADLINE_MS ?? 900000);
    assert(deadlineMs > 0 && deadlineMs <= 900000, 'deadline must be bounded to 15 minutes');
    const directory = `out/e2e/north-${Date.now()}`;
    await mkdir(directory, { recursive: true });
    const browser = await launchBrowser();
    const page = await browser.newPage();
    const username = `nf${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let started = 0;
    let status = 'incomplete';
    let failure: string | undefined;
    let timing: Awaited<ReturnType<typeof cadence>> | undefined;
    let cleanup: Awaited<ReturnType<typeof cleanLogout>> | undefined;
    try {
        await mainlandAccount(page, base, username, client);
        timing = await cadence(page, true);
        assert(timing.after >= 150 && timing.after <= 250, '200ms tick cadence required');
        assert(await cheatQuiet(page, 'setvar zombiequeen 15'));
        await relog(page, username);
        assert(await cheatQuiet(page, 'setstat fishing 99'));
        await clearChatDialogs(page);
        assert(await teleTo(page, { x: 2852, z: 2954, level: 0 }, 1, 25000));
        for (const command of ['~clearinv', 'give fly_fishing_rod 1', 'give feather 10000']) assert(await cheatQuiet(page, command));
        await page.waitForFunction(() => window.__rs2b0t.Inventory.used() === 2 && window.__rs2b0t.Inventory.count('Feather') === 10000);
        await setSettings(page, 'Fisher', { fishMethod: 'Fly fishing — trout/salmon', location: 'Shilo Village',
            cookMode: 'Off', toolAcquire: 'Off', forgetfulBank: false, guildFeatherMinutes: 0,
            leashRadius: 30, muleMode: 'Off', mulePartner: '' });
        started = Date.now();
        await installNorthTrace(page);
        await page.screenshot({ path: `${directory}/start.png` });
        await startScript(page, 'Fisher');
        while (Date.now() - started < deadlineMs) {
            const trace = await readNorthTrace(page);
            status = assessNorthTrip(trace.samples);
            if (status === 'pass') break;
            await page.waitForTimeout(1000);
        }
        assert.equal(status, 'pass', 'north catch-bank-return-catch deadline exceeded');
        const selections = (await readNorthTrace(page)).selections;
        const lures = selections.filter(event => event.action === 'Lure');
        assert(lures.length >= 2 && lures.every(event => event.id === 317 && event.z >= 2976), 'north NPC selections on both trips required');
        assert(selections.some(event => event.action === 'Bank' && event.z <= 2957), 'actual south teller interaction required');
        assert.deepEqual(errors, []);
    } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        status = 'fail';
        throw error;
    } finally {
        try {
            await page.evaluate(() => globalThis.rs2b0t?.runner.stop('north proof teardown'));
            const trace = await readNorthTrace(page);
            await page.screenshot({ path: `${directory}/final.png` });
            await page.evaluate(() => globalThis.__northTrace?.restore());
            const ended = Date.now();
            cleanup = await cleanLogout(page);
            const server = parseNorthServer(await readFile(observer, 'utf8'), username).filter(value => value.at >= started && value.at <= ended);
            try { verifyNorthServer(server); } catch (error) {
                status = 'fail';
                failure = error instanceof Error ? error.message : String(error);
            }
            await writeFile(`${directory}/evidence.json`, JSON.stringify({ status, failure, username, client, started, timing, cleanup, errors, trace, server }, null, 2));
            verifyNorthServer(server);
        } finally {
            await browser.close();
            let disconnected = false;
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
                const last = parseNorthServer(await readFile(observer, 'utf8'), username).at(-1);
                if (last && last.at > started && last.player === null) { disconnected = true; break; }
                await setTimeout(500);
            }
            await writeFile(`${directory}/disconnect.json`, JSON.stringify({ username, disconnected, at: Date.now() }, null, 2));
            assert(disconnected, 'test account still present after closing owned browser');
            console.log(`North proof ${status}: ${directory}/evidence.json`);
        }
    }
}

if (import.meta.main) main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
