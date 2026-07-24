import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `tk${Date.now().toString(36).slice(-7)}`;
const TARGET = 'Knight of Ardougne';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Stat = { name: string; xp: number; base: number };
type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(script: unknown): void; ctx: { log: { msg: string }[] } | null };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            skillCount(): number;
            stat(i: number): Stat;
            npcs(): { name: string | null }[];
            chat(n: number): { text: string }[];
        };
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
    const thieveXp = () => page.evaluate(() => {
        const r = (globalThis as never as R).rs2b0t.reader;
        for (let i = 0; i < r.skillCount(); i++) { if (r.stat(i).name === 'thieving') { return r.stat(i).xp; } }
        return -1;
    });
    const knightCount = () => page.evaluate((t: string) => (globalThis as never as R).rs2b0t.reader.npcs().filter(n => n.name === t).length, TARGET);
    const clearDialogs = () => page.evaluate(async () => {
        const a = (globalThis as never as { rs2b0t: { actions?: { continueDialog?: () => boolean } } }).rs2b0t.actions;
        for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); }
    });

    await page.goto(`${base}/bot.html`);
    await page.evaluate((t: string) => sessionStorage.setItem('rs2b0t:set:Thiever:target', t), TARGET);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    console.log('logged in off Tutorial Island');

    let knights = 0;
    for (let attempt = 0; attempt < 4 && knights === 0; attempt++) {
        await type('::~npc knight_of_ardougne');
        await page.waitForTimeout(1500);
        knights = await knightCount();
    }
    console.log(`knights on scene: ${knights} at ${JSON.stringify(await tile())}`);
    if (knights === 0) { fail('could not spawn a Knight of Ardougne'); }

    await type('::~maxme');
    await clearDialogs();

    const xpBefore = await thieveXp();
    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('Thiever')); });
    console.log(`started Thiever (target forced to '${TARGET}', thieving xp ${xpBefore}) — watching ~90s`);

    await page.waitForTimeout(1500);
    const startLog = (await logLines()).find(l => /^thieving '/i.test(l)) ?? '';
    console.log(`  startup: ${startLog}`);
    if (!startLog.toLowerCase().includes(TARGET.toLowerCase())) {
        fail(`bot resolved the wrong target — expected '${TARGET}', got: ${startLog || '(no startup log)'}`);
    }

    let picked = false;
    let chatHit = false;
    for (let i = 0; i < 45; i++) {
        await page.waitForTimeout(2000);
        if ((await thieveXp()) > xpBefore) { picked = true; }
        const chat = await page.evaluate(() => (globalThis as never as R).rs2b0t.reader.chat(40).map(c => c.text));
        if (chat.some(t => /pick the .*pocket|nimble fingers/i.test(t))) { chatHit = true; }
        if (picked) { break; }
    }

    console.log('--- recent bot log ---');
    for (const l of (await logLines()).slice(-14)) { console.log(`  ${l}`); }
    console.log(`thieving xp: ${xpBefore} -> ${await thieveXp()}  (picked=${picked}, chatConfirm=${chatHit})`);
    if (!picked) {
        await page.screenshot({ path: 'out/thiever-knight-test.png' });
        fail('thieving XP did not rise — the bot did not pickpocket the Knight of Ardougne');
    }
    console.log('PASS');
} finally {
    await browser.close();
}
