// Headless live smoke for FlaxPicker. Boots the WebGL client (SwiftShader), logs
// in (auto-creates), teleports off Tutorial Island, maxes stats (flax needs no
// level, but ::~ unlocks debugprocs and members access), teleports to the Seers
// Village flax field, DISCOVERS the real nearest "Flax" loc tile (and pins the
// bot's fieldTile to it via localStorage so the default doesn't have to be exact),
// starts the bot, and watches for flax accumulating and a full pick -> bank ->
// return cycle.
//
// Requires the local engine running + the local build deployed:
//   cd ~/code/rs2b2t-engine && npm run quickstart          (web :8890)
//   ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh
//
// Usage: bun tools/flaxpicker-test.ts [base-url] [username]

import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `fp${Date.now().toString(36).slice(-7)}`;

// Seers flax field (design default 2744,3446). tele arg is level,mx,mz,lx,lz with
// world x = mx*64+lx, z = mz*64+lz  ->  2744 = 42*64+56, 3446 = 53*64+54.
const FIELD_X = 2744;
const FIELD_Z = 3446;
const FIELD_TELE = '::tele 0,42,53,56,54';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Snap = { id: number; name: string | null; ops: (string | null)[]; tile: { x: number; z: number; level: number }; distance: number };
type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(script: unknown): void; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null; locs(): Snap[]; inventory(): { name: string | null }[] };
        registry: { get(name: string): unknown };
    };
};

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const boot = () => page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as R).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as R).rs2b0t.client.ingame && (globalThis as never as R).rs2b0t.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false);
    };
    const type = async (t: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(t, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
    };
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
    const flaxInv = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.inventory().filter(i => (i.name ?? '').toLowerCase().includes('flax')).length);
    // Nearest "Flax" loc offering "Pick", read straight off the scene.
    const nearestFlax = () => page.evaluate(() => {
        const locs = (globalThis as never as R).rs2b0t.reader.locs()
            .filter(l => (l.name ?? '').toLowerCase() === 'flax' && l.ops.some(o => (o ?? '').toLowerCase() === 'pick'))
            .sort((a, b) => a.distance - b.distance);
        return locs[0] ? { x: locs[0].tile.x, z: locs[0].tile.z, level: locs[0].tile.level } : null;
    });

    await page.goto(`${base}/bot.html`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20'); // off Tutorial Island
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    console.log('logged in off Tutorial Island');

    // Clear blocking dialogs programmatically (more reliable than keypresses) —
    // ::~maxme spews level-up dialogs that otherwise swallow the next command.
    const clearDialogs = () => page.evaluate(async () => {
        const a = (globalThis as never as { rs2b0t: { actions?: { continueDialog?: () => boolean } } }).rs2b0t.actions;
        for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); }
    });

    await type('::~maxme');                 // unlock debugprocs + members access
    await clearDialogs();
    // Teleport to the Seers flax field; retry a couple times through residual dialogs.
    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type(FIELD_TELE);
        await page.waitForTimeout(2000);
        at = await tile();
        if (at && Math.abs(at.x - FIELD_X) <= 10 && Math.abs(at.z - FIELD_Z) <= 10) { break; }
        await clearDialogs();
    }
    console.log(`at field: ${at ? `${at.x},${at.z}` : '?'}`);
    if (!at || Math.abs(at.x - FIELD_X) > 12 || Math.abs(at.z - FIELD_Z) > 12) { fail(`field tele failed (at ${at ? `${at.x},${at.z}` : '?'})`); }
    await clearDialogs();

    // DISCOVER the real flax tile and pin the bot's fieldTile to it, so an off-by-a-
    // few default still leashes the pick loop over the actual field. Logged so we can
    // correct the design default if it's wrong.
    const flaxTile = await nearestFlax();
    console.log(`discovered nearest Flax loc: ${flaxTile ? `${flaxTile.x},${flaxTile.z}` : 'NONE in scene'}`);
    if (!flaxTile) { fail('no "Flax" loc with a "Pick" op near the field — adjust FIELD_TELE / default fieldTile'); }
    await page.evaluate(t => localStorage.setItem('rs2b0t:set:FlaxPicker:fieldTile', `${t.x},${t.z},${t.level}`), flaxTile);
    console.log(`pinned FlaxPicker.fieldTile = ${flaxTile.x},${flaxTile.z}`);

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('FlaxPicker')); });
    console.log('started FlaxPicker — watching ~10min for a pick -> bank -> return cycle');

    const before = (await logLines()).length;
    const seen = { accumulate: false, bank: false, refill: false };
    let peakFlax = 0;
    let bankedAtTick = -1;
    for (let i = 0; i < 300; i++) { // ~10min of 2s polls (a full pack of flax then a bank run)
        await page.waitForTimeout(2000);
        const flax = await flaxInv();
        peakFlax = Math.max(peakFlax, flax);
        if (peakFlax >= 3) { seen.accumulate = true; }

        const lines = (await logLines()).slice(before);
        for (const l of lines) {
            if (/banked \d+/i.test(l)) { seen.bank = true; }
        }
        // a full pick -> bank -> return cycle: after a bank the pack empties of flax,
        // then flax starts rising again (we returned to the field and resumed).
        if (seen.bank && bankedAtTick < 0 && flax === 0) { bankedAtTick = i; }
        if (bankedAtTick >= 0 && i > bankedAtTick && flax > 0) { seen.refill = true; }

        if (seen.accumulate && seen.bank && seen.refill) { break; }
    }

    const tail = (await logLines()).slice(-24);
    console.log('--- recent bot log ---');
    for (const l of tail) { console.log(`  ${l}`); }
    console.log(`peakFlax=${peakFlax} accumulate=${seen.accumulate} bank=${seen.bank} return=${seen.refill}`);
    if (!(seen.accumulate && seen.bank && seen.refill)) {
        await page.screenshot({ path: 'out/flaxpicker-test.png' });
        fail('did not observe a full pick -> bank -> return cycle within the window');
    }
    console.log('PASS');
} finally {
    await browser.close();
}
