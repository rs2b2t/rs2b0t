import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { getServerVarQuiet, mainlandAccount, relog, startScript, teleTo } from './tutorial/harness.js';

type Api = {
    __rs2b0t: { Inventory: { count(name: string): number; items(): { id: number; count: number }[] } };
    rs2b0t: { reader: { worldTile(): { x: number; z: number; level: number } | null }; runner: { state: string; ctx: { log: { msg: string }[] } | null } };
};

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 6 });
const tag = `drink${Date.now().toString(36).slice(-6)}`;
const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const page = await browser.newPage();
const snapshot = () => page.evaluate(() => {
    const g = globalThis as never as Api;
    return { tile: g.rs2b0t.reader.worldTile(), coins: g.__rs2b0t.Inventory.count('Coins'),
        inventory: g.__rs2b0t.Inventory.items().map(({ id, count }) => ({ id, count })),
        state: g.rs2b0t.runner.state, logs: g.rs2b0t.runner.ctx?.log.slice(-20).map(line => line.msg) ?? [] };
});

try {
    await mainlandAccount(page, base, tag, client.page);
    for (const command of ['~clearinv', 'setvar death_equiproom 50', 'setvar death_bits 0', 'give coins 500', 'give premade_blurberry_special 1']) {
        assert(await cheatQuiet(page, command), command);
    }
    await relog(page, tag);
    assert(await teleTo(page, { x: 2905, z: 3539, level: 1 }, 0));
    const before = await snapshot();
    assert.equal(before.coins, 500);
    assert(before.inventory.some(item => item.id === 2028));
    assert.equal(await getServerVarQuiet(page, 'death_bits'), 0);
    await setSettings(page, 'AIOQuester', { quests: 'death' });
    await startScript(page, 'AIOQuester');
    let won = false;
    const deadline = Date.now() + minutes * 60_000;
    while (Date.now() < deadline) {
        const state = await snapshot();
        const stage = await getServerVarQuiet(page, 'death_equiproom');
        console.log('STATE', JSON.stringify({ ...state, stage }));
        assert(state.coins >= before.coins, 'Harold won a stake');
        if (stage !== null && Number(stage) >= 55) { won = true; break; }
        assert.equal(state.state, 'running');
        await page.waitForTimeout(2500);
    }
    assert(won, 'Harold issued the IOU');
    const after = await snapshot();
    assert(!after.inventory.some(item => item.id === 2028), 'Harold drank the cocktail');
    assert(after.inventory.some(item => item.id === 3103 || item.id === 3102), 'IOU or combination received');
    await mkdir('out', { recursive: true });
    await page.screenshot({ path: 'out/issue-844.png', fullPage: true });
    await Bun.write('out/issue-844.json', JSON.stringify({ issue: 844, result: 'PASS', before, after }, null, 2) + '\n');
    console.log('PASS', JSON.stringify({ before, after }));
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
