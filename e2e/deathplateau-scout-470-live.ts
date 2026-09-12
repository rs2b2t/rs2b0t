import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { getServerVarQuiet, mainlandAccount, relog, startScript, teleTo } from './tutorial/harness.js';

type Api = {
    __rs2b0t: { Inventory: { count(name: string): number }; Quests: { status(name: string): string }; Skills: { effective(name: string): number }; Game: { inCombat(): boolean }; Prayer: { set(name: string, on: boolean): Promise<boolean>; active(name: string): boolean } };
    rs2b0t: { reader: { worldTile(): { x: number; z: number; level: number } | null; npcs(): { name: string | null; distance: number }[] }; runner: { state: string; bot: { status: string } | null; ctx: { log: { msg: string }[] } | null } };
};

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 6 });
const tag = `scout${Date.now().toString(36).slice(-6)}`;
const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const page = await browser.newPage();
const snapshot = () => page.evaluate(() => {
    const g = globalThis as never as Api;
    return { tile: g.rs2b0t.reader.worldTile(), quest: g.__rs2b0t.Quests.status('Death Plateau'),
        hp: g.__rs2b0t.Skills.effective('hitpoints'), prayer: g.__rs2b0t.Skills.effective('prayer'), protected: g.__rs2b0t.Prayer.active('Protect from Missiles'), combat: g.__rs2b0t.Game.inCombat(), npcs: g.rs2b0t.reader.npcs().filter(npc => npc.distance <= 8),
        map: g.__rs2b0t.Inventory.count('Secret way map'), combination: g.__rs2b0t.Inventory.count('Combination'),
        state: g.rs2b0t.runner.state, step: g.rs2b0t.runner.bot?.status, logs: g.rs2b0t.runner.ctx?.log.slice(-16).map(line => line.msg) ?? [] };
});

try {
    await mainlandAccount(page, base, tag, client.page);
    for (const command of ['setstat hitpoints 99', 'setstat defence 99', 'setstat prayer 99', '~clearinv', 'setvar death_equiproom 70', 'setvar death_map 7', 'give death_secretwaymap 1', 'give death_combination 1']) {
        assert(await cheatQuiet(page, command), command);
    }
    await relog(page, tag);
    assert(await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Prayer.set('Protect from Missiles', true)), 'protection from the thrower trolls');
    assert(await teleTo(page, { x: 2864, z: 3605, level: 0 }, 0), 'three tiles south of the scout trigger');
    assert.equal(await getServerVarQuiet(page, 'death_map'), 7, 'unscouted server state');
    const before = await snapshot();
    assert.equal(before.quest, 'inProgress');
    assert(before.hp > 0 && before.protected, 'survivable scouting fixture');
    assert.equal(before.map, 1);
    assert.equal(before.combination, 1);
    assert.deepEqual(before.tile, { x: 2864, z: 3605, level: 0 });
    await mkdir('docs/e2e', { recursive: true });
    await page.screenshot({ path: 'docs/e2e/issue-470-before.png', fullPage: true });
    await setSettings(page, 'AIOQuester', { quests: 'death' });
    await startScript(page, 'AIOQuester');
    const deadline = Date.now() + minutes * 60_000;
    let entered: Awaited<ReturnType<typeof snapshot>> | null = null;
    let printed = 0;
    while (Date.now() < deadline) {
        const state = await snapshot();
        const tile = state.tile;
        if (tile && tile.level === 0 && tile.x >= 2864 && tile.x < 2872 && tile.z >= 3608 && tile.z < 3616) { entered = state; break; }
        if (Date.now() - printed > 10_000) {
            console.log('STATE', JSON.stringify({ ...state, deathMap: await getServerVarQuiet(page, 'death_map') }));
            printed = Date.now();
        }
        assert.equal(state.state, 'running', 'AIOQuester stayed active');
        assert(tile && tile.x >= 2800 && tile.x <= 2920 && tile.z >= 3500 && tile.z <= 3650, 'scouting left the Death Plateau fixture area');
        await page.waitForTimeout(100);
    }
    assert(entered, 'AIOQuester reached the scout trigger zone');
    await stopScript(page);
    const mapStage = await getServerVarQuiet(page, 'death_map');
    assert.equal(mapStage, 8, 'walking into the secret-path zone advanced the server quest stage');
    await page.screenshot({ path: 'docs/e2e/issue-470.png', fullPage: true });
    await Bun.write('docs/e2e/issue-470.json', JSON.stringify({ issue: 470, result: 'PASS', at: new Date().toISOString(),
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), before, entered, mapStage }, null, 2) + '\n');
    console.log('PASS', JSON.stringify({ before, entered, mapStage }));
} catch (error) {
    console.log('FAILURE STATE', JSON.stringify({ state: await snapshot().catch(() => null), deathMap: await getServerVarQuiet(page, 'death_map').catch(() => null) }));
    await mkdir('out', { recursive: true });
    await page.screenshot({ path: 'out/issue-470-failure.png', fullPage: true }).catch(() => undefined);
    throw error;
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
