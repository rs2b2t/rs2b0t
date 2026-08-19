// Issue #430 — live HerbloreSecondaries proof: [base] [secondary-name].
// Seeds each secondary's site and asserts the bot loots, buys or grinds at least one unit.

//   bun e2e/herblore-secondaries-test.ts [http://localhost:8888] [secondary-name]
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, positionalArgs, setSettings } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const only = args[1]?.toLowerCase();

type Case = {
    key: string;
    setting: string;
    /** tele args after setstat food coins */
    tele: string;
    seed: string[];
    /** inventory name that must increase */
    product: string;
    timeoutMs: number;
};

// Absolute tele: tele level,mx,mz,lx,lz
const CASES: Case[] = [
    {
        key: 'eggs',
        setting: "Red spiders' eggs",
        tele: '0,48,155,37,31', // near Edgeville dungeon eggs
        seed: ['~bankitem lobster 50', 'give lobster 10'],
        product: "Red spiders' eggs",
        timeoutMs: 240_000
    },
    {
        key: 'snape',
        setting: 'Snape grass',
        tele: '0,45,51,28,32',
        seed: ['~bankitem lobster 50', 'give lobster 10'],
        product: 'Snape grass',
        timeoutMs: 180_000
    },
    {
        key: 'newt',
        setting: 'Eye of newt',
        // Betty @ 3012,3259 → m47_50 local 4,59
        tele: '0,47,50,4,59',
        seed: ['~bankitem coins 10000', 'give coins 2000'],
        product: 'Eye of newt',
        timeoutMs: 180_000
    },
    {
        key: 'choc',
        setting: 'Chocolate dust',
        // Wydin @ 3014,3204 → m47_50 local 6,4 — seed pestle so grind can run immediately
        tele: '0,47,50,6,4',
        seed: ['~bankitem coins 10000', 'give coins 3000', 'give pestle_and_mortar 1'],
        product: 'Chocolate dust',
        timeoutMs: 300_000
    },
    {
        key: 'berries',
        setting: 'White berries',
        // red dragon isle berries @ 3216,3812 → m50_59 local 16,36
        tele: '0,50,59,16,36',
        seed: ['~bankitem lobster 50', 'give lobster 10', '~bankitem antidragonbreathshield 1', 'give antidragonbreathshield 1'],
        product: 'White berries',
        timeoutMs: 240_000
    },
    {
        key: 'toads',
        setting: "Toad's legs",
        // swamp toads @ ~2415,3514 → m37_54 local 47,50
        tele: '0,37,54,47,50',
        seed: [],
        product: "Toad's legs",
        timeoutMs: 240_000
    }
];

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number; contains(name: string): boolean };
        Equipment: { contains(name: string): boolean };
    };
    rs2b0t: {
        runner: { start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
}

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const user = `hs${Date.now().toString(36).slice(-5)}`;

try {
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) fail('login failed');
    await bringUpOffIsland(page, { user });
    await cheatQuiet(page, 'speed 200', 600);
    for (const s of ['attack', 'strength', 'defence', 'hitpoints', 'agility', 'herblore']) {
        await cheatQuiet(page, `setstat ${s} 40`, 500);
    }
    console.log(`ingame as ${user}`);

    const run = CASES.filter(c => !only || c.key.includes(only) || c.setting.toLowerCase().includes(only));
    if (run.length === 0) fail(`no cases match '${only}'`);

    for (const c of run) {
        console.log(`\n=== ${c.setting} ===`);
        await page.evaluate(() => {
            try {
                (globalThis as never as Api).rs2b0t.runner.stop('harness stop');
            } catch {
                /* */
            }
        });
        await page.waitForTimeout(500);

        // drop pack between cases so seeds land
        await page.evaluate(async () => {
            const Inv = (globalThis as unknown as {
                __rs2b0t?: { Inventory?: { items(): { name?: string; interact(op: string): unknown }[] } };
            }).__rs2b0t?.Inventory;
            if (!Inv?.items) return;
            for (const it of [...Inv.items()]) {
                if (!it?.name) continue;
                try {
                    await it.interact('Drop');
                } catch {
                    /* */
                }
            }
        });
        await page.waitForTimeout(1500);
        for (const cmd of c.seed) {
            await cheatQuiet(page, cmd, 1200);
        }
        // clear level-up / mesbox so ~bankitem can stick
        for (let i = 0; i < 6; i++) {
            await page.evaluate(() => {
                const g = globalThis as unknown as {
                    rs2b0t?: { reader?: { modals?(): { chat: number } }; actions?: { continueDialog?(): void } };
                };
                const r = g.rs2b0t?.reader;
                if (r?.modals?.().chat !== -1) g.rs2b0t?.actions?.continueDialog?.();
            });
            await page.waitForTimeout(200);
        }
        await cheatQuiet(page, `tele ${c.tele}`, 4000);

        // re-assert critical tools after tele (shop stock is shared/world)
        if (c.key === 'choc') {
            // wipe non-essential stacks so give can land
            await cheatQuiet(page, 'give pestle_and_mortar 1', 1200);
            await cheatQuiet(page, 'give chocolate_bar 3', 1200);
            const has = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.contains('Pestle and mortar'));
            if (!has) {
                // pack full of leftover loot — bank first at Draynor then re-seed
                await cheatQuiet(page, 'tele 0,48,50,29,43', 3000); // draynor bank
                await cheatQuiet(page, 'give pestle_and_mortar 1', 1200);
                await cheatQuiet(page, 'give chocolate_bar 5', 1200);
                await cheatQuiet(page, `tele ${c.tele}`, 3000);
            }
        }
        const seededFood = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.count('Lobster'));
        const seededCoins = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.count('Coins'));
        const pestle = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.contains('Pestle and mortar'));
        console.log(`  seed check: lobster=${seededFood} coins=${seededCoins} pestle=${pestle}`);

        const before = await page.evaluate(name => (globalThis as never as Api).__rs2b0t.Inventory.count(name), c.product);

        await setSettings(page, 'HerbloreSecondaries', {
            secondary: c.setting,
            food: 'Lobster',
            foodWithdraw: 10
        });
        const started = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const meta = g.rs2b0t.registry.get('HerbloreSecondaries');
            if (!meta) return false;
            g.rs2b0t.runner.start(meta);
            return true;
        });
        if (!started) fail('HerbloreSecondaries not registered');

        const ok = await page
            .waitForFunction(
                ([name, start]) => (globalThis as never as Api).__rs2b0t.Inventory.count(String(name)) > (start as number),
                [c.product, before],
                { timeout: c.timeoutMs }
            )
            .then(() => true)
            .catch(() => false);

        const log = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-10).map(l => l.msg));
        const after = await page.evaluate(name => (globalThis as never as Api).__rs2b0t.Inventory.count(name), c.product);
        const tile = await page.evaluate(() => (globalThis as never as Api).rs2b0t.reader.worldTile());
        console.log(`  tile ${JSON.stringify(tile)} ${c.product}: ${before} → ${after}`);
        for (const l of log) console.log(`  ${l}`);

        await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));
        if (!ok) fail(`${c.setting}: never obtained ${c.product}`);
        console.log(`PASS — ${c.setting} (+${after - before})`);
    }

    await page.screenshot({ path: 'docs/e2e/issue-430-herblore-secondaries.png' });
    console.log('\nPASS all secondaries — screenshot docs/e2e/issue-430-herblore-secondaries.png');
} finally {
    await browser.close();
}
