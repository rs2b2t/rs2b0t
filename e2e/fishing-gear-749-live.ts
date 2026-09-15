import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, stopScript } from './lib/harness.js';
import { mainlandAccount, teleTo } from './tutorial/harness.js';

type Api = {
    __rs2b0t: { Inventory: { count(name: string): number; first(name: string): { interact(op: string): Promise<boolean> } | null } };
    rs2b0t: { reader: {
        worldTile(): { x: number; z: number; level: number } | null;
        npcs(): { id: number; name: string | null; distance: number }[];
        groundItems(): { id: number; name: string | null; count: number; distance: number }[];
    } };
};

const { base } = parseArgs(process.argv.slice(2));
const tag = `gear${Date.now().toString(36).slice(-6)}`;
const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const page = await browser.newPage();
const logs: string[] = [];
page.on('console', message => { if (/random event/i.test(message.text())) logs.push(message.text()); });
const snapshot = () => page.evaluate(() => {
    const g = globalThis as never as Api;
    return { tile: g.rs2b0t.reader.worldTile(),
        held: Object.fromEntries(['Feather', 'Fishing bait', 'Harpoon'].map(name => [name, g.__rs2b0t.Inventory.count(name)])),
        ground: g.rs2b0t.reader.groundItems().filter(item => [314, 313, 311].includes(item.id) && item.distance <= 2),
        spots: g.rs2b0t.reader.npcs().filter(npc => npc.name === 'Fishing spot' && npc.distance <= 10) };
});
async function drop(name: string): Promise<void> {
    assert(await page.evaluate(name => (globalThis as never as Api).__rs2b0t.Inventory.first(name)?.interact('Drop'), name), `Drop ${name}`);
    await page.waitForFunction(name => {
        const g = globalThis as never as Api;
        return g.__rs2b0t.Inventory.count(name) === 0 && g.rs2b0t.reader.groundItems().some(item => item.name === name && item.distance <= 1);
    }, name, { timeout: 5000, polling: 20 });
}
async function leaveDrops(names: string[]): Promise<void> {
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
        const state = await snapshot();
        for (const name of names) {
            assert.equal(state.held[name], 0, `${name} stayed out of inventory`);
            assert(state.ground.some(item => item.name === name), `${name} remained on the ground`);
        }
        await page.waitForTimeout(200);
    }
}

try {
    await mainlandAccount(page, base, tag, client.page);
    assert(await teleTo(page, { x: 3224, z: 3216, level: 0 }, 0), 'dry-ground fixture');
    assert(await cheatQuiet(page, '~clearinv'), 'empty inventory');
    for (const command of ['give feather 10', 'give fishing_bait 10', 'give harpoon 1']) assert(await cheatQuiet(page, command), command);
    await page.waitForTimeout(1500);
    const before = await snapshot();
    assert.equal(before.spots.length, 0, 'no fishing spot within recovery range');
    for (const name of ['Feather', 'Fishing bait', 'Harpoon']) await drop(name);
    await leaveDrops(['Feather', 'Fishing bait', 'Harpoon']);
    const away = await snapshot();
    await mkdir('docs/e2e', { recursive: true });
    await page.screenshot({ path: 'docs/e2e/issue-749-before.png', fullPage: true });

    assert(await teleTo(page, { x: 3232, z: 3200, level: 0 }, 0), 'whirlpool spawn fixture');
    assert(await cheatQuiet(page, 'npcadd macro_whirlpool_rarefish', 0), 'spawn a real whirlpool NPC');
    assert(await teleTo(page, { x: 3224, z: 3200, level: 0 }, 0), 'stand eight tiles from whirlpool');
    await page.waitForFunction(() => (globalThis as never as Api).rs2b0t.reader.npcs().some(npc => npc.id === 405 && npc.distance > 3 && npc.distance <= 10), undefined, { timeout: 10_000 });
    for (const command of ['give feather 10', 'give fishing_bait 10', 'give harpoon 1']) assert(await cheatQuiet(page, command), command);
    await page.waitForTimeout(1500);
    for (const name of ['Feather', 'Fishing bait']) await drop(name);
    await leaveDrops(['Feather', 'Fishing bait']);
    const near = await snapshot();
    await drop('Harpoon');
    const lost = await snapshot();
    await page.waitForFunction(() => {
        const g = globalThis as never as Api;
        return g.__rs2b0t.Inventory.count('Harpoon') === 1 && !g.rs2b0t.reader.groundItems().some(item => item.id === 311 && item.distance <= 2);
    }, undefined, { timeout: 20_000 });
    const recovered = await snapshot();
    assert.equal(recovered.held.Feather, 0);
    assert.equal(recovered.held['Fishing bait'], 0);
    assert.equal(recovered.held.Harpoon, 1);
    assert(logs.some(line => /recovering our harpoon/i.test(line)), 'guardian handled the nearby tool loss');
    await page.screenshot({ path: 'docs/e2e/issue-749.png', fullPage: true });
    await Bun.write('docs/e2e/issue-749.json', JSON.stringify({ issue: 749, result: 'PASS', at: new Date().toISOString(),
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), before, away, near, lost, recovered, logs }, null, 2) + '\n');
    console.log('PASS', JSON.stringify({ away, near, lost, recovered, logs }));
} catch (error) {
    console.log('FAILURE STATE', JSON.stringify({ state: await snapshot().catch(() => null), logs }));
    await mkdir('out', { recursive: true });
    await page.screenshot({ path: 'out/issue-749-failure.png', fullPage: true }).catch(() => undefined);
    throw error;
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
