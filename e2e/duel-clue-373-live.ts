import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { cheatQuiet, deployIsolatedClient, launchBrowser, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, relog, startScript, teleTo } from './tutorial/harness.js';
import type { reader } from '../src/bot/adapter/ClientAdapter.js';

interface Api {
    __rs2b0t: { reader: typeof reader };
    rs2b0t: { runner: { state: string; stop(reason: string): void; ctx: { log: { msg: string }[] } | null } };
}
const base = process.argv[2] ?? 'http://localhost:8890';
const tag = Date.now().toString(36).slice(-6);
const solverName = `ds${tag}`;
const helperName = `dh${tag}`;
const client = deployIsolatedClient(`dc${tag}`);
const browser = await launchBrowser();
const solver = await browser.newPage();
const helper = await browser.newPage();
const snap = (page: Page) => page.evaluate(() => {
    const g = globalThis as never as Api;
    return { tile: g.__rs2b0t.reader.worldTile(), hp: g.__rs2b0t.reader.stat(3).effective, modal: g.__rs2b0t.reader.modals(), options: g.__rs2b0t.reader.varp(286), inventory: g.__rs2b0t.reader.inventory(), state: g.rs2b0t.runner.state, logs: g.rs2b0t.runner.ctx?.log.map(row => row.msg) ?? [] };
});
try {
    for (const [page, name] of [[solver, solverName], [helper, helperName]] as const) {
        await mainlandAccount(page, base, name, client.page);
        assert(await cheatQuiet(page, '~clearinv'));
        assert(await teleTo(page, { x: 3368, z: 3274, level: 0 }, 1, 30_000));
    }
    for (const skill of ['attack', 'strength', 'defence', 'hitpoints', 'prayer']) assert(await cheatQuiet(solver, `setstat ${skill} 99`));
    await clearChatDialogs(solver, 'levels');
    assert(await cheatQuiet(solver, 'setvar zanaris 6'));
    assert(await cheatQuiet(solver, 'setvar trail_status 133'));
    for (const item of ['trail_clue_hard_sextant028 1', 'trail_sextant 1', 'trail_watch 1', 'trail_chart 1', 'spade 1', 'dragon_dagger_p 1', '4dose2antipoison 1', 'shark 15', 'coins 1000']) assert(await cheatQuiet(solver, `give ${item}`));
    await relog(solver, solverName);
    await setSettings(solver, 'Global', { clueDuelPartner: helperName });
    await setSettings(solver, 'ClueSolver', { useTeleports: false, restorePrayer: false });
    await setSettings(helper, 'Duel Arena Combat Trainer', { mode: 'Clue helper', partner: solverName });
    await startScript(helper, 'Duel Arena Combat Trainer');
    await startScript(solver, 'ClueSolver');
    const before = { solver: await snap(solver), helper: await snap(helper) };
    let entered = false;
    let casket = false;
    let complete = false;
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
        const current = await snap(solver);
        const tile = current.tile;
        if (tile && tile.x >= 3364 && tile.x <= 3388 && tile.z >= 3244 && tile.z <= 3258) entered = true;
        if (current.inventory.some(item => item.id === 3555)) casket = true;
        complete = entered && current.logs.some(line => line.includes('[clue] banked the reward')) && !!tile && tile.z > 3258;
        if (complete) break;
        console.log(JSON.stringify({ tile, state: current.state, logs: current.logs.slice(-3) }));
        await solver.waitForTimeout(2000);
    }
    const after = { solver: await snap(solver), helper: await snap(helper) };
    writeFileSync('docs/e2e/duel-clue-373.json', JSON.stringify({ before, after, entered, casket, complete }, null, 2) + '\n');
    await solver.screenshot({ path: 'docs/e2e/duel-clue-373-solver.png' });
    await helper.screenshot({ path: 'docs/e2e/duel-clue-373-helper.png' });
    assert(entered, 'solver never entered the target obstacle arena');
    assert(casket, 'solver never obtained casket3555');
    assert(complete, 'solver did not complete the trail, leave the arena and bank the reward');
    assert.equal(after.helper.hp, before.helper.hp);
    assert.equal(after.solver.hp, before.solver.hp);
    console.log(JSON.stringify({ entered, casket, complete, after }, null, 2));
} finally {
    for (const page of [solver, helper]) await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness complete')).catch(() => {});
    await browser.close();
    client.cleanup();
}
