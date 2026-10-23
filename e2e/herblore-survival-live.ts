import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Browser } from 'playwright-core';
import type { IsolatedClient } from './lib/harness.js';
import { boot, bringUpOffIsland, cheatQuiet, deployIsolatedClient, launchBrowser, login, setSettings, stopScript } from './lib/harness.js';
import { seedItemsToBank } from './tutorial/harness.js';

type Live = {
    __rs2b0t: {
        reader: { chat(n: number): { text: string }[] };
        Skills: { effective(name: string): number; level(name: string): number };
        Inventory: { count(name: string): number; items(): { name: string | null; interact(op: string): Promise<unknown> }[] };
    };
    rs2b0t: {
        host: { tickCount: number };
        reader: { worldTile(): { x: number; z: number; level: number } | null; equipment(): { name: string | null }[] };
        registry: { get(name: string): unknown };
        runner: { start(meta: unknown): void; ctx: { log: { msg: string }[] } | null; bot: { status?: string } | null };
    };
};

const base = process.argv[2] ?? 'http://127.0.0.1:1080';
const output = process.env.PROOF_DIR;
const hpFixture = process.env.HP_FIXTURE === '1';
assert(output, 'PROOF_DIR is required');
mkdirSync(output, { recursive: true });
const tag = `herb${Date.now().toString(36)}`;
const user = tag.slice(-12);
const engine = process.env.ENGINE_DIR;
assert(engine, 'ENGINE_DIR is required');
const paths = [`${engine}/public/bot/${tag}`, `${engine}/public/bot-${tag}.html`];
const samples: unknown[] = [];
const proof: Record<string, unknown> = { tag, user, base, paths, started: new Date().toISOString(), samples, mode: 'seeded level 3, real eggs and route, 600ms engine unchanged' };
let client: IsolatedClient | undefined;
let browser: Browser | undefined;
try {
    client = deployIsolatedClient(tag);
    browser = await launchBrowser({ swiftshader: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', error => console.log(`pageerror: ${error}`));
    await page.goto(`${base}${client.page}`);
    await boot(page);
    assert(await login(page, user), 'login failed');
    await bringUpOffIsland(page, { user });
    await cheatQuiet(page, 'clearinv inv', 1200);
    await seedItemsToBank(page, [{ debugName: 'lobster', displayName: 'Lobster', qty: 50 }], { x: 3092, z: 3243, level: 0 });
    await cheatQuiet(page, 'give lobster 10', 1200);
    await cheatQuiet(page, 'tele 0,48,155,48,32', 4000);
    const seed = await page.evaluate(() => {
        const g = globalThis as unknown as Live;
        return { stats: Object.fromEntries(['attack', 'strength', 'defence', 'hitpoints', 'agility', 'herblore'].map(s => [s, g.__rs2b0t.Skills.level(s)])), food: g.__rs2b0t.Inventory.count('Lobster'), equipment: g.rs2b0t.reader.equipment() };
    });
    proof.seed = seed;
    assert.equal(seed.stats.hitpoints, 10);
    for (const s of ['attack', 'strength', 'defence', 'agility', 'herblore']) assert.equal(seed.stats[s], 1);
    assert.equal(seed.food, 10);
    assert(!seed.equipment.some(i => i.name), 'unexpected equipment');
    await setSettings(page, 'HerbloreSecondaries', { secondary: "Red spiders' eggs", foodWithdraw: 10 });
    await page.evaluate(() => {
        const g = globalThis as unknown as Live;
        const meta = g.rs2b0t.registry.get('HerbloreSecondaries');
        if (!meta) throw new Error('script absent');
        g.rs2b0t.runner.start(meta);
    });
    const deadline = Date.now() + 900_000;
    let passed = false;
    let fixtureFood: number | undefined;
    let fixtureHealed = false;
    let fixtureLowHp = false;
    while (Date.now() < deadline) {
        const sample = await page.evaluate(() => {
            const g = globalThis as unknown as Live;
            return { tick: g.rs2b0t.host.tickCount, hp: g.__rs2b0t.Skills.effective('hitpoints'), food: g.__rs2b0t.Inventory.count('Lobster'), eggs: g.__rs2b0t.Inventory.count("Red spiders' eggs"), tile: g.rs2b0t.reader.worldTile(), status: g.rs2b0t.runner.bot?.status, log: g.rs2b0t.runner.ctx?.log.map(l => l.msg) ?? [], chat: g.__rs2b0t.reader.chat(30).map(c => c.text) };
        });
        samples.push(sample);
        console.log(JSON.stringify(sample));
        if (hpFixture && fixtureFood === undefined && sample.hp > 6 && sample.food > 0 &&
            sample.status === "walking to Red spiders' eggs" && sample.tile &&
            sample.tile.z >= 9868 && sample.tile.z < 9890) {
            const command = `~stat_drain hitpoints ${sample.hp - 6} 0`;
            proof.hpFixture = { command, requestedAt: sample };
            fixtureFood = sample.food;
            assert(await cheatQuiet(page, command, 0), 'HP fixture command failed');
        }
        if (fixtureFood !== undefined && !fixtureLowHp && sample.hp <= 6) {
            fixtureLowHp = true;
            proof.hpFixtureObserved = sample;
        }
        if (fixtureFood !== undefined && !fixtureHealed && sample.food < fixtureFood &&
            sample.hp > 6 && sample.tile && sample.tile.z < 9940) {
            fixtureHealed = true;
            proof.walkingBite = sample;
        }
        if (sample.chat.some(m => /Oh dear.*dead/i.test(m)) || sample.hp <= 0 || (sample.tile && sample.tile.z < 3300)) {
            proof.result = 'death';
            break;
        }
        if (sample.log.some(m => m.startsWith('restocked @')) && sample.eggs > 0 && sample.tile && sample.tile.z > 9900) {
            passed = true;
            proof.result = 'banked and returned with further egg';
            break;
        }
        await page.waitForTimeout(fixtureFood !== undefined && !fixtureHealed ? 100 : 600);
    }
    await page.screenshot({ path: `${output}/screenshot.png` });
    await stopScript(page);
    assert(passed, String(proof.result ?? 'deadline expired'));
    if (hpFixture) assert(fixtureLowHp && fixtureHealed, 'HP fixture did not produce an observed threshold crossing and bite before arrival');
} catch (error) {
    proof.error = String(error);
    process.exitCode = 1;
    console.error(error);
} finally {
    await browser?.close();
    client?.cleanup();
    proof.removed = paths.map(path => ({ path, absent: !existsSync(path) }));
    proof.finished = new Date().toISOString();
    writeFileSync(`${output}/proof.json`, JSON.stringify(proof, null, 2));
    assert(paths.every(path => !existsSync(path)), 'isolated deployment cleanup failed');
}
