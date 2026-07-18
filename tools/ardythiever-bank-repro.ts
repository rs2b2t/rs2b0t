// Repro for the "bank instantly opens and shuts" bug the user saw in ArdyThiever.
// Boots the client, logs in off Tutorial Island, maxes stats, teleports to the
// East Ardougne market, GIVES 12 iron ore (12 non-stacking loot slots -> trips
// BankRun's shouldBank), starts ArdyThiever, then polls the bank state fast
// (200ms) to catch a rapid open/close flicker and instrument WHY a deposit
// might no-op: at each open it records bankItems()/bankSideItems() lengths (the
// side-modal deposit view lags the main bank modal -> depositAllMatching reads
// an empty list -> deposits nothing -> walk-away closes -> re-trips).
//
// Usage: bun tools/ardythiever-bank-repro.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `ab${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(script: unknown): void; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        registry: { get(name: string): unknown };
    };
    __rs2b0t: {
        Bank: { isOpen(): boolean };
        Inventory: { count(n: string): number };
        reader: { bankItems(): unknown[]; bankSideItems(): unknown[] };
    };
};

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
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
        const a = (globalThis as never as { rs2b0t: { actions?: { continueDialog?: () => boolean } } }).rs2b0t.actions;
        for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); }
    });
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());

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

    await type('::~maxme');
    await clearDialogs();
    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type('::tele 0,41,51,37,42'); // East Ardougne market anchor ~ (2661,3306)
        await page.waitForTimeout(2000);
        at = await tile();
        if (at && Math.abs(at.x - 2661) <= 8 && Math.abs(at.z - 3306) <= 8) { break; }
        await clearDialogs();
    }
    if (!at || Math.abs(at.x - 2661) > 8 || Math.abs(at.z - 3306) > 8) { fail(`stall tele failed (at ${at ? `${at.x},${at.z}` : '?'})`); }
    console.log(`at market: ${at.x},${at.z}`);

    // 12 iron ore = 12 non-stacking loot slots -> shouldBank() true immediately.
    await type('::~item iron_ore 12');
    await clearDialogs();
    const iron0 = await page.evaluate(() => (globalThis as never as R).__rs2b0t.Inventory.count('Iron ore'));
    console.log(`iron ore held: ${iron0}`);
    if (iron0 < 12) { fail(`give failed — only ${iron0} iron ore (need 12 to trip BankRun)`); }

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('ArdyThiever')); });
    console.log('started ArdyThiever — polling bank state @200ms for ~100s');

    // Fast poll: catch open/close transitions + the side-modal race at each open.
    let prevOpen = false;
    let opens = 0, closes = 0;
    let raceHits = 0; // bank open but deposit-view (side) empty while main has items
    let minIron = iron0;
    const opensLog: string[] = [];
    for (let i = 0; i < 500; i++) {
        const s = await page.evaluate(() => {
            const a = (globalThis as never as R).__rs2b0t;
            return {
                open: a.Bank.isOpen(),
                main: a.reader.bankItems().length,
                side: a.reader.bankSideItems().length,
                iron: a.Inventory.count('Iron ore'),
                pos: (globalThis as never as R).rs2b0t.reader.worldTile()
            };
        });
        minIron = Math.min(minIron, s.iron);
        if (s.open && !prevOpen) {
            opens++;
            const race = s.side === 0;
            if (race) { raceHits++; }
            if (opensLog.length < 20) { opensLog.push(`open#${opens} main=${s.main} side=${s.side}${race ? ' <-RACE(side empty)' : ''} iron=${s.iron} pos=${s.pos?.x},${s.pos?.z}`); }
        }
        if (!s.open && prevOpen) { closes++; }
        prevOpen = s.open;
        await page.waitForTimeout(200);
    }

    console.log('--- bank open events ---');
    for (const l of opensLog) { console.log(`  ${l}`); }
    console.log('--- recent bot log ---');
    const tail = await page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).slice(-20).map(l => l.msg));
    for (const l of tail) { console.log(`  ${l}`); }
    console.log(`opens=${opens} closes=${closes} raceHits(side-empty-on-open)=${raceHits} iron ${iron0}->${minIron} (deposit ${minIron < iron0 ? 'WORKED' : 'NEVER happened'})`);
} finally {
    await browser.close();
}
