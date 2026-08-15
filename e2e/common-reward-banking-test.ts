import { boot, bringUpOffIsland, launchBrowser, login, positionalArgs, startFromLibrary, type } from './lib/harness.js';
import type { Page } from 'playwright-core';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const BANK_TELE = '::tele 0,41,51,31,22'; // East Ardougne bank stand (2655, 3286)

function fail(message: string): never {
    throw new Error(`FAIL: ${message}`);
}

type Rs2b0t = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
        reader: {
            inventory(): { id: number; name: string | null; count: number }[];
            bankItems(): { id: number; name: string | null; count: number }[];
            worldTile(): { x: number; z: number; level: number } | null;
            chat(count: number): { text: string }[];
        };
    };
};

async function command(page: Page, text: string, waitMs: number = 1_400): Promise<void> {
    await page.locator('#canvas').focus();
    await page.keyboard.type(text, { delay: 25 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(waitMs);
}

async function inventoryCount(page: Page, id: number): Promise<number> {
    return page.evaluate(itemId => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory()
        .filter(item => item.id === itemId)
        .reduce((sum, item) => sum + item.count, 0), id);
}

async function giveItem(page: Page, debugName: string, id: number, count: number): Promise<void> {
    const before = await inventoryCount(page, id);
    await command(page, `::give ${debugName} ${count}`);
    const added = await page.waitForFunction(
        ([itemId, previous, amount]) => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory()
            .filter(item => item.id === itemId)
            .reduce((sum, item) => sum + item.count, 0) >= previous + amount,
        [id, before, count],
        { timeout: 4_000 }
    ).then(() => true).catch(() => false);
    if (!added) {
        const diagnostic = await page.evaluate(() => ({
            inventory: (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().map(item => `${item.name}#${item.id}x${item.count}`),
            chat: (globalThis as never as Rs2b0t).rs2b0t.reader.chat(10).map(line => line.text)
        }));
        fail(`::give ${debugName} did not add ${count} of #${id}; ${JSON.stringify(diagnostic)}`);
    }
}

const browser = await launchBrowser();

async function runCase(commonRewards: boolean): Promise<void> {
    const page = await browser.newPage();
    const username = `c${commonRewards ? 'on' : 'off'}${Date.now().toString(36).slice(-7)}`;
    const query = `?AutoFighter.solveClues=false&AutoFighter.foodWithdraw=0&AutoFighter.bankAtLootSlots=1${commonRewards ? '' : '&Global.bankCommonJunk=false'}`;

    try {
        page.on('pageerror', error => console.log(`pageerror: ${error}`));
        await page.goto(`${base}/bot.html${query}`);
        await boot(page);
        if (!(await login(page, username))) {
            fail(`${commonRewards ? 'enabled' : 'disabled'} case could not create its account`);
        }
        await bringUpOffIsland(page, { user: username });

        await type(page, '::speed 300');
        await type(page, BANK_TELE);

        const tile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
        if (!tile || Math.max(Math.abs(tile.x - 2655), Math.abs(tile.z - 3286)) > 2) {
            fail(`bank setup landed at ${tile ? `${tile.x},${tile.z},${tile.level}` : 'no tile'}`);
        }

        await giveItem(page, 'casket', 405, 1);
        await giveItem(page, 'trail_clue_easy_map001_casket', 2714, 1);
        await giveItem(page, 'uncut_sapphire', 1623, 1);
        await giveItem(page, 'cake', 1891, 25);

        const setup = await page.evaluate(() => {
            const inventory = (globalThis as never as Rs2b0t).rs2b0t.reader.inventory();
            return {
                rewardCaskets: inventory.filter(item => item.id === 405).length,
                clueCaskets: inventory.filter(item => item.id === 2714).length,
                uncutSapphires: inventory.filter(item => item.id === 1623).length,
                cakes: inventory.filter(item => item.name?.toLowerCase() === 'cake').length,
                used: inventory.length
            };
        });
        if (setup.rewardCaskets !== 1 || setup.clueCaskets !== 1 || setup.uncutSapphires !== 1 || setup.cakes !== 25 || setup.used !== 28) {
            fail(`inventory setup was reward-caskets=${setup.rewardCaskets}, clue-caskets=${setup.clueCaskets}, sapphires=${setup.uncutSapphires}, cakes=${setup.cakes}, used=${setup.used}`);
        }

        await startFromLibrary(page, 'Combat', 'AutoFighter');
        await page.getByRole('button', { name: 'Start', exact: true }).click();

        await page.waitForFunction(
            () => {
                const bot = (globalThis as never as Rs2b0t).rs2b0t;
                return !bot.reader.inventory().some(item => item.name?.toLowerCase() === 'cake')
                    && bot.reader.bankItems().some(item => item.id === 1623);
            }, undefined,
            { timeout: 90_000 }
        );

        const result = await page.evaluate(() => {
            const bot = (globalThis as never as Rs2b0t).rs2b0t;
            const inventory = bot.reader.inventory();
            return {
                hasRewardCasket: inventory.some(item => item.id === 405),
                hasClueCasket: inventory.some(item => item.id === 2714),
                bankHasRewardCasket: bot.reader.bankItems().some(item => item.id === 405),
                bankHasClueCasket: bot.reader.bankItems().some(item => item.id === 2714),
                cakes: inventory.filter(item => item.name?.toLowerCase() === 'cake').length,
                log: bot.runner.ctx?.log.slice(-20).map(line => line.msg) ?? []
            };
        });

        console.log(`--- common rewards ${commonRewards ? 'enabled (default)' : 'disabled'} ---`);
        for (const line of result.log) {
            console.log(`  ${line}`);
        }
        if (result.cakes !== 0) {
            fail(`${result.cakes} cakes remained after the bank trip`);
        }
        if (result.hasRewardCasket === commonRewards) {
            fail(`random-event Casket#405 was ${result.hasRewardCasket ? 'kept' : 'banked'} with common rewards ${commonRewards ? 'enabled' : 'disabled'}`);
        }
        if (result.bankHasRewardCasket !== commonRewards) {
            fail(`bank ${result.bankHasRewardCasket ? 'contained' : 'did not contain'} random-event Casket#405 with common rewards ${commonRewards ? 'enabled' : 'disabled'}`);
        }
        if (!result.hasClueCasket || result.bankHasClueCasket) {
            fail('Treasure Trail Casket#2714 was banked with the random-event reward');
        }

        if (commonRewards) {
            await page.screenshot({ path: 'out/issue88-casket-banked.png' });
        }
        console.log(`PASS: common rewards ${commonRewards ? 'enabled banks' : 'disabled keeps'} the Casket`);
    } finally {
        const ingame = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame).catch(() => false);
        if (ingame) {
            await command(page, '::speed 600', 300).catch(() => undefined);
        }
        await page.close();
    }
}

try {
    await runCase(true);
    await runCase(false);
    console.log('PASS: issue #88 default casket banking and its opt-out both work in-game');
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    await browser.close();
}
