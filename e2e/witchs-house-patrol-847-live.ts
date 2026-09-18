import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { getServerVarQuiet, mainlandAccount, relog, startScript, teleTo } from './tutorial/harness.js';

type Api = {
    __rs2b0t: {
        Inventory: { items(): { id: number; count: number; name: string; interact(op: string): boolean | Promise<boolean> }[] };
        Game: { runEnabled(): boolean; energy(): number };
        Quests: { status(name: string): string };
    };
    rs2b0t: {
        actions: { setRun(on: boolean): boolean };
        reader: { worldTile(): { x: number; z: number; level: number } | null; serverTile(): { x: number; z: number; level: number } | null; npcs(): { id: number; tile: { x: number; z: number }; networkTile: { x: number; z: number } }[] };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
    };
};

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 12 });
const tag = `hedge${Date.now().toString(36).slice(-6)}`;
const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const page = await browser.newPage();
const snapshot = () => page.evaluate(() => {
    const g = globalThis as never as Api;
    return { tile: g.rs2b0t.reader.serverTile(), sprite: g.rs2b0t.reader.worldTile(), quest: g.__rs2b0t.Quests.status("Witch's House"),
        run: g.__rs2b0t.Game.runEnabled(), energy: g.__rs2b0t.Game.energy(),
        inventory: g.__rs2b0t.Inventory.items().map(({ id, count }) => ({ id, count })),
        witch: g.rs2b0t.reader.npcs().find(npc => npc.id === 896),
        state: g.rs2b0t.runner.state, logs: g.rs2b0t.runner.ctx?.log.slice(-16).map(line => line.msg) ?? [] };
});

try {
    await mainlandAccount(page, base, tag, client.page);
    for (const command of ['~clearinv', 'setvar ballquest 5', 'setstat attack 99', 'setstat strength 99', 'setstat defence 99', 'setstat hitpoints 99', 'setstat prayer 99',
        'give leather_gloves 1', 'give cheese 1', 'give witches_doorkey 1', 'give witches_diary 1', 'give coins 1000', 'give lobster 12', 'give 4doseprayerrestore 2', 'give rune_scimitar 1', 'give rune_chainbody 1', 'give rune_platelegs 1', 'give rune_full_helm 1', 'give rune_kiteshield 1']) {
        assert(await cheatQuiet(page, command), command);
    }
    await relog(page, tag);
    for (const [id, op] of [[1333, 'Wield'], [1113, 'Wear'], [1079, 'Wear'], [1163, 'Wear'], [1201, 'Wear']] as const) {
        assert(await page.evaluate(async ([itemId, action]) => (globalThis as never as Api).__rs2b0t.Inventory.items().find(item => item.id === itemId)?.interact(action), [id, op] as const));
        await page.waitForTimeout(500);
    }
    await setSettings(page, 'Global', { runAuto: false });
    assert(await page.evaluate(() => (globalThis as never as Api).rs2b0t.actions.setRun(false)));
    assert(await teleTo(page, { x: 2946, z: 3369, level: 0 }, 0));
    await page.waitForTimeout(500);
    const before = await snapshot();
    assert(!before.run, 'normal walking fixture');
    assert.equal(await getServerVarQuiet(page, 'ballquest'), 5);
    await setSettings(page, 'AIOQuester', { quests: 'ball', food: 'Lobster', loadout: '(none)' });
    await startScript(page, 'AIOQuester');
    const deadline = Date.now() + minutes * 60_000;
    let key = false;
    let shed = false;
    let ball = false;
    let waited = false;
    let entered = false;
    let returned = false;
    let printed = 0;
    const seenWitchX = new Set<number>();
    const gardenTiles = new Set<string>();
    while (Date.now() < deadline) {
        const state = await snapshot();
        assert(!state.run, 'the route must work without running');
        const tile = state.tile;
        if (tile && tile.level === 0 && tile.x >= 2901 && tile.x <= 2933 && tile.z >= 3460 && tile.z <= 3465) {
            assert(tile.x === 2901 || tile.x === 2933 || tile.z === 3460, 'walk left the planned garden corridor');
            gardenTiles.add(`${tile.x},${tile.z}`);
            entered = true;
        }
        if (state.witch) seenWitchX.add(state.witch.networkTile.x);
        key ||= state.inventory.some(item => item.id === 2411);
        shed ||= !!state.tile && state.tile.x >= 2934 && state.tile.x <= 2937 && state.tile.z >= 3459 && state.tile.z <= 3467;
        ball ||= state.inventory.some(item => item.id === 2407);
        waited ||= state.logs.some(line => line.includes('waiting behind the hedge'));

        if (state.quest === 'complete') break;
        assert.equal(state.state, 'running');
        if (entered && state.tile && !ball) assert(state.tile.x >= 2898 && state.tile.x <= 2937 && state.tile.z >= 3459 && state.tile.z <= 3476, 'Nora threw the player out');
        if (ball && tile && tile.x >= 2901 && tile.x <= 2902 && tile.z >= 3466 && tile.z <= 3467) returned = true;
        if (ball && !returned && state.quest !== 'complete') assert(state.inventory.some(item => item.id === 2407), 'Nora took the recovered ball');
        if (Date.now() - printed > 10_000) { console.log('STATE', JSON.stringify(state)); printed = Date.now(); }
        await page.waitForTimeout(100);
    }
    const after = await snapshot();
    assert.equal(after.quest, 'complete');
    assert(key && shed && ball && waited && returned, 'fountain, shed, ball and protected waits observed');
    assert(seenWitchX.size > 15, 'Nora patrolled throughout the trip');
    await mkdir('out', { recursive: true });
    await page.screenshot({ path: 'out/issue-847.png', fullPage: true });
    await Bun.write('out/issue-847.json', JSON.stringify({ issue: 847, result: 'PASS', before, after, key, shed, ball, waited, returned, seenWitchX: [...seenWitchX], gardenTiles: [...gardenTiles] }, null, 2) + '\n');
    console.log('PASS', JSON.stringify({ before, after, key, shed, ball, waited }));
} catch (error) {
    console.log('FAILURE STATE', JSON.stringify(await snapshot().catch(() => null)));
    await mkdir('out', { recursive: true });
    await page.screenshot({ path: 'out/issue-847-failure.png', fullPage: true }).catch(() => undefined);
    throw error;
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
