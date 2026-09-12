import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

type Api = {
    __rs2b0t: { Inventory: { count(name: string): number }; Skills: { xp(name: string): number }; Game: { tick(): number } };
    rs2b0t: {
        reader: { worldTile(): { x: number; z: number; level: number } | null; npcs(): { id: number; name: string | null; distance: number }[] };
        runner: { state: string; bot: { status: string } | null; ctx: { log: { msg: string }[] } | null };
    };
};

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 5 });
const tag = `sweep${Date.now().toString(36).slice(-6)}`;
const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const page = await browser.newPage();
const snapshot = () => page.evaluate(() => {
    const g = globalThis as never as Api;
    return { tile: g.rs2b0t.reader.worldTile(), tick: g.__rs2b0t.Game.tick(), xp: g.__rs2b0t.Skills.xp('fishing'),
        fish: g.__rs2b0t.Inventory.count('Raw tuna') + g.__rs2b0t.Inventory.count('Raw swordfish'),
        tool: g.__rs2b0t.Inventory.count('Harpoon'), spots: g.rs2b0t.reader.npcs().filter(npc => npc.name === 'Fishing spot'),
        state: g.rs2b0t.runner.state, status: g.rs2b0t.runner.bot?.status,
        logs: g.rs2b0t.runner.ctx?.log.slice(-12).map(line => line.msg) ?? [] };
});

try {
    await mainlandAccount(page, base, tag, client.page);
    assert(await cheatQuiet(page, 'setstat fishing 70'), 'fishing fixture');
    await clearChatDialogs(page);
    assert(await cheatQuiet(page, '~clearinv'), 'empty inventory');
    assert(await cheatQuiet(page, 'give harpoon 1'), 'fishing tool');
    assert(await teleTo(page, { x: 2819, z: 3437, level: 0 }, 0), 'west of Catherby spot visibility');
    await page.waitForTimeout(2000);
    const before = await snapshot();
    assert(before.tile, 'player tile');
    assert(Math.max(Math.abs(before.tile.x - 2845), Math.abs(before.tile.z - 3431)) <= 28, 'inside the no-target return threshold');
    assert.equal(before.spots.length, 0, 'no fishing NPC visible at the starting tile');
    assert.equal(before.tool, 1);
    assert.equal(before.fish, 0);
    await mkdir('docs/e2e', { recursive: true });
    await page.screenshot({ path: 'docs/e2e/issue-687-before.png', fullPage: true });
    await setSettings(page, 'Fisher', { fishMethod: 'Harpoon — tuna/swordfish', location: 'Catherby', cookMode: 'Off',
        toolAcquire: 'Off', forgetfulBank: false, guildFeatherMinutes: 0, muleMode: 'Off', mulePartner: '' });
    await startScript(page, 'Fisher');
    let sweep: Awaited<ReturnType<typeof snapshot>> | null = null;
    let caught: Awaited<ReturnType<typeof snapshot>> | null = null;
    const deadline = Date.now() + minutes * 60_000;
    let printed = 0;
    while (Date.now() < deadline) {
        const state = await snapshot();
        if (state.status?.includes('sweeping') && sweep === null) sweep = state;
        if (Date.now() - printed > 5000) { console.log('STATE', JSON.stringify(state)); printed = Date.now(); }
        if (state.xp > before.xp && state.fish > 0) { caught = state; break; }
        assert.equal(state.state, 'running', 'Fisher stayed active');
        await page.waitForTimeout(200);
    }
    assert(sweep, 'the missing-target task entered the shoreline sweep');
    assert(caught, 'the shore sweep found fish and gained Fishing XP');
    assert.notDeepEqual(caught.tile, before.tile, 'Fisher moved to a visible fishing spot');
    assert(caught.spots.length > 0, 'fishing NPC visible after sweeping');
    assert(caught.tick > before.tick, 'server ticks advanced');
    await stopScript(page);
    await page.screenshot({ path: 'docs/e2e/issue-687.png', fullPage: true });
    await Bun.write('docs/e2e/issue-687.json', JSON.stringify({ issue: 687, result: 'PASS', at: new Date().toISOString(),
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), before, sweep, caught }, null, 2) + '\n');
    console.log('PASS', JSON.stringify({ before, sweep, caught }));
} catch (error) {
    console.log('FAILURE STATE', JSON.stringify(await snapshot().catch(() => null)));
    await mkdir('out', { recursive: true });
    await page.screenshot({ path: 'out/issue-687-failure.png', fullPage: true }).catch(() => undefined);
    throw error;
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
