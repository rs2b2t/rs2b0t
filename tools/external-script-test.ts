// Slice 7 exit-criterion test: build the out-of-tree template bot (authored
// only against @rs2b0t/api), load it through the panel's URL loader, run it,
// and verify hot-reload replacement.
//
// Usage: bun tools/external-script-test.ts [base-url] [username]

import { launchBrowser } from './lib/harness.js';
import fs from 'node:fs';


const base = process.argv[2] ?? 'http://localhost:8888';
const username = process.argv[3] ?? `ext${Date.now().toString(36).slice(-7)}`;
const engineDir = process.env.ENGINE_DIR ?? `${process.env.HOME}/code/lostcity-dev/engine`;

const TELE = '::tele 0,50,50,20,20';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

// 1. build the template and serve its output through the engine
const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: 'templates/script-template' });
if (build.exitCode !== 0) fail(`template build failed: ${build.stderr.toString()}`);
fs.copyFileSync('templates/script-template/dist/bot.js', `${engineDir}/public/bot/external-test-bot.js`);
console.log('template built and copied to engine public/bot/');

type Rs2b0t = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; sideIcon: number[]; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { level: string; msg: string }[] } | null };
    };
};

const browser = await launchBrowser();

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    const boot = async () => {
        await page.waitForFunction(() => (globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t !== undefined && (globalThis as never as { rs2b0t: { client: { constructor: { loopCycle: number } } } }).rs2b0t.client.constructor.loopCycle > 10, undefined, { timeout: 60000 });
    };

    const login = async () => {
        await page.evaluate(
            ([user, pass]) => {
                const { client } = (globalThis as never as Rs2b0t).rs2b0t;
                client.loginUser = user;
                client.loginPass = pass;
                void client.login(user, pass, false);
            },
            [username, 'test']
        );
        return page
            .waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 12000 })
            .then(() => true)
            .catch(() => false);
    };

    const type = async (text: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(text, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1200);
    };

    await page.goto(`${base}/bot.html`);
    await boot();
    if (!(await login())) fail('first login failed');
    console.log(`logged in as '${username}'`);

    await type(TELE);
    await page.reload();
    await boot();
    let backIn = false;
    for (let attempt = 0; attempt < 8 && !backIn; attempt++) {
        await page.waitForTimeout(5000);
        backIn = await login();
    }
    if (!backIn) fail('re-login failed');
    const invTab = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.client.sideIcon[3] ?? -1) !== -1);
    if (!invTab) fail('tabs still locked');
    console.log('re-logged in, tabs unlocked');

    // rebrand: the panel header must read 'rs2b0t'
    const title = await page.evaluate(() => document.querySelector('.rs2b0t-title')?.textContent ?? '');
    if (title !== 'rs2b0t') fail(`panel title is '${title}', expected 'rs2b0t'`);
    console.log('panel title reads rs2b0t');

    await type('::give bones 25');
    const haveBones = await page.evaluate(() => ((globalThis as never as { rs2b0t: { reader: { inventory(): { name: string | null }[] } } }).rs2b0t.reader.inventory() ?? []).some(i => i.name?.toLowerCase() === 'bones'));
    if (!haveBones) fail('::give bones did not land');
    console.log('bones acquired');

    // 2. load the external script via the panel URL loader
    const loadUrl = async () => {
        await page.fill('.rs2b0t-input', '/bot/external-test-bot.js');
        await page.getByRole('button', { name: 'Load URL' }).click();
        await page.waitForFunction(
            () => {
                const text = document.querySelector('.rs2b0t-load-status')?.textContent ?? '';
                return text.length > 0 && text !== 'loading…';
            },
            undefined,
            { timeout: 15000 }
        );
        return page.evaluate(() => document.querySelector('.rs2b0t-load-status')?.textContent ?? '');
    };

    let status = await loadUrl();
    if (!status.includes("loaded 'BoneBurier'")) fail(`load failed: '${status}'`);

    // the URL loader auto-selects the loaded script; the picker is the ScriptLibrary
    // (card list, no <select>), so verify via the current-script label + the registry.
    const regCount = () => page.evaluate(() => (globalThis as never as { rs2b0t: { registry: { list(): { name: string }[] } } }).rs2b0t.registry.list().filter(s => s.name === 'BoneBurier').length);
    const currentScript = () => page.evaluate(() => document.querySelector('.rs2b0t-current-script')?.textContent ?? '');
    if ((await regCount()) !== 1) fail('BoneBurier not registered exactly once');
    if ((await currentScript()) !== 'BoneBurier') fail(`expected BoneBurier auto-selected, got '${await currentScript()}'`);
    console.log('external script loaded, registered, and auto-selected');

    // 3. run it (already selected by the loader)
    await page.getByRole('button', { name: 'Start' }).click();

    await page.waitForFunction(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).filter(l => l.msg.startsWith('buried bones')).length >= 10, undefined, { timeout: 180000 });
    console.log('external bot buried 10+ bones');

    // 4. reload while running must be refused
    status = await loadUrl();
    if (!status.includes('stop it before reloading')) fail(`expected running-refusal, got '${status}'`);
    console.log('hot-reload refused while running (correct)');

    await page.screenshot({ path: 'out/external-script-test.png' });

    await page.getByRole('button', { name: 'Stop' }).click();
    await page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state === 'stopped', undefined, { timeout: 10000 });

    // 5. hot reload after stop: replaces, no duplicates
    status = await loadUrl();
    if (!status.includes("loaded 'BoneBurier'")) fail(`hot reload failed: '${status}'`);
    if ((await regCount()) !== 1) fail('hot reload duplicated the registration');
    console.log('hot reload replaced the registration, no duplicates');

    console.log('screenshot: out/external-script-test.png');
    console.log('PASS');
} finally {
    await browser.close();
}
