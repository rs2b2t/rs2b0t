import { type Page } from 'playwright-core';
import { launchBrowser, startFromLibrary } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Rs2b0t = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; sideIcon: number[]; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
    };
};

const boot = (page: Page) => page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
const ingame = (page: Page) => page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 15000 }).then(() => true).catch(() => false);
const logs = (page: Page) => page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

async function login(page: Page, user: string): Promise<boolean> {
    await page.evaluate(([u, p]) => { const c = (globalThis as never as Rs2b0t).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [user, 'test']);
    return ingame(page);
}
async function type(page: Page, t: string): Promise<void> {
    await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
    await page.waitForTimeout(400);
    await page.keyboard.type(t, { delay: 25 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1400);
}
async function setup(page: Page, user: string): Promise<void> {
    if (!(await login(page, user))) fail('first login failed');
    await type(page, '::tele 0,50,50,20,20');
    await page.reload();
    await boot(page);
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(page, user); }
    if (!backIn) fail('relogin failed');
    for (const s of ['attack', 'strength', 'defence', 'hitpoints']) await type(page, `::setstat ${s} 40`);
    await type(page, '::tele 0,50,51,32,34');
}

const browser = await launchBrowser();
try {
    {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(`${base}/bot.html`);
        await boot(page);
        await setup(page, `set${Date.now().toString(36).slice(-6)}`);

        await startFromLibrary(page, 'Combat', 'ChickenKiller');
        const paramsModal = page.locator('.rs2b0t-modal', { has: page.locator('.rs2b0t-params-body') });
        const openParams = async () => {
            await page.getByRole('button', { name: /Edit parameters/ }).click();
            await page.waitForSelector('.rs2b0t-params-body', { state: 'visible', timeout: 5000 });
        };
        const closeParams = async () => {
            await paramsModal.getByRole('button', { name: '✕' }).click();
            await page.waitForSelector('.rs2b0t-params-body', { state: 'hidden', timeout: 5000 });
        };
        const checkbox = page.locator('.rs2b0t-param-row', { hasText: 'Gather feathers?' }).locator('input.rs2b0t-param-cb');
        await openParams();
        if ((await checkbox.count()) === 0) fail('parameter form has no "Gather feathers?" checkbox');
        await closeParams();

        await page.getByRole('button', { name: 'Start' }).click();
        await page.waitForFunction(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).some(l => l.msg.startsWith('anchored')), undefined, { timeout: 20000 });
        if ((await logs(page)).some(l => l.includes('gathering feathers'))) fail('default should be feathers OFF');
        console.log('panel: default OFF confirmed');
        await page.getByRole('button', { name: 'Stop' }).click();
        await page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state === 'stopped', undefined, { timeout: 10000 });

        await openParams();
        await checkbox.check();
        await closeParams();
        await page.getByRole('button', { name: 'Start' }).click();
        const gathering = await page.waitForFunction(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).some(l => l.msg.includes('gathering feathers')), undefined, { timeout: 20000 }).then(() => true).catch(() => false);
        if (!gathering) fail('panel toggle did not enable feather gathering');
        console.log('panel: checkbox ON -> bot gathering feathers');

        const looted = await page.waitForFunction(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).some(l => l.msg.includes('looted feathers')), undefined, { timeout: 180000 }).then(() => true).catch(() => false);
        if (!looted) fail('feathers param on, but no feathers looted in 3 min');
        console.log('panel: feathers actually looted');
        await ctx.close();
    }

    {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(`${base}/bot.html?ChickenKiller.gatherFeathers=true&ChickenKiller.leashRadius=7`);
        await boot(page);
        await setup(page, `url${Date.now().toString(36).slice(-6)}`);

        await startFromLibrary(page, 'Combat', 'ChickenKiller');
        await page.getByRole('button', { name: 'Start' }).click();
        await page.waitForFunction(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).some(l => l.msg.startsWith('anchored')), undefined, { timeout: 20000 });
        const log = await logs(page);
        const anchor = log.find(l => l.startsWith('anchored')) ?? '';
        if (!anchor.includes('leash 7')) fail(`URL leashRadius override not applied: "${anchor}"`);
        if (!anchor.includes('gathering feathers')) fail(`URL gatherFeathers override not applied: "${anchor}"`);
        console.log(`URL override: "${anchor}"`);
        await ctx.close();
    }

    {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const user = `cred${Date.now().toString(36).slice(-6)}`;
        await page.goto(`${base}/bot.html`);
        await boot(page);
        if (!(await login(page, user))) fail('account-create login failed');
        await page.waitForTimeout(1500);

        await page.fill('input[placeholder="username"]', user);
        await page.fill('input[placeholder="password"]', 'test');
        await page.getByRole('button', { name: 'Save' }).click();
        const persisted = await page.evaluate(() => sessionStorage.getItem('rs2b0t:creds'));
        if (!persisted || !persisted.includes(user)) fail('credentials not saved to sessionStorage');
        console.log('credentials: saved to sessionStorage');

        const consoleLines: string[] = [];
        page.on('console', m => {
            if (m.text().includes('auto-login') || m.text().includes('rs2b0t')) {
                consoleLines.push(m.text());
            }
        });
        await page.goto(`${base}/bot.html?autologin=1`);
        await boot(page);
        const auto = await page
            .waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 45000 })
            .then(() => true)
            .catch(() => false);
        if (!auto) {
            const credsSeen = await page.evaluate(() => sessionStorage.getItem('rs2b0t:creds'));
            fail(`auto-login did not reach the game (creds in storage: ${credsSeen ? 'yes' : 'no'}). console: ${consoleLines.slice(-5).join(' | ') || '(none)'}`);
        }
        const who = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.client.loginUser);
        console.log(`auto-login: logged in by itself as '${who}' from saved credentials (console: ${consoleLines.slice(-2).join(' | ')})`);
        await ctx.close();
    }

    console.log('\nPASS');
} finally {
    await browser.close();
}
