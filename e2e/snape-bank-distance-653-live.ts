import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

type Tile = { x: number; z: number; level: number };
type Api = {
    __rs2b0t: { Inventory: { count(name: string): number }; Bank: { isOpen(): boolean } };
    rs2b0t: { reader: { worldTile(): Tile | null }; runner: { state: string; ctx?: { log?: { msg: string }[] } } };
};

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 5 });
const tag = `snape${Date.now().toString(36).slice(-6)}`;
const client = deployIsolatedClient(tag);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const snapshot = () => page.evaluate(() => {
    const g = globalThis as never as Api;
    return { tile: g.rs2b0t.reader.worldTile(), count: g.__rs2b0t.Inventory.count('Snape grass'),
        open: g.__rs2b0t.Bank.isOpen(), state: g.rs2b0t.runner.state,
        logs: (g.rs2b0t.runner.ctx?.log ?? []).map(line => line.msg) };
});

try {
    await mainlandAccount(page, base, tag, client.page);
    for (const command of ['~clearinv', 'setstat hitpoints 99', 'setstat defence 99', 'give snape_grass 28']) {
        assert(await cheatQuiet(page, command), command);
    }
    assert(await teleTo(page, { x: 2908, z: 3294, level: 0 }, 0, 30_000));
    await setSettings(page, 'Global', { navTeleports: false });
    await setSettings(page, 'HerbloreSecondaries', { secondary: 'Snape grass', foodWithdraw: 0 });
    assert.equal((await snapshot()).count, 28);
    await startScript(page, 'HerbloreSecondaries');
    const deadline = Date.now() + minutes * 60_000;
    let deposited: Awaited<ReturnType<typeof snapshot>> | null = null;
    let returned: Awaited<ReturnType<typeof snapshot>> | null = null;
    let previous: Tile | null = null;
    let travelled = 0;
    let lastLog = '';
    while (Date.now() < deadline) {
        const state = await snapshot();
        assert.equal(state.state, 'running');
        const tile = state.tile;
        if (tile && previous) travelled += Math.max(Math.abs(tile.x - previous.x), Math.abs(tile.z - previous.z));
        previous = tile;
        const log = state.logs.slice(-5).join('\n');
        if (log !== lastLog) { console.log('STATE', JSON.stringify({ ...state, travelled })); lastLog = log; }
        if (!deposited && state.count === 0) {
            assert(tile && tile.level === 0 && Math.max(Math.abs(tile.x - 3013), Math.abs(tile.z - 3355)) <= 5, 'deposited at Falador East');
            deposited = state;
        }
        if (deposited && tile && Math.max(Math.abs(tile.x - 2908), Math.abs(tile.z - 3294)) <= 3 && state.count > 0) {
            returned = state;
            break;
        }
        await page.waitForTimeout(100);
    }
    assert(deposited, 'full pack deposited at Falador East');
    assert(returned, 'returned to the peninsula and resumed gathering');
    assert(travelled < 380, `roundtrip remained shorter than the 432-tile western route: ${travelled}`);
    await stopScript(page);
    await mkdir('docs/e2e', { recursive: true });
    await page.screenshot({ path: 'docs/e2e/snape-bank-distance-653.png', fullPage: true });
    await Bun.write('docs/e2e/snape-bank-distance-653.json', JSON.stringify({ result: 'PASS', travelled, deposited, returned }, null, 2) + '\n');
    console.log('PASS', JSON.stringify({ travelled, bank: deposited.tile, returned: returned.tile }));
} finally {
    await stopScript(page).catch(() => {});
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
