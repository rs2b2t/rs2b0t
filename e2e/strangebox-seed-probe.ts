// Probe: which seeding path puts a Strange box (macro_cube) in the pack.
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const user = process.argv[3] ?? `sbp${Date.now().toString(36).slice(-5)}`;

interface Api {
    __rs2b0t: {
        Inventory: { used(): number; items(): { id: number; name: string | null; count: number }[] };
    };
}

const browser = await launchBrowser();
const page = await browser.newPage();
page.on('console', m => {
    const t = m.text();
    if (/rs2b0t|random event/i.test(t)) console.log(`  [console] ${t}`);
});

const dump = async (): Promise<string> =>
    page.evaluate(() =>
        JSON.stringify(
            (globalThis as never as Api).__rs2b0t.Inventory.items().map(i => `${i.id}:${i.name}x${i.count}`)
        )
    );

try {
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) fail('login failed');
    await bringUpOffIsland(page, { user });
    console.log(`ingame as ${user}`);

    for (const cmd of ['give coins 5', 'give macro_cube 1', 'give macro_cube_redstar 1', '~give_strange_box', 'setvar xplamp 0']) {
        await cheatQuiet(page, cmd, 2500);
        console.log(`after "::${cmd}" -> ${await dump()}`);
    }
} finally {
    await browser.close();
}
