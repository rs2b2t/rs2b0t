import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { getServerVarQuiet, mainlandAccount, relog, startScript, teleTo } from './tutorial/harness.js';

type Api = {
    __rs2b0t: { Inventory: { count(name: string): number }; Quests: { status(name: string): string } };
    rs2b0t: { reader: { worldTile(): { x: number; z: number; level: number } | null }; runner: { state: string; ctx: { log: { msg: string }[] } | null } };
};

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 6 });
const tag = `scout${Date.now().toString(36).slice(-6)}`;
const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const page = await browser.newPage();
const snapshot = () => page.evaluate(() => {
    const g = globalThis as never as Api;
    return { tile: g.rs2b0t.reader.worldTile(), quest: g.__rs2b0t.Quests.status('Death Plateau'),
        map: g.__rs2b0t.Inventory.count('Secret way map'), combination: g.__rs2b0t.Inventory.count('Combination'),
        state: g.rs2b0t.runner.state, logs: g.rs2b0t.runner.ctx?.log.slice(-16).map(line => line.msg) ?? [] };
});

try {
    await mainlandAccount(page, base, tag, client.page);
    for (const command of ['~clearinv', 'setvar death_equiproom 70', 'setvar death_map 7', 'give death_secretwaymap 1', 'give death_combination 1']) {
        assert(await cheatQuiet(page, command), command);
    }
    await relog(page, tag);
    assert(await teleTo(page, { x: 2820, z: 3558, level: 0 }, 0), 'Tenzing back-door fixture');
    assert.equal(await getServerVarQuiet(page, 'death_map'), 7, 'unscouted server state');
    const before = await snapshot();
    assert.equal(before.quest, 'inProgress');
    assert.equal(before.map, 1);
    assert.equal(before.combination, 1);
    await mkdir('docs/e2e', { recursive: true });
    await page.screenshot({ path: 'docs/e2e/issue-470-before.png', fullPage: true });
    await setSettings(page, 'AIOQuester', { quests: 'death' });
    await startScript(page, 'AIOQuester');
    await page.waitForFunction(() => {
        const tile = (globalThis as never as Api).rs2b0t.reader.worldTile();
        return tile !== null && tile.level === 0 && tile.x >= 2864 && tile.x < 2872 && tile.z >= 3608 && tile.z < 3616;
    }, undefined, { timeout: minutes * 60_000, polling: 100 });
    const entered = await snapshot();
    await stopScript(page);
    const mapStage = await getServerVarQuiet(page, 'death_map');
    assert.equal(mapStage, 8, 'walking into the secret-path zone advanced the server quest stage');
    await page.screenshot({ path: 'docs/e2e/issue-470.png', fullPage: true });
    await Bun.write('docs/e2e/issue-470.json', JSON.stringify({ issue: 470, result: 'PASS', at: new Date().toISOString(),
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), before, entered, mapStage }, null, 2) + '\n');
    console.log('PASS', JSON.stringify({ before, entered, mapStage }));
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
