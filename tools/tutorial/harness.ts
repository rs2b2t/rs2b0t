import type { Page } from 'playwright-core';

type Rs2b0t = {
    rs2b0t: {
        client: {
            ingame: boolean;
            sceneState: number;
            loginUser: string;
            loginPass: string;
            login(u: string, p: string, r: boolean): Promise<void>;
            logout(): Promise<void>;
            constructor: { loopCycle: number };
            sideIcon: number[];
            out: { p1Enc(op: number): void; p1(v: number): void; pjstr(s: string): void };
        };
        reader: { varp(index: number): number; chat(n: number): { type: number; username: string | null; text: string }[] };
        runner: { start(meta: unknown): void };
        registry: { get(name: string): unknown };
    };
};

/** Cold cache / first headed Chrome often spends minutes on jag + ondemand. */
const BOOT_MS = Number(process.env.BOOT_MS) || 180_000;
const LOGIN_MS = Number(process.env.LOGIN_MS) || 120_000;
/** Engine holds the old session ~30s after unclean logout before accepting login. */
const RELOG_COOLDOWN_MS = Number(process.env.RELOG_COOLDOWN_MS) || 28_000;
const RELOG_BUDGET_MS = Number(process.env.RELOG_BUDGET_MS) || 120_000;

async function waitClientBooted(page: Page, label: string): Promise<void> {
    // loopCycle only advances once title-screen assets are loaded and the game
    // loop is running — longer than jag download alone on a cold profile.
    try {
        await page.waitForFunction(
            () =>
                ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t
                    ?.client.constructor.loopCycle ?? 0) > 10,
            undefined,
            { timeout: BOOT_MS }
        );
    } catch {
        throw new Error(
            `${label}: client never reached title loop within ${Math.round(BOOT_MS / 1000)}s ` +
                `(still downloading cache/assets? set BOOT_MS=…)`
        );
    }
}

async function waitIngame(page: Page, timeoutMs: number, label: string): Promise<void> {
    try {
        await page.waitForFunction(
            () => {
                const { client } = (globalThis as never as Rs2b0t).rs2b0t;
                return client.ingame && client.sceneState === 2;
            },
            undefined,
            { timeout: timeoutMs }
        );
    } catch {
        throw new Error(
            `${label}: not ingame/scene-ready within ${Math.round(timeoutMs / 1000)}s ` +
                `(map download lag or login rejected — set LOGIN_MS=…)`
        );
    }
}

export async function bootAndLogin(page: Page, base: string, user: string): Promise<void> {
    console.log(`  boot: loading ${base}/bot.html (cache download may take a while; BOOT_MS=${Math.round(BOOT_MS / 1000)}s)`);
    await page.goto(`${base}/bot.html?nodeid=10`);
    await waitClientBooted(page, 'bootAndLogin');
    console.log('  boot: title loop up — logging in');

    await page.evaluate(u => {
        const { client } = (globalThis as never as Rs2b0t).rs2b0t;
        client.loginUser = u;
        client.loginPass = 'test';
        void client.login(u, 'test', false);
    }, user);

    await waitIngame(page, LOGIN_MS, 'bootAndLogin');
    console.log('  boot: ingame, scene ready');
}

export async function relog(page: Page, user: string): Promise<void> {
    console.log(
        `  relog: logout → ${Math.round(RELOG_COOLDOWN_MS / 1000)}s engine cooldown ` +
            `(dead-connection hold; RELOG_COOLDOWN_MS / RELOG_BUDGET_MS override)`
    );
    await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.client.logout());
    await page.waitForFunction(() => !(globalThis as never as Rs2b0t).rs2b0t.client.ingame, undefined, {
        timeout: 20_000
    });

    const attemptLogin = () =>
        page.evaluate(u => {
            const { client } = (globalThis as never as Rs2b0t).rs2b0t;
            client.loginUser = u;
            client.loginPass = 'test';
            void client.login(u, 'test', false);
        }, user);

    const isIngame = () =>
        page
            .waitForFunction(
                () => {
                    const { client } = (globalThis as never as Rs2b0t).rs2b0t;
                    return client.ingame && client.sceneState === 2;
                },
                undefined,
                { timeout: 12_000 }
            )
            .then(() => true)
            .catch(() => false);

    // Fixed hold: Engine-TS rejects login until the prior connection is fully dead.
    await page.waitForTimeout(RELOG_COOLDOWN_MS);

    // Title loop must still be ticking (cache/UI ready) before we hammer login.
    await waitClientBooted(page, 'relog');

    const deadline = Date.now() + RELOG_BUDGET_MS;
    let attempt = 0;
    for (;;) {
        attempt++;
        await attemptLogin();
        if (await isIngame()) {
            console.log(`  relog: back ingame (attempt ${attempt})`);
            return;
        }
        if (Date.now() >= deadline) {
            throw new Error(
                `relog: could not log back in as '${user}' after ${attempt} attempts / ` +
                    `${Math.round(RELOG_BUDGET_MS / 1000)}s (engine dead-connection or client still loading)`
            );
        }
        console.log(`  relog: attempt ${attempt} not ingame yet — retry`);
        await page.waitForTimeout(4000);
    }
}

export async function cheat(page: Page, command: string): Promise<void> {
    await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
    await page.waitForTimeout(200);
    await page.keyboard.type(`::${command}`, { delay: 25 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
}

export async function cheatQuiet(page: Page, command: string): Promise<boolean> {
    const sent = await page.evaluate(c => {
        const { client } = (globalThis as never as Rs2b0t).rs2b0t;
        if (!client.ingame) {
            return false;
        }
        client.out.p1Enc(224);
        client.out.p1(c.length + 1);
        client.out.pjstr(c);
        return true;
    }, command);
    await page.waitForTimeout(700);
    return sent;
}

export async function getServerVar(page: Page, name: string): Promise<number | null> {
    await cheat(page, `getvar ${name}`);
    const lines = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.chat(5));
    const line = lines.find(l => l.text.toLowerCase().startsWith(`get ${name.toLowerCase()}:`));
    if (!line) {
        return null;
    }

    const value = parseInt(line.text.split(':')[1]?.trim() ?? '', 10);
    return Number.isNaN(value) ? null : value;
}

export async function getServerVarQuiet(page: Page, name: string): Promise<number | null> {
    const sent = await page.evaluate(n => {
        const { client } = (globalThis as never as Rs2b0t).rs2b0t;
        if (!client.ingame) {
            return false;
        }
        const cmd = `getvar ${n}`;
        client.out.p1Enc(224);
        client.out.p1(cmd.length + 1);
        client.out.pjstr(cmd);
        return true;
    }, name);
    if (!sent) {
        return null;
    }

    await page.waitForTimeout(900);
    const lines = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.chat(8));
    const line = lines.find(l => l.text.toLowerCase().startsWith(`get ${name.toLowerCase()}:`));
    if (!line) {
        return null;
    }

    const value = parseInt(line.text.split(':')[1]?.trim() ?? '', 10);
    return Number.isNaN(value) ? null : value;
}

// Lumbridge courtyard — same hop other live harnesses use (not a tutorial stage walk).
const OFF_ISLAND_TELE = '0,50,50,20,20';

/**
 * New account → off Tutorial Island without running TutorialBot.
 *
 * Uses CLIENT_CHEAT packets (`cheatQuiet`), not keyboard `::…` typing. On the
 * island the chat/tutorial UI often eats keystrokes, which looks like the bot
 * is "doing tutorial wrong" and stalls for a long time before setvar sticks.
 *
 * Relog is still required: tutorial UI lock / side icons refresh at login.
 */
export async function mainlandAccount(page: Page, base: string, user: string): Promise<void> {
    console.log(`mainlandAccount: boot+login as '${user}'`);
    await bootAndLogin(page, base, user);

    console.log(`mainlandAccount: tele ${OFF_ISLAND_TELE} + setvar tutorial 1000`);
    if (!(await cheatQuiet(page, `tele ${OFF_ISLAND_TELE}`))) {
        throw new Error('mainlandAccount: tele not sent (not ingame?)');
    }
    // Tile updates before zone scenery; brief settle is enough for setvar.
    await page.waitForTimeout(900);

    let tut: number | null = null;
    for (let attempt = 0; attempt < 4 && tut !== 1000; attempt++) {
        if (attempt > 0) {
            await page.waitForTimeout(600);
        }
        if (!(await cheatQuiet(page, 'setvar tutorial 1000'))) {
            throw new Error('mainlandAccount: setvar tutorial not sent');
        }
        tut = await getServerVarQuiet(page, 'tutorial');
    }
    if (tut !== 1000) {
        throw new Error(`mainlandAccount: setvar tutorial 1000 did not stick after retries (getvar=${tut}) -- still on-island?`);
    }

    // Side icons / tutorial UI lock only refresh from the login payload.
    await relog(page, user);

    const unlocked = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.client.sideIcon[3] ?? -1) !== -1);
    if (!unlocked) {
        throw new Error('mainlandAccount: sidebar still tutorial-locked after tele + setvar tutorial=1000 + relog');
    }
    console.log('mainlandAccount: tabs unlocked');
}

export async function startScript(page: Page, name: string): Promise<void> {
    await page.evaluate(n => {
        const { runner, registry } = (globalThis as never as Rs2b0t).rs2b0t;
        runner.start(registry.get(n));
    }, name);
}

export async function runToVarp(page: Page, varpIndex: number, target: number, timeoutMs: number): Promise<boolean> {
    return page
        .waitForFunction(([i, t]) => (globalThis as never as Rs2b0t).rs2b0t.reader.varp(i) >= t, [varpIndex, target], { timeout: timeoutMs })
        .then(() => true)
        .catch(() => false);
}

export async function tutorialVarp(page: Page, i: number): Promise<number> {
    return page.evaluate(idx => (globalThis as never as Rs2b0t).rs2b0t.reader.varp(idx), i);
}
