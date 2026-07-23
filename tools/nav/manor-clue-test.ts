import { launchBrowser } from '../lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = `mnr${Date.now().toString(36).slice(-7)}`;
function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(s: unknown): void; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        registry: { get(n: string): unknown };
        actions?: { continueDialog?: () => boolean };
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
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
    const clearDialogs = () => page.evaluate(async () => { const a = (globalThis as never as R).rs2b0t.actions; for (let i = 0; i < 20; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 200)); } });

    await page.goto(`${base}/bot.html`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    await type('::~maxme');
    await clearDialogs();

    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type('::tele 0,48,50,21,43');
        await page.waitForTimeout(2000);
        at = await tile();
        if (at && at.level === 0 && Math.abs(at.x - 3093) <= 5 && Math.abs(at.z - 3243) <= 5) { break; }
        await clearDialogs();
    }
    if (!at) { fail('draynor tele failed'); }
    console.log(`at Draynor bank: (${at.x},${at.z},${at.level})\n`);

    const held = (id: number) => page.evaluate(n => {
        const abi = (globalThis as never as { __rs2b0t: { Inventory: { items(): { id: number }[] } } }).__rs2b0t;
        return abi.Inventory.items().some(i => i.id === n);
    }, id);
    const heldName = (nm: string) => page.evaluate(n => {
        const abi = (globalThis as never as { __rs2b0t: { Inventory: { items(): { name: string | null }[] } } }).__rs2b0t;
        return abi.Inventory.items().some(i => (i.name ?? '').toLowerCase() === n.toLowerCase());
    }, nm);
    for (let a = 0; a < 4 && !(await heldName('Spade')); a++) { await type('::give spade'); await page.waitForTimeout(700); }
    for (let a = 0; a < 4 && !(await held(3502)); a++) { await type('::give trail_clue_easy_vague018'); await page.waitForTimeout(700); }
    if (!(await held(3502))) { fail('could not seed the manor clue (3502)'); }
    console.log(`seeded: spade=${await heldName('Spade')} clue3502=${await held(3502)}\n`);

    const logsBefore = await page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).length);
    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('ClueSolver')); });
    console.log('started ClueSolver with the manor clue (3502)\n');

    const deadline = Date.now() + 540_000;
    let seen = 0, done = false;
    while (Date.now() < deadline && !done) {
        await page.waitForTimeout(2500);
        const all: string[] = await page.evaluate(n => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).slice(n).map(l => l.msg), logsBefore);
        for (const l of all.slice(seen)) { console.log(`  ${l}`); }
        seen = all.length;
        const lines = (await page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg)));
        const me = await tile();
        const inManor = !!me && me.x >= 3097 && me.x <= 3126 && me.z >= 3344 && me.z <= 3373;
        console.log(`    [bot] (${me?.x},${me?.z},${me?.level}) ${inManor ? 'IN manor' : 'outside'} clueHeld=${await held(3502)}`);
        if (!(await held(3502)) && !inManor) { done = true; }
        if (lines.some(l => l.includes('abandon'))) { done = true; }
        if ((await page.evaluate(() => (globalThis as never as R).rs2b0t.runner.state)) !== 'running') { done = true; }
    }
    const lines = (await page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg)));
    const solvedLeg = lines.some(l => l.includes('trail_clue_easy_vague018'));
    const consumed = !(await held(3502));
    const fin = await tile();
    const outside = !!fin && !(fin.x >= 3097 && fin.x <= 3126 && fin.z >= 3344 && fin.z <= 3373);
    const talked = solvedLeg && consumed && outside;
    const abandoned = lines.some(l => l.includes('abandon'));
    console.log('\n--- clue log tail ---');
    for (const l of lines.slice(-12)) { console.log(`  ${l}`); }
    console.log(`\nsolved=${solvedLeg} consumed=${consumed} exited-manor=${outside} abandoned=${abandoned} => ${talked && !abandoned ? 'PASS' : 'FAIL'}`);
} finally {
    await browser.close();
}
