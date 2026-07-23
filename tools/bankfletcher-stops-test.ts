import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `bfs${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Inv = { name: string | null; count: number };
type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(script: unknown): void; ctx: { log: { msg: string }[] } | null; bot: Record<string, unknown> | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null; inventory(): Inv[] };
        registry: { get(name: string): unknown };
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
    const clearDialogs = () => page.evaluate(async () => {
        const a = (globalThis as never as R).rs2b0t.actions;
        for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); }
    });
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
    const inv = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.inventory());
    const countSub = (items: Inv[], sub: string) => items.filter(i => (i.name ?? '').toLowerCase().includes(sub)).reduce((s, i) => s + Math.max(1, i.count), 0);
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const runnerState = () => page.evaluate(() => (globalThis as never as R).rs2b0t.runner.state);

    const teleToBank = async () => {
        let at = null as { x: number; z: number; level: number } | null;
        for (let attempt = 0; attempt < 4; attempt++) {
            await type('::tele 0,49,53,49,48');
            await page.waitForTimeout(2000);
            at = await tile();
            if (at && Math.abs(at.x - 3185) <= 8 && Math.abs(at.z - 3440) <= 8) { break; }
            await clearDialogs();
        }
        return at;
    };

    await page.goto(`${base}/bot.html?BankFletcher.product=Arrow shafts`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    console.log('logged in off Tutorial Island');

    await type('::~bankitem logs 20');
    await type('::~bankitem maple_logs 30');
    await type('::~bankitem knife 1');
    await type('::~maxme');
    await clearDialogs();

    const at = await teleToBank();
    console.log(`at Varrock West bank: ${at ? `${at.x},${at.z}` : '?'}`);
    if (!at || Math.abs(at.x - 3185) > 8 || Math.abs(at.z - 3440) > 8) { fail(`Varrock West tele failed (at ${at ? `${at.x},${at.z}` : '?'})`); }
    await clearDialogs();

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('BankFletcher')); });
    console.log('started BankFletcher (product=Arrow shafts, 20 regular + 30 maple logs seeded)');

    let sawShafts = false, sawMaple = false, sawShortbow = false, stopped = false;
    for (let i = 0; i < 90; i++) {
        await page.waitForTimeout(2000);
        const items = await inv();
        if (countSub(items, 'arrow shaft') > 0) { sawShafts = true; }
        if (countSub(items, 'maple') > 0) { sawMaple = true; }
        if (countSub(items, 'shortbow') > 0 || countSub(items, 'short bow') > 0) { sawShortbow = true; }
        const logs = await logLines();
        if (logs.some(l => /fletching complete, stopping|bank is out of 'Logs'/i.test(l))) { stopped = true; }
        if (i % 5 === 0) { console.log(`  t=${i * 2}s inv=${JSON.stringify(items.map(x => `${x.name}:${x.count}`))} state=${await runnerState()}`); }
        if (sawMaple || sawShortbow) { break; }
        if (stopped && sawShafts) { break; }
    }

    const tail = (await logLines()).slice(-15);
    console.log('--- recent bot log ---');
    for (const l of tail) { console.log(`  ${l}`); }
    console.log(`sawShafts=${sawShafts} sawMaple=${sawMaple} sawShortbow=${sawShortbow} stopped=${stopped} finalState=${await runnerState()}`);

    if (sawMaple) { await page.screenshot({ path: 'out/bankfletcher-stops-test.png' }); fail('BUG: BankFletcher withdrew Maple logs when set to regular Logs / Arrow shafts'); }
    if (sawShortbow) { await page.screenshot({ path: 'out/bankfletcher-stops-test.png' }); fail('BUG: BankFletcher made a shortbow instead of stopping after arrow shafts'); }
    if (!sawShafts) { await page.screenshot({ path: 'out/bankfletcher-stops-test.png' }); fail('precondition failed: no arrow shafts were produced at all'); }
    if (!stopped) { await page.screenshot({ path: 'out/bankfletcher-stops-test.png' }); fail('BankFletcher did not stop when the regular Logs ran out'); }

    console.log('PASS: made arrow shafts, then STOPPED on empty regular-log bank — never touched the maple decoy');
    await browser.close();
    process.exit(0);
} catch (e) {
    console.error(e);
    fail(String(e));
}
