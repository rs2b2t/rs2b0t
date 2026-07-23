import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `at${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(script: unknown): void; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
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

    await page.goto(`${base}/bot.html`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    console.log('logged in off Tutorial Island');

    const clearDialogs = () => page.evaluate(async () => {
        const a = (globalThis as never as { rs2b0t: { actions?: { continueDialog?: () => boolean } } }).rs2b0t.actions;
        for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); }
    });
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());

    await type('::~maxme');
    await clearDialogs();
    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type('::tele 0,41,51,37,42');
        await page.waitForTimeout(2000);
        at = await tile();
        if (at && Math.abs(at.x - 2661) <= 8 && Math.abs(at.z - 3306) <= 8) { break; }
        await clearDialogs();
    }
    console.log(`at stall: ${at ? `${at.x},${at.z}` : '?'}`);
    if (!at || Math.abs(at.x - 2661) > 8 || Math.abs(at.z - 3306) > 8) { fail(`stall tele failed (at ${at ? `${at.x},${at.z}` : '?'})`); }
    await clearDialogs();

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('ArdyThiever')); });
    console.log('started ArdyThiever — watching ~120s');

    const before = (await logLines()).length;
    const seen = { restock: false, steal: false, flee: false };
    for (let i = 0; i < 150; i++) {
        await page.waitForTimeout(2000);
        const lines = (await logLines()).slice(before);
        for (const l of lines) {
            if (/restocking|stocked \d+ food/i.test(l)) { seen.restock = true; }
            if (/pickpocketed/i.test(l)) { seen.steal = true; }
            if (/kiting the guard/i.test(l)) { seen.flee = true; }
        }
        if (seen.restock && seen.steal) { break; }
    }

    const tail = (await logLines()).slice(-24);
    console.log('--- recent bot log ---');
    for (const l of tail) { console.log(`  ${l}`); }
    console.log(`restock=${seen.restock} pickpocket=${seen.steal} flee=${seen.flee}`);
    if (!(seen.restock && seen.steal)) {
        await page.screenshot({ path: 'out/ardythiever-test.png' });
        fail('did not observe both restock and pickpocket within the window');
    }
    console.log('PASS');
} finally {
    await browser.close();
}
