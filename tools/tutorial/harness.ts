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
/**
 * Minimum wait after logout before the first login probe.
 * Engine-TS keeps the old session alive after unclean logout (login response 5:
 * "already logged in / try again in 60 secs"). Live probes usually succeed ~30–40s
 * after logout — a long fixed sleep + 12s failed attempt was burning ~44s every run.
 */
const RELOG_COOLDOWN_MS = Number(process.env.RELOG_COOLDOWN_MS) || 20_000;
/** How long each login probe waits for ingame+scene before retrying. */
const RELOG_PROBE_MS = Number(process.env.RELOG_PROBE_MS) || 5_000;
/** Gap between failed probes (engine still holding the old session). */
const RELOG_RETRY_MS = Number(process.env.RELOG_RETRY_MS) || 3_000;
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
                '(still downloading cache/assets? set BOOT_MS=…)'
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
                '(map download lag or login rejected — set LOGIN_MS=…)'
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
        `  relog: logout → probe from ${Math.round(RELOG_COOLDOWN_MS / 1000)}s ` +
            `(${Math.round(RELOG_PROBE_MS / 1000)}s probes / ${Math.round(RELOG_RETRY_MS / 1000)}s gap; ` +
            'RELOG_COOLDOWN_MS / RELOG_PROBE_MS / RELOG_RETRY_MS / RELOG_BUDGET_MS override)'
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

    const isIngame = (timeoutMs: number) =>
        page
            .waitForFunction(
                () => {
                    const { client } = (globalThis as never as Rs2b0t).rs2b0t;
                    return client.ingame && client.sceneState === 2;
                },
                undefined,
                { timeout: timeoutMs }
            )
            .then(() => true)
            .catch(() => false);

    // Don't hammer login while the engine still holds the old session, but don't
    // oversleep either — probe early with short timeouts until one sticks.
    await page.waitForTimeout(RELOG_COOLDOWN_MS);

    // Title loop must still be ticking (cache/UI ready) before we hammer login.
    await waitClientBooted(page, 'relog');

    const deadline = Date.now() + RELOG_BUDGET_MS;
    let attempt = 0;
    for (;;) {
        attempt++;
        await attemptLogin();
        if (await isIngame(RELOG_PROBE_MS)) {
            console.log(`  relog: back ingame (attempt ${attempt})`);
            return;
        }
        if (Date.now() >= deadline) {
            throw new Error(
                `relog: could not log back in as '${user}' after ${attempt} attempts / ` +
                    `${Math.round(RELOG_BUDGET_MS / 1000)}s (engine dead-connection or client still loading)`
            );
        }
        if (attempt === 1 || attempt % 3 === 0) {
            console.log(`  relog: attempt ${attempt} not ingame yet — retry`);
        }
        await page.waitForTimeout(RELOG_RETRY_MS);
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

/**
 * Click through level-up / chat continues until the chat modal stays closed.
 * `~maxme` (and bulk advancestat) queue a long chain of "Congratulations..." pages
 * that otherwise block movement and swallow the next typed cheat.
 * @see tools/gatheringbot-test.ts
 */
export async function clearChatDialogs(page: Page, label = 'dialogs'): Promise<void> {
    type DialogAbi = {
        rs2b0t: {
            actions: {
                continueDialog(): boolean;
                ifButton(comId: number): boolean;
            };
            reader: {
                modals(): { chat: number };
                chatContinueComId(): number;
                chatOptions(): { comId: number }[];
            };
        };
    };
    const clicked = await page.evaluate(async () => {
        const g = globalThis as never as DialogAbi;
        const { actions, reader } = g.rs2b0t;
        let n = 0;
        let quiet = 0;
        for (let i = 0; i < 120; i++) {
            const chatOpen = reader.modals().chat !== -1;
            const canContinue = reader.chatContinueComId() !== -1;
            const opts = reader.chatOptions();
            if (!chatOpen && !canContinue && opts.length === 0) {
                quiet++;
                if (quiet >= 4) {
                    break;
                }
                await new Promise(r => setTimeout(r, 200));
                continue;
            }
            quiet = 0;
            if (canContinue) {
                if (actions.continueDialog()) {
                    n++;
                }
            } else if (opts.length > 0) {
                if (actions.ifButton(opts[0]!.comId)) {
                    n++;
                }
            }
            await new Promise(r => setTimeout(r, 250));
        }
        return n;
    });
    if (clicked > 0) {
        console.log(`  cleared ${clicked} ${label}`);
    }
}

/** `~maxme`, wait for combat skills to land, drain level-up chat (twice for stragglers). */
export async function maxmeAndClearDialogs(page: Page): Promise<void> {
    if (!(await cheatQuiet(page, '~maxme'))) {
        throw new Error('~maxme not sent (not ingame?)');
    }
    await page
        .waitForFunction(
            () => {
                const s = (globalThis as never as {
                    __rs2b0t: { Skills: { level(n: string): number } };
                }).__rs2b0t.Skills;
                return s.level('attack') >= 99 && s.level('hitpoints') >= 99;
            },
            undefined,
            { timeout: 45_000 }
        )
        .catch(() => undefined);
    await clearChatDialogs(page, 'level-up dialog(s)');
    await page.waitForTimeout(1500);
    await clearChatDialogs(page, 'straggler dialog(s)');
}

/** Engine `::tele level,mx,mz,lx,lz` from a world tile. */
export function teleCheat(tile: { x: number; z: number; level: number }): string {
    return `tele ${tile.level},${tile.x >> 6},${tile.z >> 6},${tile.x & 63},${tile.z & 63}`;
}

/**
 * Teleport and wait until within `radius` of the target world tile.
 * Returns false if the cheat never sent or arrival timed out.
 */
export async function teleTo(
    page: Page,
    tile: { x: number; z: number; level: number },
    radius = 8,
    timeoutMs = 20_000
): Promise<boolean> {
    if (!(await cheatQuiet(page, teleCheat(tile)))) {
        return false;
    }
    const ok = await page
        .waitForFunction(
            ([x, z, level, r]) => {
                const t = (globalThis as never as {
                    __rs2b0t: { Game: { tile(): { x: number; z: number; level: number } | null } };
                }).__rs2b0t.Game.tile();
                if (!t || t.level !== level) {
                    return false;
                }
                const dx = t.x - x;
                const dz = t.z - z;
                return dx * dx + dz * dz <= r * r;
            },
            [tile.x, tile.z, tile.level, radius] as const,
            { timeout: timeoutMs }
        )
        .then(() => true)
        .catch(() => false);
    return ok;
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

export type BankSeedItem = {
    /** Engine obj debug name (e.g. bronze_pickaxe). */
    debugName: string;
    /** Display name for Bank.count verification (e.g. Bronze pickaxe). */
    displayName: string;
    qty: number;
};

type SeedBankResult = { done: boolean; ok: boolean; reason: string; banked: Record<string, number> };

/**
 * Open a bank booth and read Bank.count for each expected item (no deposit).
 * Used to verify `givebank` / `~bankitem` seeds actually landed.
 */
async function verifyBankCounts(
    page: Page,
    bankStand: { x: number; z: number; level: number },
    expected: readonly { name: string; qty: number }[]
): Promise<SeedBankResult> {
    if (!(await teleTo(page, bankStand, 6, 25_000))) {
        return { done: true, ok: false, reason: `tele to bank (${bankStand.x},${bankStand.z}) failed`, banked: {} };
    }
    await page.waitForTimeout(500);

    const token = `HarnessVerifyBank_${Date.now()}`;
    await page.evaluate(
        ([stand, want, scriptName]) => {
            const g = globalThis as never as {
                __rs2b0t: {
                    LoopingBot: new () => object;
                    registerScript(meta: { name: string; create: () => unknown }): void;
                    Bank: {
                        isOpen(): boolean;
                        openBooth(t: unknown, name: string, op: string): Promise<boolean>;
                        openNearest(name: string, op: string): Promise<boolean>;
                        close(): Promise<boolean>;
                        count(name: string): number;
                    };
                    Execution: { delayUntil(c: () => boolean, ms: number): Promise<boolean>; delayTicks(n: number): Promise<void> };
                };
                rs2b0t: { runner: { start(meta: unknown): void }; registry: { get(name: string): unknown } };
                __seedBank?: SeedBankResult;
            };
            const abi = g.__rs2b0t;
            g.__seedBank = { done: false, ok: false, reason: '', banked: {} };

            class VerifyBankBot extends abi.LoopingBot {
                private ran = false;
                async loop(): Promise<number> {
                    if (this.ran) {
                        return 5000;
                    }
                    this.ran = true;
                    const res = g.__seedBank!;
                    try {
                        const { Bank, Execution } = abi;
                        const opened =
                            (await Bank.openBooth(stand, 'Bank booth', 'Use-quickly'))
                            || (await Bank.openNearest('Bank booth', 'Use-quickly'));
                        if (!opened) {
                            res.reason = 'could not open the bank';
                            res.done = true;
                            return 5000;
                        }
                        await Execution.delayUntil(() => Bank.isOpen(), 5000);
                        await Execution.delayTicks(1);
                        const missing: string[] = [];
                        for (const exp of want as { name: string; qty: number }[]) {
                            const n = Bank.count(exp.name);
                            res.banked[exp.name] = n;
                            if (n < exp.qty) {
                                missing.push(`${exp.name} (have ${n}, need ${exp.qty})`);
                            }
                        }
                        await Bank.close();
                        if (missing.length > 0) {
                            res.reason = `bank missing: ${missing.join('; ')}`;
                            res.ok = false;
                        } else {
                            res.ok = true;
                        }
                    } catch (e) {
                        res.reason = `threw: ${String(e)}`;
                    }
                    res.done = true;
                    return 5000;
                }
            }

            abi.registerScript({ name: scriptName, create: () => new VerifyBankBot() });
            g.rs2b0t.runner.start(g.rs2b0t.registry.get(scriptName));
        },
        [bankStand, expected, token] as const
    );

    await page
        .waitForFunction(() => (globalThis as never as { __seedBank?: SeedBankResult }).__seedBank?.done === true, undefined, {
            timeout: 60_000
        })
        .catch(() => undefined);

    try {
        await page.evaluate(() => {
            (globalThis as never as { rs2b0t: { runner: { stop(): void } } }).rs2b0t.runner.stop();
        });
    } catch {
        /* already stopped */
    }
    await page.waitForTimeout(400);

    return page.evaluate(() =>
        (globalThis as never as { __seedBank?: SeedBankResult }).__seedBank
        ?? { done: true, ok: false, reason: 'no result', banked: {} }
    );
}

/**
 * Seed items **directly into the bank** on a local engine.
 *
 * Prefer engine cheat `givebank <obj> <qty>` (ClientCheatHandler, no busy-guard).
 * Falls back to content debugproc `~bankitem <obj> <qty>` if givebank is absent.
 * Verifies once by opening a booth and reading Bank.count.
 *
 * Bulk fixtures also exist: `~bank_f2p` (no dialog), `~clearbank`, `~foodbank`.
 * Use those for blunt max kits — not for realistic low-level quest seeds.
 *
 * Seed after level-up dialogs are drained (`~bankitem` needs p_finduid).
 *
 * @see docs/TESTING.md#seeding-inventory-vs-bank
 */
async function applyBankSeedCmds(
    page: Page,
    items: readonly BankSeedItem[],
    mode: 'givebank' | 'bankitem'
): Promise<void> {
    for (const it of items) {
        const cmd = mode === 'givebank'
            ? `givebank ${it.debugName} ${it.qty}`
            : `~bankitem ${it.debugName} ${it.qty}`;
        let sent = false;
        for (let attempt = 0; attempt < 4; attempt++) {
            if (await cheatQuiet(page, cmd)) {
                sent = true;
                break;
            }
            await page.waitForTimeout(300);
        }
        if (!sent) {
            throw new Error(`seedItemsToBank: '${cmd}' not sent (not ingame / player busy?)`);
        }
        console.log(`  ${mode} ${it.debugName}:${it.qty}`);
    }
}

export async function seedItemsToBank(
    page: Page,
    items: readonly BankSeedItem[],
    bankStand: { x: number; z: number; level: number }
): Promise<void> {
    if (items.length === 0) {
        return;
    }

    const want = items.map(i => ({ name: i.displayName, qty: i.qty }));

    // Prefer engine givebank (no p_finduid busy-guard). cheatQuiet only proves the
    // packet left the client — verify with a booth open before trusting it.
    console.log('  trying givebank (engine)…');
    await applyBankSeedCmds(page, items, 'givebank');
    let res = await verifyBankCounts(page, bankStand, want);
    if (res.ok) {
        for (const [name, n] of Object.entries(res.banked)) {
            console.log(`  banked ${name} x${n}`);
        }
        return;
    }

    console.log(`  givebank verify failed (${res.reason}) — trying ~bankitem`);
    await applyBankSeedCmds(page, items, 'bankitem');
    res = await verifyBankCounts(page, bankStand, want);
    if (!res.ok) {
        throw new Error(
            `seedItemsToBank: ${res.reason || 'bank verify failed'} `
            + '(need local engine givebank and/or content ~bankitem)'
        );
    }
    for (const [name, n] of Object.entries(res.banked)) {
        console.log(`  banked ${name} x${n}`);
    }
}
