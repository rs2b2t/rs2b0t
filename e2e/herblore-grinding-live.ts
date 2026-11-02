import assert from 'node:assert/strict';
import type { Inventory } from '../src/bot/api/inventory/Inventory.js';
import type { Game } from '../src/bot/api/game/Game.js';
import { deployIsolatedClient, launchBrowser, positionalArgs, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

interface Api {
    __rs2b0t: { Inventory: typeof Inventory; Game: typeof Game };
    rs2b0t: { runner: { state: string; ctx: { log: { msg: string }[] } | null } };
    grindSamples: { tick: number; made: number }[];
}

const base = positionalArgs(process.argv.slice(2), 'http://localhost:8890')[0];
const cases = [
    { key: 'chocolate', source: 'Chocolate bar', debug: 'chocolate_bar', product: 'Chocolate dust', count: 26, bank: false },
    { key: 'unicorn', source: 'Unicorn horn', debug: 'unicorn_horn', product: 'Unicorn horn dust', count: 40, bank: true }
];
const browser = await launchBrowser();
try {
    for (const c of cases) {
        const user = `hg${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
        const client = deployIsolatedClient(user);
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        try {
            await mainlandAccount(page, base, user, client.page);
            if (c.bank) {
                await seedItemsToBank(page, [
                    { debugName: c.debug, displayName: c.source, qty: c.count },
                    { debugName: 'pestle_and_mortar', displayName: 'Pestle and mortar', qty: 1 }
                ], { x: 3093, z: 3243, level: 0 });
            } else {
                await cheatQuiet(page, 'give pestle_and_mortar 1');
                await cheatQuiet(page, 'give coins 2000');
                await cheatQuiet(page, `give ${c.debug} ${c.count}`);
                assert(await teleTo(page, { x: 3014, z: 3204, level: 0 }, 2, 30000));
            }
            await setSettings(page, 'HerbloreSecondaries', { secondary: c.product, foodWithdraw: 0 });
            await page.evaluate(product => {
                const g = globalThis as unknown as Api;
                g.grindSamples = [];
                let last = g.__rs2b0t.Inventory.count(product);
                setInterval(() => {
                    const count = g.__rs2b0t.Inventory.count(product);
                    if (count > last) g.grindSamples.push({ tick: g.__rs2b0t.Game.tick(), made: count - last });
                    last = count;
                }, 10);
            }, c.product);
            await startScript(page, 'HerbloreSecondaries');
            await page.waitForFunction(({ count, bank, source }) => {
                const g = globalThis as unknown as Api;
                const made = g.grindSamples.reduce((sum, sample) => sum + sample.made, 0);
                return made >= count && (!bank || g.rs2b0t.runner.ctx?.log.some(line => line.msg.includes(`out of ${source} in the bank`)));
            }, c, { timeout: 120000 });
            await stopScript(page);
            const result = await page.evaluate(({ product, source }) => {
                const g = globalThis as unknown as Api;
                return {
                    samples: g.grindSamples,
                    product: g.__rs2b0t.Inventory.count(product),
                    source: g.__rs2b0t.Inventory.count(source),
                    pestle: g.__rs2b0t.Inventory.count('Pestle and mortar'),
                    logs: (g.rs2b0t.runner.ctx?.log ?? []).map(line => line.msg)
                };
            }, c);
            const byTick = new Map<number, number>();
            for (const sample of result.samples) byTick.set(sample.tick, (byTick.get(sample.tick) ?? 0) + sample.made);
            const batches = Array.from(byTick, ([tick, made]) => ({ tick, made }));
            assert.equal(batches.reduce((sum, batch) => sum + batch.made, 0), c.count);
            assert(batches.every(batch => batch.made <= 5), JSON.stringify(batches));
            assert(batches.some((batch, i) => batch.made === 5 && batches[i + 1]?.made === 5 && batches[i + 1]?.tick === batch.tick + 1 && batches[i + 2]?.made === 5 && batches[i + 2]?.tick === batch.tick + 2), JSON.stringify(batches));
            assert.equal(result.source, 0);
            assert.equal(result.pestle, 1);
            assert.equal(result.product, c.bank ? 0 : c.count);
            assert.equal(result.logs.reduce((sum, line) => sum + Number(/^ground (\d+)×/.exec(line)?.[1] ?? 0), 0), c.count);
            await page.screenshot({ path: `docs/e2e/herblore-grinding-${c.key}-live.png` });
            console.log(`PASS ${c.product}: ${JSON.stringify(batches)}; ${c.count} produced, pestle retained${c.bank ? ', two bank loads drained and deposited' : ''}`);
        } finally {
            console.log(await page.evaluate(() => (globalThis as unknown as Api).rs2b0t?.runner.ctx?.log.map(line => line.msg)).catch(() => []));
            await stopScript(page).catch(() => {});
            await page.close();
            client.cleanup();
        }
    }
} finally {
    await browser.close();
}
