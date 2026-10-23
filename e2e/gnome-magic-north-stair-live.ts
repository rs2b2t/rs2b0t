import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

interface BrowserGlobal {
    rs2b0t: {
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        runner: {
            ctx: { log: { msg: string }[] } | null;
            bot: { queryClimbLocs(): { id: number; name: string; tile(): unknown }[] } | null;
        };
    };
}

const { base } = parseArgs(process.argv.slice(2));
const tag = `gnome-${Date.now().toString(36)}`;
const user = `gn${Date.now().toString(36).slice(-8)}`;
const proofDir = process.env.PROOF_DIR ?? 'out';
const proof = createHarnessProof({ slug: tag, proofDir, screenshotDir: proofDir });
const client = deployIsolatedClient(tag);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const snapshots: unknown[] = [];
try {
    await mainlandAccount(page, base, user, client.page);
    assert(await teleTo(page, { x: 2445, z: 3436, level: 0 }, 1), 'north stair fixture teleport');
    await setSettings(page, 'GnomeMagicChopper', { fletchLogs: false });
    await startScript(page, 'GnomeMagicChopper');
    const deadline = Date.now() + 90_000;
    let passed = false;
    let rejected = false;
    while (Date.now() < deadline) {
        const snapshot = await page.evaluate(() => {
            // Why: the client installs its harness ABI in the browser, outside this module's types.
            const globals = globalThis as unknown as BrowserGlobal;
            const g = globals.rs2b0t;
            return {
                tile: g.reader.worldTile(),
                logs: g.runner.ctx?.log.map(l => l.msg) ?? [],
                stairs: g.runner.bot?.queryClimbLocs().map(l => ({ id: l.id, name: l.name, tile: l.tile() })) ?? []
            };
        });
        snapshots.push(snapshot);
        console.log(JSON.stringify(snapshot));
        passed = snapshot.tile?.level === 1 && snapshot.logs.some(m => m.includes('2445,3434 (bank stairs only)'));
        rejected = snapshot.logs.filter(m => m.includes('no allowed bank staircase')).length >= 2;
        if (passed || rejected) break;
        await page.waitForTimeout(1200);
    }
    const body = { user, base, tag, fixture: 'Teleport north of the real stairs; run unmodified GnomeMagicChopper gear bootstrap', snapshots, result: passed ? 'PASS' : 'FAIL', rejected };
    if (passed) await proof.writeSuccess(page, body);
    else await proof.writeBaseline(page, body);
    assert(passed, rejected ? 'real north stair rejected by script pin filter' : 'north stair ascent timed out');
} catch (error) {
    await proof.writeFailure(page);
    await Bun.write(`${proofDir}/${tag}-error.json`, JSON.stringify({ error: String(error), snapshots }, null, 2));
    throw error;
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => undefined);
    await browser.close();
    client.cleanup();
    const engine = process.env.ENGINE_DIR;
    assert(engine, 'ENGINE_DIR required for cleanup check');
    for (const path of [`${engine}/public/bot/${tag}`, `${engine}/public/bot-${tag}.html`]) {
        assert(!existsSync(path), `isolated deploy cleanup: ${path}`);
        console.log(`cleanup absent: ${path}`);
    }
}
