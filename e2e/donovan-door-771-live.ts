import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { LocSnapshot, NpcSnapshot, WorldTile } from '../src/bot/adapter/ClientAdapter.js';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript, type Rs2b0t } from './lib/harness.js';
import { mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 5 });
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'local engine required');
const name = 'Donovan the Family Handyman';
const stand = { x: 2744, z: 3576, level: 1 };
const waiting = { x: 2747, z: 3578, level: 1 };
const tag = `dd771${Date.now().toString(36).slice(-6)}`;
const pagePath = process.env.CLIENT_PAGE;
if (process.argv.includes('--no-deploy')) assert(pagePath && /^\/bot-[\w-]+\.html$/.test(pagePath), '--no-deploy requires an isolated CLIENT_PAGE');
const client = process.argv.includes('--no-deploy') ? { page: pagePath!, cleanup: () => undefined } : deployIsolatedClient(tag, process.env.ENGINE_DIR);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(String(error)));
mkdirSync('docs/e2e', { recursive: true });

interface Door {
    name: string | null;
    tile(): WorldTile;
    actions(): string[];
    interact(op: string): boolean | Promise<boolean>;
}
interface DoorQuery {
    where(predicate: (door: Door) => boolean): DoorQuery;
    first(): Door | null;
}
type Api = Rs2b0t & {
    rs2b0t: { runner: { pause(): void; resume(): void } };
    __rs2b0t: {
        reader: { npcs(): NpcSnapshot[]; locs(): LocSnapshot[]; chatModalTexts(): string[] };
        Locs: { query(): DoorQuery };
        Reachability: { canReach(tile: WorldTile, opts: { maxSteps: number; adjacentOk: boolean }): boolean; canStep(from: WorldTile, to: WorldTile): boolean };
    };
};
const snapshot = () => page.evaluate(npcName => {
    const g = globalThis as never as Api;
    const npc = g.__rs2b0t.reader.npcs().find(npc => npc.name === npcName);
    return {
        tile: g.rs2b0t.reader.worldTile(),
        npc: npc?.tile ?? null,
        reachable: npc ? g.__rs2b0t.Reachability.canReach(npc.tile, { maxSteps: 400, adjacentOk: true }) : null,
        edgeOpen: g.__rs2b0t.Reachability.canStep({ x: 2744, z: 3576, level: 1 }, { x: 2743, z: 3576, level: 1 }),
        doors: g.__rs2b0t.reader.locs().filter(loc => loc.name === 'Door' && loc.tile.level === 1 && loc.tile.x === 2744 && [3576, 3577].includes(loc.tile.z)).map(loc => ({ id: loc.id, tile: loc.tile, ops: loc.ops })),
        texts: g.__rs2b0t.reader.chatModalTexts(),
        inventory: g.rs2b0t.reader.inventory(),
        chat: g.rs2b0t.reader.chat(15),
        state: g.rs2b0t.runner.state,
        status: g.rs2b0t.runner.bot?.status,
        logs: g.rs2b0t.runner.ctx?.log ?? []
    };
}, name);

async function doorOp(op: 'Open' | 'Close'): Promise<void> {
    assert(await teleTo(page, stand, 0));
    assert(await page.evaluate(action => {
        const g = globalThis as never as Api;
        const door = g.__rs2b0t.Locs.query().where(loc => loc.name === 'Door' && loc.tile().level === 1 && loc.tile().x === 2744
            && loc.tile().z === (action === 'Open' ? 3577 : 3576) && loc.actions().includes(action)).first();
        return door?.interact(action) ?? false;
    }, op), `bedroom door ${op} not sent`);
    await page.waitForFunction(action => (globalThis as never as Api).__rs2b0t.reader.locs().some(loc => loc.name === 'Door'
        && loc.tile.level === 1 && loc.tile.x === 2744 && loc.tile.z === (action === 'Open' ? 3576 : 3577)
        && loc.ops.includes(action === 'Open' ? 'Close' : 'Open')), op, { timeout: 10_000 });
}

try {
    await mainlandAccount(page, base, tag, client.page);
    assert(await cheatQuiet(page, '~clearinv'));
    for (const item of ['trail_clue_medium_anagram009 1', 'spade 1', 'coins 1000']) assert(await cheatQuiet(page, `give ${item}`));
    assert((await snapshot()).inventory.some(item => item.id === 2855));
    assert(await teleTo(page, { x: 2725, z: 3491, level: 0 }, 2));
    await setSettings(page, 'ClueSolver', { useTeleports: false, restorePrayer: false });
    await startScript(page, 'ClueSolver');
    await page.waitForFunction(() => {
        const runner = (globalThis as never as Api).rs2b0t.runner;
        if (runner.bot?.status !== 'solving clue trail') return false;
        runner.pause();
        return runner.state === 'paused';
    }, undefined, { timeout: 60_000 });
    console.log(`PREPARED ${JSON.stringify(await snapshot())}`);
    assert(await teleTo(page, waiting, 0));
    await page.waitForFunction(npcName => (globalThis as never as Api).__rs2b0t.reader.npcs().some(npc => npc.name === npcName), name, { timeout: 15_000 });
    const deadline = Date.now() + minutes * 60_000;
    let blocked = false;
    while (Date.now() < deadline) {
        const current = await snapshot();
        if (current.npc && current.npc.z > 3576) {
            if (current.doors.some(door => door.tile.z === 3577 && door.ops.includes('Open'))) await doorOp('Open');
            assert(await teleTo(page, waiting, 0));
            await page.waitForFunction(npcName => (globalThis as never as Api).__rs2b0t.reader.npcs().some(npc => npc.name === npcName
                && npc.tile.z <= 3576 && npc.tile.level === 1), name, { timeout: Math.min(30_000, Math.max(1, deadline - Date.now())) }).catch(() => undefined);
            console.log(`WAIT Donovan corridor ${JSON.stringify(await snapshot())}`);
            continue;
        }
        if (current.doors.some(door => door.tile.z === 3576 && door.ops.includes('Close'))) await doorOp('Close');
        assert(await teleTo(page, waiting, 0));
        const entered = await page.waitForFunction(npcName => (globalThis as never as Api).__rs2b0t.reader.npcs().some(npc => npc.name === npcName
            && npc.tile.x === 2743 && npc.tile.z === 3576 && npc.tile.level === 1), name, { timeout: Math.min(30_000, Math.max(1, deadline - Date.now())) }).then(() => true).catch(() => false);
        if (!entered) {
            console.log(`WAIT Donovan pocket ${JSON.stringify(await snapshot())}`);
            continue;
        }
        await doorOp('Open');
        assert(await teleTo(page, stand, 0));
        const trapped = await snapshot();
        blocked = trapped.npc?.x === 2743 && trapped.npc.z === 3576 && trapped.reachable === false && trapped.edgeOpen === false
            && trapped.doors.some(door => door.tile.z === 3576 && door.ops.includes('Close'));
        console.log(`FIXTURE ${JSON.stringify(trapped)}`);
        if (blocked) break;
    }
    assert(blocked, `Donovan never naturally entered the blocked pocket: ${JSON.stringify(await snapshot())}`);
    assert.equal((await snapshot()).texts.length, 0, 'fixture must not already have dialogue open');
    await page.screenshot({ path: 'docs/e2e/issue-771-before.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.resume());
    await page.waitForFunction(() => {
        const g = globalThis as never as Api;
        if (!g.__rs2b0t.reader.chatModalTexts().some(text => /here you go/i.test(text))) return false;
        g.rs2b0t.runner.pause();
        return true;
    }, undefined, { timeout: 60_000 });
    const after = await snapshot();
    console.log(`DIALOGUE ${JSON.stringify(after)}`);
    assert(after.logs.some(line => line.msg.includes("closing 'Door' at (2744,3576)")), 'Reach never closed the swung leaf');
    assert(after.edgeOpen, 'door edge still blocks the bedroom');
    assert(after.texts.some(text => /here you go/i.test(text)), 'Donovan clue dialogue never arrived');
    await page.mouse.click(620, 489);
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'docs/e2e/issue-771.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.resume());
    await page.waitForFunction(() => {
        const g = globalThis as never as Api;
        return !g.rs2b0t.reader.inventory().some(item => item.id === 2855)
            && g.rs2b0t.reader.inventory().some(item => item.name === 'Clue scroll' && item.id !== 2855)
            && g.rs2b0t.runner.ctx?.log.some(line => line.msg === '[clue] step done');
    }, undefined, { timeout: 15_000 });
    console.log(`PROGRESSED ${JSON.stringify(await snapshot())}`);
    assert.deepEqual(errors, [], 'browser errors');
    console.log('PASS #771 ClueSolver closed the swung leaf, reached Donovan dialogue, and advanced the clue');
} catch (error) {
    console.log(`FAIL ${JSON.stringify(await snapshot())}`);
    throw error;
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
