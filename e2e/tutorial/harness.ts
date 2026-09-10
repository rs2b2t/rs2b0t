import type { Page } from 'playwright-core';

import { ClientProt } from '../../src/client/io/ClientProt.js';
import { MiniMenuAction } from '../../src/client/shell/MiniMenuAction.js';

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
            loginMes1?: string;
            loginMes2?: string;
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
/** Minimum wait after logout before the first login probe; override with RELOG_COOLDOWN_MS when a local engine needs a longer hold.
 *  Why: a clean IF_BUTTON logout (com 2458 / `logout:try_logout` → `p_logout`) ends the session promptly so probes succeed in a few seconds, where an unclean `client.logout()` or socket drop leaves login response 5 ("try again in 60 secs") standing for much longer. */
const RELOG_COOLDOWN_MS = Number(process.env.RELOG_COOLDOWN_MS) || 2_000;
/** How long each login probe waits for ingame+scene before retrying. */
const RELOG_PROBE_MS = Number(process.env.RELOG_PROBE_MS) || 4_000;
/** Gap between failed probes (engine still holding the old session). */
const RELOG_RETRY_MS = Number(process.env.RELOG_RETRY_MS) || 2_000;
const RELOG_BUDGET_MS = Number(process.env.RELOG_BUDGET_MS) || 90_000;

/** Logout via the logout UI button (if_button 2458 → ClientProt.IF_BUTTON).
 *  Falls back to client.logout() when the button packet cannot be sent. Why: 2458 is the same component id as LOGOUT_BUTTON_COM in e2e/lib/harness.ts, so the two logout paths have to move together. */
async function cleanLogout(page: Page): Promise<'ifbutton' | 'client'> {
    // logout:try_logout, tab-rooted; engine accepts without the logout tab open.
    const LOGOUT_BUTTON = 2458;
    const via = await page.evaluate(com => {
        const g = globalThis as never as {
            rs2b0t?: {
                actions?: { ifButton?(c: number): boolean };
                client?: { logout?(): Promise<void> };
            };
        };
        if (g.rs2b0t?.actions?.ifButton?.(com)) {
            return 'ifbutton' as const;
        }
        void g.rs2b0t?.client?.logout?.();
        return 'client' as const;
    }, LOGOUT_BUTTON);
    await page.waitForFunction(() => !(globalThis as never as Rs2b0t).rs2b0t.client.ingame, undefined, {
        timeout: 20_000
    });
    return via;
}

async function waitClientBooted(page: Page, label: string): Promise<void> {
    // loopCycle only advances once title-screen assets are loaded and the game
    // loop is running, longer than jag download alone on a cold profile.
    try {
        await page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: BOOT_MS });
    } catch {
        throw new Error(`${label}: client never reached title loop within ${Math.round(BOOT_MS / 1000)}s ` + '(still downloading cache/assets? set BOOT_MS=…)');
    }
}

async function waitIngame(page: Page, timeoutMs: number, label: string): Promise<void> {
    try {
        const handle = await page.waitForFunction(
            () => {
                const { client } = (globalThis as never as Rs2b0t).rs2b0t;
                const mes = `${client.loginMes1 ?? ''} ${client.loginMes2 ?? ''}`;
                if (/has been updated/i.test(mes)) {
                    return mes.trim();
                }
                return client.ingame && client.sceneState === 2 ? 'ingame' : false;
            },
            undefined,
            { timeout: timeoutMs }
        );
        const value = await handle.jsonValue();
        if (value !== 'ingame') {
            throw new Error(`${label}: login rejected (${value}). Bake ENGINE_DIR private.pem as LOCAL_RSAE/LOCAL_RSAN; do not raise LOGIN_MS`);
        }
    } catch (err) {
        if (err instanceof Error && err.message.includes('login rejected')) {
            throw err;
        }
        throw new Error(`${label}: not ingame/scene-ready within ${Math.round(timeoutMs / 1000)}s ` + '(map download lag or login rejected — set LOGIN_MS=…)');
    }
}

// Why: `clientPage` is how a run opts into its own copy of the client (`deployIsolatedClient`); the default keeps every harness that has not on the shared one.
export async function bootAndLogin(page: Page, base: string, user: string, clientPage = '/bot.html'): Promise<void> {
    console.log(`  boot: loading ${base}${clientPage} (cache download may take a while; BOOT_MS=${Math.round(BOOT_MS / 1000)}s)`);
    await page.goto(`${base}${clientPage}?nodeid=10`);
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
        `  relog: clean logout → probe from ${Math.round(RELOG_COOLDOWN_MS / 1000)}s ` +
            `(${Math.round(RELOG_PROBE_MS / 1000)}s probes / ${Math.round(RELOG_RETRY_MS / 1000)}s gap; ` +
            'RELOG_COOLDOWN_MS / RELOG_PROBE_MS / RELOG_RETRY_MS / RELOG_BUDGET_MS override)'
    );
    const how = await cleanLogout(page);
    console.log(`  relog: logged out via ${how === 'ifbutton' ? 'IF_BUTTON 2458 (ClientProt.IF_BUTTON=9)' : 'client.logout() fallback'}`);

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
    // oversleep either, probe early with short timeouts until one sticks.
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
            throw new Error(`relog: could not log back in as '${user}' after ${attempt} attempts / ` + `${Math.round(RELOG_BUDGET_MS / 1000)}s (engine dead-connection or client still loading)`);
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

export async function cheatQuiet(page: Page, command: string, waitMs = 700): Promise<boolean> {
    const sent = await page.evaluate(
        ([c, op]) => {
            const { client } = (globalThis as never as Rs2b0t).rs2b0t;
            if (!client.ingame) {
                return false;
            }
            client.out.p1Enc(op);
            client.out.p1(c.length + 1);
            client.out.pjstr(c);
            return true;
        },
        [command, ClientProt.CLIENT_CHEAT] as const
    );
    await page.waitForTimeout(waitMs);
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
    const sent = await page.evaluate(
        ([n, op]) => {
            const { client } = (globalThis as never as Rs2b0t).rs2b0t;
            if (!client.ingame) {
                return false;
            }
            const cmd = `getvar ${n}`;
            client.out.p1Enc(op);
            client.out.p1(cmd.length + 1);
            client.out.pjstr(cmd);
            return true;
        },
        [name, ClientProt.CLIENT_CHEAT] as const
    );
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

// Lumbridge courtyard, same hop other live harnesses use (not a tutorial stage walk).
const OFF_ISLAND_TELE = '0,50,50,20,20';

/** New account → off Tutorial Island without playing it: boot and login, tele off-island and setvar tutorial 1000, clean IF_BUTTON logout (com 2458), then login again so the side icons and tutorial UI lock refresh from the login payload.
 *  Why: CLIENT_CHEAT packets are used rather than keyboard `::…` typing, since the island chat/tutorial UI eats keystrokes and stalls for a long time before a setvar sticks; the clean logout avoids the unclean-disconnect 60s "already logged in" hold, so with RELOG_COOLDOWN_MS≈2s the hop runs ~9s after boot. */
export async function mainlandAccount(page: Page, base: string, user: string, clientPage = '/bot.html'): Promise<void> {
    const t0 = Date.now();
    console.log(`mainlandAccount: boot+login as '${user}'`);
    await bootAndLogin(page, base, user, clientPage);

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
    // Use clean IF_BUTTON logout (not socket drop), see relog / cleanLogout.
    await relog(page, user);

    const unlocked = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.client.sideIcon[3] ?? -1) !== -1);
    if (!unlocked) {
        throw new Error('mainlandAccount: sidebar still tutorial-locked after tele + setvar tutorial=1000 + relog');
    }
    console.log(`mainlandAccount: tabs unlocked (${Math.round((Date.now() - t0) / 1000)}s since start)`);
}

export async function startScript(page: Page, name: string): Promise<void> {
    await page.evaluate(n => {
        const { runner, registry } = (globalThis as never as Rs2b0t).rs2b0t;
        runner.start(registry.get(n));
    }, name);
}

/** Click through level-up / chat continues until the chat modal stays closed.
 *  Why: `~maxme` and bulk advancestat queue a long chain of "Congratulations…" pages that block movement and swallow the next typed cheat. */
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

/** Close a leftover main modal.
 *  Why: `clearChatDialogs` drains the chat slot only and `~maxme` can leave a scroll in the main one; a script starting behind it has every talk refused with no message, so the run reads as a broken `decide()`. */
export async function clearMainModal(page: Page): Promise<void> {
    type MainAbi = {
        rs2b0t: {
            actions: { closeModal(): boolean };
            reader: { modals(): { main: number } };
        };
    };
    const closed = await page.evaluate(() => {
        const g = globalThis as never as MainAbi;
        if (g.rs2b0t.reader.modals().main === -1) {
            return -1;
        }
        g.rs2b0t.actions.closeModal();
        return g.rs2b0t.reader.modals().main;
    });
    if (closed !== -1) {
        console.log('  closed a leftover main modal');
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
                const s = (
                    globalThis as never as {
                        __rs2b0t: { Skills: { level(n: string): number } };
                    }
                ).__rs2b0t.Skills;
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
export async function teleTo(page: Page, tile: { x: number; z: number; level: number }, radius = 8, timeoutMs = 20_000): Promise<boolean> {
    if (!(await cheatQuiet(page, teleCheat(tile)))) {
        return false;
    }
    const ok = await page
        .waitForFunction(
            ([x, z, level, r]) => {
                const t = (
                    globalThis as never as {
                        __rs2b0t: { Game: { tile(): { x: number; z: number; level: number } | null } };
                    }
                ).__rs2b0t.Game.tile();
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
    /** Display name for locating item metadata (e.g. Bronze pickaxe). */
    displayName: string;
    qty: number;
};

type SeedBankResult = { done: boolean; ok: boolean; reason: string; banked: Record<string, number> };

/** Seed the bank with noted items (or ordinary stackables) and verify each deposit.
 *  Why: notes fit bulk fixtures in one pack slot; Deposit-X preserves any matching items already held. */
export async function seedItemsToBank(page: Page, items: readonly BankSeedItem[], bankStand: { x: number; z: number; level: number }): Promise<void> {
    if (items.length === 0) {
        return;
    }
    for (const item of items) {
        if (!Number.isSafeInteger(item.qty) || item.qty <= 0) {
            throw new Error(`seedItemsToBank: invalid quantity for ${item.debugName}: ${item.qty}`);
        }
    }
    if (!(await teleTo(page, bankStand, 6, 25_000))) {
        throw new Error(`seedItemsToBank: tele to bank (${bankStand.x},${bankStand.z}) failed`);
    }
    await page.waitForTimeout(500);

    const token = `HarnessSeedBank_${Date.now()}`;
    await page.evaluate(
        ([stand, seeds, scriptName, cheatOp, depositActions]) => {
            type Item = { id: number; slot: number; comId: number; count: number; ops: (string | null)[] };
            const g = globalThis as never as {
                __rs2b0t: {
                    LoopingBot: new () => object;
                    registerScript(meta: { name: string; create: () => unknown }): void;
                    Bank: {
                        openBooth(t: unknown, name: string, op: string): Promise<boolean>;
                        openNearest(name: string, op: string): Promise<boolean>;
                        waitReady(): Promise<boolean>;
                        close(): Promise<boolean>;
                        countById(id: number): number;
                    };
                    Execution: { delayUntil(c: () => boolean, ms: number): Promise<boolean>; delayTicks(n: number): Promise<void> };
                };
                rs2b0t: {
                    client: { ingame: boolean; out: { p1Enc(op: number): void; p1(n: number): void; pjstr(s: string): void } };
                    reader: {
                        bankSideItems(): Item[];
                        countDialogOpen(): boolean;
                        objCatalog(): { id: number; name: string; stackable: boolean; certlink: number; certtemplate: number; stackVariant?: boolean }[];
                    };
                    actions: { menuAction(action: number, id: number, slot: number, comId: number): boolean; answerCountDialog(n: number): boolean };
                    runner: { start(meta: unknown): void };
                    registry: { get(name: string): unknown };
                };
                __seedBank: SeedBankResult;
            };
            const { Bank, Execution } = g.__rs2b0t;
            const { client, reader, actions } = g.rs2b0t;
            g.__seedBank = { done: false, ok: false, reason: '', banked: {} };
            const held = (id: number) => reader.bankSideItems().filter(i => i.id === id).reduce((sum, i) => sum + i.count, 0);

            class SeedBankBot extends g.__rs2b0t.LoopingBot {
                private ran = false;
                async loop(): Promise<number> {
                    if (this.ran) {
                        return 5000;
                    }
                    this.ran = true;
                    const res = g.__seedBank;
                    try {
                        const opened = (await Bank.openBooth(stand, 'Bank booth', 'Use-quickly')) || (await Bank.openNearest('Bank booth', 'Use-quickly'));
                        if (!opened || !(await Bank.waitReady())) {
                            throw new Error('could not open a ready bank');
                        }
                        await Execution.delayTicks(1);
                        const catalog = reader.objCatalog();
                        for (const seed of seeds) {
                            const definitions = catalog.filter(o => o.name.toLowerCase() === seed.displayName.toLowerCase() && o.certtemplate === -1 && !o.stackVariant);
                            if (definitions.length === 0) {
                                throw new Error(`unknown item: ${seed.displayName}`);
                            }
                            const stackable = definitions.every(o => o.stackable);
                            const noted = !stackable && definitions.some(o => catalog.some(note => note.certtemplate !== -1 && note.certlink === o.id));
                            if (!stackable && !noted && seed.qty > 28 - reader.bankSideItems().length) {
                                throw new Error(`${seed.debugName} has no note and does not fit in the pack`);
                            }
                            const before = new Map(reader.bankSideItems().map(i => [i.id, held(i.id)]));
                            if (!client.ingame) {
                                throw new Error('logged out during bank seed');
                            }
                            const cmd = `give ${noted ? 'cert_' : ''}${seed.debugName} ${seed.qty}`;
                            client.out.p1Enc(cheatOp);
                            client.out.p1(cmd.length + 1);
                            client.out.pjstr(cmd);
                            const addedItem = () => reader.bankSideItems().find(i => held(i.id) > (before.get(i.id) ?? 0));
                            if (!(await Execution.delayUntil(() => addedItem() !== undefined, 5000))) {
                                throw new Error(`${cmd}: inventory did not increase (unknown item, unavailable cheat or full pack)`);
                            }
                            const item = addedItem()!;
                            const kept = before.get(item.id) ?? 0;
                            const added = held(item.id) - kept;
                            if (added !== seed.qty) {
                                throw new Error(`${cmd}: received ${added}, expected ${seed.qty}`);
                            }
                            const definition = catalog.find(o => o.id === item.id);
                            if (!definition) {
                                throw new Error(`unknown received item id: ${item.id}`);
                            }
                            const bankId = definition.certtemplate === -1 ? item.id : definition.certlink;
                            if (!definitions.some(o => o.id === bankId)) {
                                throw new Error(`${cmd}: received an unexpected item (${item.id})`);
                            }
                            const bankBefore = Bank.countById(bankId);
                            const opName = kept === 0 ? /^deposit[ -]all$/i : /^deposit[ -]x$/i;
                            const op = item.ops.findIndex(o => o !== null && opName.test(o));
                            if (op < 0 || !actions.menuAction(depositActions[op], item.id, item.slot, item.comId)) {
                                throw new Error(`could not deposit ${seed.debugName}`);
                            }
                            if (kept > 0) {
                                if (!(await Execution.delayUntil(() => reader.countDialogOpen(), 3000)) || !actions.answerCountDialog(added)) {
                                    throw new Error(`could not enter deposit count for ${seed.debugName}`);
                                }
                            }
                            if (!(await Execution.delayUntil(() => held(item.id) === kept && Bank.countById(bankId) === bankBefore + added, 5000))) {
                                throw new Error(`deposit not verified for ${seed.debugName} x${added}`);
                            }
                            res.banked[seed.debugName] = Bank.countById(bankId);
                        }
                        res.ok = true;
                    } catch (e) {
                        res.reason = String(e);
                    } finally {
                        try {
                            await Bank.close();
                        } catch (e) {
                            res.ok = false;
                            res.reason = `bank close failed: ${String(e)}`;
                        }
                        res.done = true;
                    }
                    return 5000;
                }
            }
            g.__rs2b0t.registerScript({ name: scriptName, create: () => new SeedBankBot() });
            g.rs2b0t.runner.start(g.rs2b0t.registry.get(scriptName));
        },
        [bankStand, items, token, ClientProt.CLIENT_CHEAT, [MiniMenuAction.INV_BUTTON1, MiniMenuAction.INV_BUTTON2, MiniMenuAction.INV_BUTTON3, MiniMenuAction.INV_BUTTON4, MiniMenuAction.INV_BUTTON5]] as const
    );

    try {
        await page.waitForFunction(() => (globalThis as never as { __seedBank: SeedBankResult }).__seedBank.done, undefined, {
            timeout: 60_000 + items.length * 15_000
        });
    } finally {
        await page.evaluate(() => {
            (globalThis as never as { rs2b0t: { runner: { stop(reason: string): void } } }).rs2b0t.runner.stop('harness stop');
        });
    }
    const res = await page.evaluate(() => (globalThis as never as { __seedBank: SeedBankResult }).__seedBank);
    if (!res.done || !res.ok) {
        throw new Error(`seedItemsToBank: ${res.reason || 'bank seed did not finish'}`);
    }
    for (const [name, n] of Object.entries(res.banked)) {
        console.log(`  banked ${name} x${n}`);
    }
}
