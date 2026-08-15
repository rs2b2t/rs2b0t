import { boot, cheatQuiet, fail, launchBrowser, login, parseArgs } from './lib/harness.js';
import { relog } from './tutorial/harness.js';

const { base, rest } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8990' });
const username = rest[0] ?? `wfexit${Date.now().toString(36).slice(-5)}`;
const password = rest[1] ?? 'test';
const nodePort = Number(rest[2] ?? process.env.NODE_PORT ?? 43790);
const START = { x: 2603, z: 9913, level: 0 };
const BANK = { x: 2616, z: 3332, level: 0 };

interface ExitResult {
    ok: boolean;
    tile: { x: number; z: number; level: number } | null;
    logs: string[];
    error?: string;
}

interface BrowserApi {
    __rs2b0t: {
        Quests: { status(name: string): string };
        ChatDialog: { canContinue(): boolean; continue(): Promise<boolean> };
        Inventory: { countById(id: number): number };
        Skills: { level(name: string): number };
        LoopingBot: new () => { loop(): number | void | Promise<number | void> };
        registerScript(manifest: { name: string; create(): unknown }): unknown;
        Traversal: {
            walkResilient(
                destination: typeof BANK,
                options: {
                    radius: number;
                    attempts: number;
                    timeoutMs: number;
                    log(message: string): void;
                }
            ): Promise<boolean>;
        };
        reader: {
            chat(count: number): { text: string }[];
            worldTile(): { x: number; z: number; level: number } | null;
            locs(): { name: string | null; ops: (string | null)[]; tile: { x: number; z: number } }[];
        };
    };
    rs2b0t: {
        client: { tutComMessage: string | null };
        runner: {
            state: string;
            start(meta: unknown): void;
            stop(reason: string): void;
        };
    };
    __waterfallDialogPrep?: { cleared: boolean; error?: string };
    __waterfallRaisedExitTile?: { x: number; z: number; level: number };
    __waterfallExitResult?: ExitResult;
}

function near(a: { x: number; z: number; level: number } | null, b: typeof BANK, radius: number): boolean {
    return a !== null && a.level === b.level && Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) <= radius;
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('console', message => {
        if (message.text().startsWith('[waterfall-exit]')) console.log(message.text());
    });
    await page.goto(`${base}/bot.html?server=localhost&port=${nodePort}`);
    await boot(page);
    if (!(await login(page, username, password))) {
        const diagnostic = await page.evaluate(() => {
            const client = (globalThis as never as {
                rs2b0t: { client: { loginMes1: string; loginMes2: string; ingame: boolean; sceneState: number } };
            }).rs2b0t.client;
            return { loginMes1: client.loginMes1, loginMes2: client.loginMes2, ingame: client.ingame, sceneState: client.sceneState };
        });
        fail(`could not log in '${username}' at ${base}: ${JSON.stringify(diagnostic)}`);
    }

    // Twice the normal server rate keeps this walk quick while preserving
    // every server-side movement and scenery interaction.
    if (!(await cheatQuiet(page, 'speed 300'))) fail('could not set the isolated server to 300ms ticks');
    if (!(await cheatQuiet(page, 'tele 0,40,154,43,57', 1500))) fail('could not teleport to the raised chamber');
    await page.waitForFunction(
        start => {
            const tile = (globalThis as never as BrowserApi).__rs2b0t.reader.worldTile();
            return tile?.x === start.x && tile.z === start.z && tile.level === start.level;
        },
        START,
        { timeout: 15_000 }
    );

    // Remove Tutorial Island's interaction restrictions only after leaving its
    // map scripts, which otherwise normalize the stage back to 1.
    if (!(await cheatQuiet(page, 'setvar tutorial 1000'))) fail('could not unlock the isolated test profile');
    if (!(await cheatQuiet(page, 'getvar tutorial'))) fail('could not verify the isolated test profile');
    const tutorial = await page.evaluate(() => {
        const line = (globalThis as never as BrowserApi).__rs2b0t.reader
            .chat(8)
            .find(entry => entry.text.toLowerCase().startsWith('get tutorial:'));
        return line ? Number(line.text.split(':')[1]?.trim()) : null;
    });
    if (tutorial !== 1000) fail(`tutorial unlock did not stick (getvar=${tutorial})`);

    if (!(await cheatQuiet(page, 'setvar waterfall_quest 10'))) fail('could not mark Waterfall Quest complete');
    if (!(await cheatQuiet(page, 'getvar waterfall_quest'))) fail('could not verify Waterfall Quest completion');
    const waterfallStage = await page.evaluate(() => {
        const line = (globalThis as never as BrowserApi).__rs2b0t.reader
            .chat(8)
            .find(entry => entry.text.toLowerCase().startsWith('get waterfall_quest:'));
        return line ? Number(line.text.split(':')[1]?.trim()) : null;
    });
    if (waterfallStage !== 10) fail(`Waterfall completion did not stick (getvar=${waterfallStage})`);

    // Reload the sidebar/journal after changing tutorial and quest varps, as an account does between finishing Waterfall and starting the next quest.
    // The local-server login password is deliberately `test`.
    if (password !== 'test') fail('the isolated completion fixture requires the local test password');
    await relog(page, username);
    await page.waitForFunction(
        start => {
            const tile = (globalThis as never as BrowserApi).__rs2b0t.reader.worldTile();
            return tile?.x === start.x && tile.z === start.z && tile.level === start.level;
        },
        START,
        { timeout: 15_000 }
    );

    // Debug replies are reported through the client's legacy tutorial-message
    // overlay, not a ChatDialog interface. A canvas click dismisses it.
    for (let click = 0; click < 3; click++) {
        const message = await page.evaluate(() => (globalThis as never as BrowserApi).rs2b0t.client.tutComMessage);
        if (message === null) break;
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(300);
    }
    const tutorialMessage = await page.evaluate(() => (globalThis as never as BrowserApi).rs2b0t.client.tutComMessage);
    if (tutorialMessage !== null) fail(`could not dismiss debug-command message '${tutorialMessage}'`);

    // Seed the retained key after relogging and dismissing the legacy debug
    // overlay, so the refreshed backpack interface observes the inventory update.
    if (!(await cheatQuiet(page, 'give baxtorian_key_waterfall_quest 1'))) fail('could not seed the retained Baxtorian key');
    // Why: the fresh fixture has only 10 HP, unlike the quest bot's food-backed completion loadout, so raise survivability or dungeon NPCs turn this navigation proof into a death-recovery test.
    if (!(await cheatQuiet(page, 'setstat hitpoints 99'))) fail('could not protect the isolated fixture from dungeon combat');
    if (!(await cheatQuiet(page, 'setstat defence 99'))) fail('could not protect the isolated fixture from dungeon combat');
    await page.waitForFunction(
        () => {
            const api = (globalThis as never as BrowserApi).__rs2b0t;
            return api.Inventory.countById(298) === 1 && api.Skills.level('hitpoints') === 99 && api.Skills.level('defence') === 99;
        },
        undefined,
        { timeout: 5000 }
    );

    // Clear any ordinary interface dialogue under the live scheduler too,
    // before proving that scenery interactions are usable.
    await page.evaluate(() => {
        const global = globalThis as never as BrowserApi;
        const api = global.__rs2b0t;
        class DialogPrep extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    for (let page = 0; page < 8 && api.ChatDialog.canContinue(); page++) {
                        if (!(await api.ChatDialog.continue())) break;
                    }
                    global.__waterfallDialogPrep = { cleared: !api.ChatDialog.canContinue() };
                } catch (error) {
                    global.__waterfallDialogPrep = { cleared: false, error: String(error) };
                } finally {
                    global.rs2b0t.runner.stop('harness stop');
                }
            }
        }

        global.__waterfallDialogPrep = undefined;
        const meta = api.registerScript({ name: 'WaterfallExitDialogPrep', create: () => new DialogPrep() });
        global.rs2b0t.runner.start(meta);
    });
    await page.waitForFunction(
        () => {
            const global = globalThis as never as BrowserApi;
            return typeof global.__waterfallDialogPrep !== 'undefined' && global.rs2b0t.runner.state === 'stopped';
        },
        undefined,
        { timeout: 15_000 }
    );
    const dialogPrep = await page.evaluate(() => (globalThis as never as BrowserApi).__waterfallDialogPrep!);
    if (!dialogPrep.cleared) fail(`could not clear debug-command dialog: ${dialogPrep.error ?? 'still open'}`);

    const before = await page.evaluate(() => {
        const api = (globalThis as never as BrowserApi).__rs2b0t;
        return {
            tile: api.reader.worldTile(),
            quest: api.Quests.status('Waterfall Quest'),
            keyCount: api.Inventory.countById(298),
            amuletCount: api.Inventory.countById(295),
            hitpoints: api.Skills.level('hitpoints'),
            defence: api.Skills.level('defence'),
            doors: api.reader.locs()
                .filter(loc => loc.name === 'Door' && loc.ops.some(op => op?.startsWith('Open')))
                .map(loc => ({ tile: loc.tile, ops: loc.ops.filter(Boolean) }))
        };
    });
    console.log('raised chamber:', JSON.stringify(before));
    if (!near(before.tile, START, 0)) fail(`teleport landed at ${JSON.stringify(before.tile)}`);
    if (before.quest !== 'complete') fail(`isolated account has Waterfall state '${before.quest}' instead of complete`);
    if (before.keyCount !== 1) fail(`isolated account lost its Baxtorian key (count=${before.keyCount})`);
    if (before.amuletCount !== 0) fail(`post-quest fixture unexpectedly has Glarial's amulet (count=${before.amuletCount})`);
    if (before.hitpoints !== 99 || before.defence !== 99) fail(`isolated combat guard did not stick (hp=${before.hitpoints}, defence=${before.defence})`);
    if (!before.doors.some(door => Math.max(Math.abs(door.tile.x - 2604), Math.abs(door.tile.z - 9901)) <= 2)) {
        fail(`raised-room exit door was not loaded: ${JSON.stringify(before.doors)}`);
    }
    await page.screenshot({ path: 'out/waterfall-exit-start.png' });

    await page.evaluate(destination => {
        const global = globalThis as never as BrowserApi;
        const api = global.__rs2b0t;
        class ExitProbe extends api.LoopingBot {
            override async loop(): Promise<void> {
                const logs: string[] = [];
                try {
                    const ok = await api.Traversal.walkResilient(destination, {
                        radius: 3,
                        attempts: 5,
                        timeoutMs: 240_000,
                        log: message => {
                            logs.push(message);
                            console.log(`[waterfall-exit] ${message}`);
                        }
                    });
                    global.__waterfallExitResult = { ok, tile: api.reader.worldTile(), logs };
                } catch (error) {
                    global.__waterfallExitResult = { ok: false, tile: api.reader.worldTile(), logs, error: String(error) };
                } finally {
                    global.rs2b0t.runner.stop('harness stop');
                }
            }
        }

        global.__waterfallExitResult = undefined;
        global.__waterfallRaisedExitTile = undefined;
        const raisedExitWatcher = setInterval(() => {
            const tile = api.reader.worldTile();
            if (tile && tile.level === 0 && tile.x >= 2558 && tile.x <= 2590 && tile.z >= 9850 && tile.z <= 9910) {
                global.__waterfallRaisedExitTile = tile;
                clearInterval(raisedExitWatcher);
            }
        }, 50);
        const meta = api.registerScript({ name: 'WaterfallExitProbe', create: () => new ExitProbe() });
        global.rs2b0t.runner.start(meta);
    }, BANK);
    await page.waitForFunction(
        () => typeof (globalThis as never as BrowserApi).__waterfallRaisedExitTile !== 'undefined',
        undefined,
        { timeout: 90_000 }
    );
    const raisedExitTile = await page.evaluate(() => (globalThis as never as BrowserApi).__waterfallRaisedExitTile!);
    console.log('raised-room edge landed:', JSON.stringify(raisedExitTile));
    if (!near(raisedExitTile, { x: 2566, z: 9901, level: 0 }, 1)) {
        fail(`raised-room edge landed outside the source-defined original-room destination: ${JSON.stringify(raisedExitTile)}`);
    }
    await page.screenshot({ path: 'out/waterfall-exit-original-room.png' });
    await page.waitForFunction(
        () => {
            const global = globalThis as never as BrowserApi;
            return typeof global.__waterfallExitResult !== 'undefined' && global.rs2b0t.runner.state === 'stopped';
        },
        undefined,
        { timeout: 270_000 }
    );
    const result = await page.evaluate(() => (globalThis as never as BrowserApi).__waterfallExitResult as ExitResult);

    for (const message of result.logs) console.log(`  ${message}`);
    console.log('final:', JSON.stringify({ ok: result.ok, tile: result.tile }));
    if (result.error) fail(`traversal probe crashed: ${result.error}`);
    if (!result.ok || !near(result.tile, BANK, 3)) fail(`walk ended short of Ardougne bank: ${JSON.stringify(result.tile)}`);

    const required = [
        'Open Door at (2604,9901) ok',
        'Baxtorian keyed door: crossed',
        'Open Door at (2575,9861) ok'
    ];
    for (const proof of required) {
        if (!result.logs.some(message => message.includes(proof))) fail(`missing transport proof '${proof}'`);
    }

    await page.screenshot({ path: 'out/waterfall-exit-bank.png' });
    console.log('screenshots: out/waterfall-exit-start.png, out/waterfall-exit-original-room.png, out/waterfall-exit-bank.png');
    console.log('PASS: completed-quest traversal exited the Waterfall raised chamber without an amulet and reached Ardougne bank');
} finally {
    await browser.close();
}
