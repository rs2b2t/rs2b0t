/** Live proof that Global auto-run stays on, a script-written `RunManager.override({ runAuto: false })`
 *  holds the orb off, and ScriptRunner start/stop clear the overlay back to Global.
 *
 *    HEADED=1 SLOWMO=0 bun e2e/run-override-live.ts [http://localhost:8890]
 *    HEADED=1 SLOWMO=0 ENGINE_DIR=~/experiments/lostcity-289/engine \
 *      bun e2e/run-override-live.ts http://127.0.0.1:1080
 */
import assert from 'node:assert/strict';

import { deployIsolatedClient, launchBrowser, logout, positionalArgs, setSettings, stopScript } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { restoreRunEnergy } from './lib/navLiveHarness.js';
import { cheatQuiet, mainlandAccount, startScript } from './tutorial/harness.js';

type Api = {
    __rs2b0t: {
        Game: { runEnabled(): boolean; energy(): number; openSideTab(tab: number): Promise<boolean> };
    };
    rs2b0t: {
        actions: { setRun(on: boolean): boolean };
        runManager: { override(policy: { runAuto?: boolean; energyMin?: number } | null): void };
        runner: { state: string };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
};

assert.equal(process.env.HEADED, '1', 'headed proof required');

const [base] = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const proof = createHarnessProof({ issue: 0, slug: 'run-override' });
const tag = `runov${Date.now().toString(36).slice(-6)}`;
const HOLD_MS = 3500;

const snap = (page: import('playwright-core').Page) =>
    page.evaluate(() => {
        const g = globalThis as never as Api;
        return {
            run: g.__rs2b0t.Game.runEnabled(),
            energy: g.__rs2b0t.Game.energy(),
            tile: g.rs2b0t.reader.worldTile(),
            state: g.rs2b0t.runner.state
        };
    });

async function waitRun(
    page: import('playwright-core').Page,
    want: boolean,
    ms: number
): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if ((await snap(page)).run === want) {
            return true;
        }
        await page.waitForTimeout(50);
    }
    return (await snap(page)).run === want;
}

async function turnRunOff(page: import('playwright-core').Page): Promise<void> {
    assert(await page.evaluate(() => (globalThis as never as Api).rs2b0t.actions.setRun(false)));
    assert(await waitRun(page, false, HOLD_MS), 'setRun(false) never turned run off');
}

async function expectRunHolds(page: import('playwright-core').Page, want: boolean, message: string): Promise<void> {
    const deadline = Date.now() + HOLD_MS;
    while (Date.now() < deadline) {
        const seen = await snap(page);
        assert.equal(seen.run, want, `${message} (energy=${seen.energy})`);
        await page.waitForTimeout(200);
    }
}

const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const page = await browser.newPage();
const phases: Record<string, unknown> = {};

try {
    await mainlandAccount(page, base, tag, client.page);
    assert(await cheatQuiet(page, 'tele 0,50,50,20,20'));
    await setSettings(page, 'Global', { runAuto: true, runEnergyMin: 20 });
    assert(await restoreRunEnergy(page), '~energy did not refill run energy');
    await page.evaluate(async () => {
        await (globalThis as never as Api).__rs2b0t.Game.openSideTab(12);
    });

    const hasOverride = await page.evaluate(
        () => typeof (globalThis as never as Api).rs2b0t.runManager?.override === 'function'
    );
    assert(hasOverride, 'rs2b0t.runManager.override missing — this client is not the branch under test');

    const ready = await snap(page);
    assert(ready.energy >= 90, `need full energy, saw ${ready.energy}`);
    phases.ready = ready;

    await turnRunOff(page);
    phases.afterGlobalOff = await snap(page);
    assert(await waitRun(page, true, HOLD_MS), 'Global runAuto should flip run back on');
    phases.globalReenable = await snap(page);

    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runManager.override({ runAuto: false }));
    await turnRunOff(page);
    await expectRunHolds(page, false, 'override({ runAuto: false }) must not re-enable run');
    phases.overrideHolds = await snap(page);

    await startScript(page, 'DoorOpener');
    await page.waitForTimeout(400);
    assert.equal((await snap(page)).state, 'running');
    await turnRunOff(page);
    assert(await waitRun(page, true, HOLD_MS), 'starting a script should clear the overlay so Global re-enables run');
    phases.startClears = await snap(page);

    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runManager.override({ runAuto: false }));
    await turnRunOff(page);
    await expectRunHolds(page, false, 'override while a script is running must hold run off');
    phases.overrideWhileRunning = await snap(page);

    await stopScript(page);
    await page.waitForTimeout(400);
    await turnRunOff(page);
    assert(await waitRun(page, true, HOLD_MS), 'stopping a script should clear the overlay so Global re-enables run');
    phases.stopClears = await snap(page);

    await proof.writeSuccess(page, { tag, phases });
    console.log('PASS', JSON.stringify(phases));
} catch (error) {
    await proof.writeFailure(page, { tag, phases, error: error instanceof Error ? error.message : String(error) });
    console.log('FAILURE STATE', JSON.stringify({ phases, snap: await snap(page).catch(() => null) }));
    throw error;
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
