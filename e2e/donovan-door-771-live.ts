import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { LocSnapshot, NpcSnapshot, WorldTile } from '../src/bot/adapter/ClientAdapter.js';
import { deployIsolatedClient, launchBrowser, logout, parseArgs, stopScript, type Rs2b0t } from './lib/harness.js';
import { mainlandAccount, teleTo } from './tutorial/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 5 });
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'local engine required');
const name = 'Donovan the Family Handyman';
const stand = { x: 2744, z: 3576, level: 1 };
const waiting = { x: 2746, z: 3576, level: 1 };
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
interface Proof {
    done: boolean;
    result: string;
    logs: string[];
    texts: string[];
}
type Api = Rs2b0t & {
    __rs2b0t: {
        reader: { npcs(): NpcSnapshot[]; locs(): LocSnapshot[]; chatModalTexts(): string[] };
        Locs: { query(): DoorQuery };
        Reachability: { canReach(tile: WorldTile, opts: { maxSteps: number; adjacentOk: boolean }): boolean; canStep(from: WorldTile, to: WorldTile): boolean };
        Reach: { npcDialog(opts: { name: string; near: WorldTile; openMs: number; log(message: string): void }): Promise<string> };
        LoopingBot: new () => { loop(): Promise<number | void> };
        registerScript(meta: { name: string; create(): unknown }): unknown;
    };
    __doorProof?: Proof;
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
        proof: g.__doorProof ?? null
    };
}, name);

async function doorOp(op: 'Open' | 'Close'): Promise<void> {
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
    assert(await teleTo(page, waiting, 0));
    await page.waitForFunction(npcName => (globalThis as never as Api).__rs2b0t.reader.npcs().some(npc => npc.name === npcName), name, { timeout: 15_000 });
    const deadline = Date.now() + minutes * 60_000;
    let blocked = false;
    while (Date.now() < deadline) {
        const current = await snapshot();
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
    await page.evaluate(npcName => {
        const g = globalThis as never as Api;
        const api = g.__rs2b0t;
        const proof: Proof = { done: false, result: '', logs: [], texts: [] };
        g.__doorProof = proof;
        class Probe extends api.LoopingBot {
            private ran = false;
            override async loop(): Promise<number> {
                if (this.ran) return 5000;
                this.ran = true;
                try {
                    proof.result = await api.Reach.npcDialog({ name: npcName, near: { x: 2745, z: 3576, level: 1 }, openMs: 10_000, log: message => proof.logs.push(message) });
                    proof.texts = api.reader.chatModalTexts();
                } catch (error) {
                    proof.result = String(error);
                }
                proof.done = true;
                return 5000;
            }
        }
        g.rs2b0t.runner.start(api.registerScript({ name: 'Donovan door proof', create: () => new Probe() }));
    }, name);
    await page.waitForFunction(() => (globalThis as never as Api).__doorProof?.done, undefined, { timeout: 60_000 });
    const after = await snapshot();
    console.log(`AFTER ${JSON.stringify(after)}`);
    assert.equal(after.proof?.result, 'done');
    assert(after.proof.logs.some(line => line.includes("closing 'Door' at (2744,3576)")), 'Reach never closed the swung leaf');
    assert(after.edgeOpen, 'door edge still blocks the bedroom');
    assert(after.proof.texts.some(text => /no interest in talking to gawkers/i.test(text)), 'Donovan dialogue never arrived');
    await page.screenshot({ path: 'docs/e2e/issue-771.png' });
    assert.deepEqual(errors, [], 'browser errors');
    console.log('PASS #771 actual swung leaf closed and Donovan dialogue reached');
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
