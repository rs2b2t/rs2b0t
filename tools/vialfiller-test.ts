// Issue #313 — live VialFiller proof against a local engine: seed a pack of
// empty vials at the Falador West bank, run the real script, and require real
// Vials of water to come back from the fountain.
//
//   bun tools/vialfiller-test.ts [http://localhost:8888]
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const user = process.argv[3] ?? `vial${Date.now().toString(36).slice(-5)}`;
const BANK_STAND = { x: 2946, z: 3369 };
const SEED_VIALS = 15;

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
    rs2b0t: { runner: { state: string; start(meta: unknown): void; stop(): void; ctx: { log: { msg: string }[] } | null }; registry: { get(name: string): unknown } };
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('console', m => {
        if (/VialFiller|vial|fountain|filled|bank/i.test(m.text())) console.log(`  ${m.text()}`);
    });

    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) fail('login failed');
    // a fresh account starts in the tutorial, where the side tabs (and so the
    // inventory component) do not exist yet
    await bringUpOffIsland(page, { user });
    console.log(`ingame as ${user}, off tutorial island`);

    await cheatQuiet(page, `tele 0,${BANK_STAND.x >> 6},${BANK_STAND.z >> 6},${BANK_STAND.x & 63},${BANK_STAND.z & 63}`, 3000);
    await cheatQuiet(page, `give vial_empty ${SEED_VIALS}`, 1500);

    const seeded = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.count('Vial'));
    if (seeded < SEED_VIALS) fail(`seeding failed — only ${seeded} empty vials in the pack`);
    console.log(`seeded ${seeded} empty vials at the Falador West bank`);

    // the script's own bank leg deposits these and withdraws them back out,
    // so the whole bank -> fountain -> bank loop is exercised for real
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('VialFiller');
        if (!meta) throw new Error('VialFiller is not registered');
        g.rs2b0t.runner.start(meta);
    });
    console.log('VialFiller started');

    const filled = await page
        .waitForFunction(() => (globalThis as never as Api).__rs2b0t.Inventory.count('Vial of water') > 0, undefined, { timeout: 240_000 })
        .then(() => true)
        .catch(() => false);

    const state = await page.evaluate(() => {
        const api = (globalThis as never as Api).__rs2b0t;
        return { water: api.Inventory.count('Vial of water'), empty: api.Inventory.count('Vial'), tile: api.reader.worldTile(), runner: (globalThis as never as Api).rs2b0t.runner.state };
    });
    console.log(`pack: ${state.water} water vials, ${state.empty} empty left, at ${JSON.stringify(state.tile)}, runner ${state.runner}`);
    if (!filled) fail('no Vial of water was ever produced at the fountain');

    // let it finish the load so the screenshot shows a full trip
    await page.waitForFunction(() => (globalThis as never as Api).__rs2b0t.Inventory.count('Vial') === 0, undefined, { timeout: 120_000 }).catch(() => {});
    const done = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.count('Vial of water'));
    await page.screenshot({ path: 'docs/e2e/issue-313-vialfiller.png' });
    console.log('screenshot: docs/e2e/issue-313-vialfiller.png');

    const scriptLog = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-25).map(l => l.msg));
    console.log('--- script log ---');
    for (const l of scriptLog) console.log(`  ${l}`);
    const size = await page.evaluate(() => (globalThis as never as { __rs2b0t: { reader: { inventorySize(): number } } }).__rs2b0t.reader.inventorySize());
    console.log(`reader.inventorySize() = ${size}`);

    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop());
    if (done < SEED_VIALS) fail(`only ${done}/${SEED_VIALS} vials were filled`);
    console.log(`PASS — VialFiller filled all ${done} vials at the Falador fountain`);
} finally {
    await browser.close();
}
