/** Live verification for GatheringBot (Miner / Fisher / Woodcutter): scenario ids as argv, BASE / HEADED / SLOWMO / BUDGET_S from the environment.
 *  Why: inventory seeds go through the engine cheat `give` and bank seeds through `givebank`; acquire scenarios purge bank tools first so a leftover withdrawal cannot false-PASS, and the bot client is redeployed by hand — tools/deploy-local.sh from this tree is not for live e2e. */

// Usage:
//   bun e2e/gatheringbot-test.ts
//   bun e2e/gatheringbot-test.ts mining fishing
//   bun e2e/gatheringbot-test.ts acquire
//   bun e2e/gatheringbot-test.ts endgame
//   bun e2e/gatheringbot-test.ts mine-bank fish-path-shark
//   BASE=http://localhost:8888 bun e2e/gatheringbot-test.ts
//   HEADED=1 SLOWMO=200 bun e2e/gatheringbot-test.ts mine-bank
//   BUDGET_S=180 bun e2e/gatheringbot-test.ts   # per-scenario seconds (default 150)
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import {
    cheatQuiet,
    mainlandAccount,
    seedItemsToBank,
    startScript,
    type BankSeedItem
} from './tutorial/harness.js';

const { base, rest } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8890' });
const filters = rest.map(s => s.toLowerCase());
const PER_SCENARIO_MS = (Number(process.env.BUDGET_S) || 150) * 1000;
const USER = process.env.USER_NAME || `gb${Date.now().toString(36).slice(-7)}`;

function failHard(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

// ── ABI ──────────────────────────────────────────────────────────────────────

type Tile = { x: number; z: number; level: number };

type Snap = {
    tile: Tile | null;
    runner: string;
    xp: Record<string, number>;
    level: Record<string, number>;
    inv: { name: string; count: number }[];
    worn: string[];
    used: number;
    free: number;
    logs: { time: number; level: string; msg: string }[];
};

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        Skills: { xp(n: string): number; level(n: string): number };
        Inventory: {
            count(n: string): number;
            items(): { name: string | null; count: number }[];
            used(): number;
            free(): number;
        };
        Equipment: {
            contains(n: string): boolean;
            items(): { name: string | null }[];
            unequip(n: string): Promise<boolean>;
        };
        Bank: {
            isOpen(): boolean;
            loaded(): boolean;
            items(): { name: string | null; count: number; ops: (string | null)[] }[];
            count(n: string): number;
            openBooth(stand: Tile, boothName: string, op: string, log?: (m: string) => void): Promise<boolean>;
            openNearest(boothName: string, op: string, log?: (m: string) => void): Promise<boolean>;
            withdraw(name: string, op?: string): boolean | Promise<boolean>;
            depositAllMatching(match: (name: string, id: number) => boolean, log?: (m: string) => void): Promise<void>;
            close(timeoutMs?: number): Promise<boolean>;
        };
        Traversal: {
            walkResilient(
                dest: Tile,
                opts?: { radius?: number; timeoutMs?: number; log?: (m: string) => void }
            ): Promise<boolean>;
        };
        Execution: {
            delay(ms: number): Promise<void>;
            delayTicks(n: number): Promise<void>;
            delayUntil(cond: () => boolean, timeoutMs?: number): Promise<boolean>;
        };
        LoopingBot: new () => { loop(): Promise<number | void> };
        registerScript(m: { name: string; create(): unknown }): void;
    };
    rs2b0t: {
        runner: {
            state: string;
            ctx?: { log?: { time: number; level: string; msg: string }[] } | null;
            start(meta: unknown): void;
            stop(reason: string): void;
        };
        registry: { get(name: string): unknown };
        reader: {
            worldTile(): Tile | null;
            modals(): { main: number; side: number; chat: number };
            chatContinueComId(): number;
            chatOptions(): { text: string; comId: number }[];
        };
        actions: {
            continueDialog(): boolean;
            ifButton(comId: number): boolean;
            closeModal(): boolean;
        };
    };
    /** One-shot probe result for harness helpers that spin a temporary script. */
    __gbProbe?: {
        done: boolean;
        ok: boolean;
        reason: string;
        withdrew: number;
        unequipped?: number;
    };
};

// ── helpers ──────────────────────────────────────────────────────────────────

function teleCheat(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

function chebyshev(a: Tile, b: Tile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/** Offset a camp tile so the bot must path a short distance before gathering. */
function offsetTile(t: Tile, dx: number, dz: number): Tile {
    return { x: t.x + dx, z: t.z + dz, level: t.level };
}

async function snap(page: Page): Promise<Snap> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const skills = ['mining', 'fishing', 'woodcutting', 'cooking', 'firemaking', 'smithing'];
        const xp: Record<string, number> = {};
        const level: Record<string, number> = {};
        for (const s of skills) {
            xp[s] = g.__rs2b0t.Skills.xp(s);
            level[s] = g.__rs2b0t.Skills.level(s);
        }
        const inv = g.__rs2b0t.Inventory.items()
            .filter(i => i.name)
            .map(i => ({ name: i.name!, count: i.count }));
        const worn = g.__rs2b0t.Equipment.items()
            .map(i => i.name)
            .filter((n): n is string => !!n);
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            tile: g.__rs2b0t.reader.worldTile(),
            runner: g.rs2b0t.runner.state,
            xp,
            level,
            inv,
            worn,
            used: g.__rs2b0t.Inventory.used(),
            free: g.__rs2b0t.Inventory.free(),
            logs: ring.slice(-120).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    });
}

function invCount(s: Snap, name: string): number {
    const wanted = name.toLowerCase();
    return s.inv.filter(i => i.name.toLowerCase() === wanted).reduce((n, i) => n + i.count, 0);
}

function invMatch(s: Snap, re: RegExp): number {
    return s.inv.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
}

function hasTool(s: Snap, name: string): boolean {
    const wanted = name.toLowerCase();
    if (s.worn.some(w => w.toLowerCase() === wanted)) {
        return true;
    }
    return invCount(s, name) > 0;
}

function hasAnyPick(s: Snap): boolean {
    return s.worn.some(w => /pickaxe/i.test(w)) || s.inv.some(i => /pickaxe/i.test(i.name));
}

function hasAnyAxe(s: Snap): boolean {
    return s.worn.some(w => /\baxe\b/i.test(w) && !/pickaxe/i.test(w))
        || s.inv.some(i => /\baxe\b/i.test(i.name) && !/pickaxe/i.test(i.name));
}

function logHas(s: Snap, re: RegExp): boolean {
    return s.logs.some(l => re.test(l.msg));
}

async function stopScript(page: Page): Promise<void> {
    await page.evaluate(() => {
        try {
            (globalThis as never as Abi).rs2b0t.runner.stop('harness stop');
        } catch {
            /* ignore */
        }
    });
    await page.waitForTimeout(400);
}

/**
 * Persist scenario settings for a script. Always clears mule keys first so a prior
 * mule scenario cannot leak Gatherer/Mule into bank/path tests via sessionStorage.
 */
async function setSettings(page: Page, script: string, map: Record<string, string | number | boolean>): Promise<void> {
    // Defaults for optional keys every Miner/Fisher/Woodcutter run should reset.
    const withDefaults: Record<string, string | number | boolean> = {
        muleMode: 'Off',
        mulePartner: '',
        ...map
    };
    await page.evaluate(([name, entries]) => {
        for (const [k, v] of Object.entries(entries)) {
            sessionStorage.setItem(`rs2b0t:set:${name}:${k}`, String(v));
            try {
                localStorage.setItem(`rs2b0t:set:${name}:${k}`, String(v));
            } catch {
                /* private mode */
            }
        }
    }, [script, withDefaults] as const);
}

/** Seed held items via the engine cheat `give` (ClientCheatHandler).
 *  Why: Local Server engines carry no `~item`/`~bankitem`, and `~item` no-ops silently while `~clearinv` still works — which reads as an endless inventory wipe. */
async function seedItem(page: Page, debugName: string, displayName: string, qty = 1): Promise<void> {
    const cmd = `give ${debugName} ${qty}`;
    for (let i = 0; i < 8; i++) {
        const sent = await cheatQuiet(page, cmd);
        if (!sent) {
            throw new Error(`give not sent (not ingame?) for ${displayName}`);
        }
        // Engine applies invAdd on the next tick; allow a couple polls.
        for (let poll = 0; poll < 4; poll++) {
            const n = await page.evaluate(name => (globalThis as never as Abi).__rs2b0t.Inventory.count(name), displayName);
            if (n >= qty) {
                return;
            }
            await page.waitForTimeout(250);
        }
    }
    const inv = await page.evaluate(() =>
        (globalThis as never as Abi).__rs2b0t.Inventory.items()
            .filter(i => i.name)
            .map(i => `${i.count}x ${i.name}`)
            .join(', ')
    );
    throw new Error(`could not seed ${displayName} via '${cmd}' (inv=${inv || 'empty'})`);
}

async function skillLevel(page: Page, skill: string): Promise<number> {
    return page.evaluate(s => (globalThis as never as Abi).__rs2b0t.Skills.level(s), skill);
}

/** Advance only when below target — never re-flood skills already granted. */
async function advanceStat(page: Page, skill: string, level: number): Promise<boolean> {
    if (level <= 1) {
        return false;
    }
    const before = await skillLevel(page, skill);
    if (before >= level) {
        return false;
    }
    for (let i = 0; i < 4; i++) {
        const sent = await cheatQuiet(page, `advancestat ${skill} ${level}`);
        if (!sent) {
            throw new Error(`advancestat not sent (not ingame?) for ${skill}`);
        }
        const have = await skillLevel(page, skill);
        if (have >= level) {
            return true;
        }
        await page.waitForTimeout(500);
    }
    const have = await skillLevel(page, skill);
    if (have < level) {
        throw new Error(`advancestat ${skill} ${level} stuck at ${have}`);
    }
    return true;
}

/** Grant skills that are still below target; skip (and don't log) already-met levels. */
async function grantStats(page: Page, stats: { skill: string; level: number }[]): Promise<void> {
    let raised = 0;
    for (const st of stats) {
        const changed = await advanceStat(page, st.skill, st.level);
        if (changed) {
            console.log(`  ${st.skill} → ${st.level}`);
            raised++;
        }
    }
    if (raised > 0) {
        await page.waitForTimeout(800);
    }
}

/** One-shot after mainland login: max everything so early-zone mobs stop shredding the bot and the gather/acquire floors are free.
 *  Why: ~maxme floods level-up chat, so clearChatDialogs must run before any seed or start. */
const BASE_STATS: { skill: string; level: number }[] = [
    { skill: 'attack', level: 99 },
    { skill: 'strength', level: 99 },
    { skill: 'defence', level: 99 },
    { skill: 'hitpoints', level: 99 },
    { skill: 'mining', level: 99 },
    { skill: 'woodcutting', level: 99 },
    { skill: 'fishing', level: 99 },
    { skill: 'cooking', level: 99 },
    { skill: 'firemaking', level: 99 },
    { skill: 'smithing', level: 99 }
];

/** Click through level-up / chat continues until the chat modal stays closed.
 *  Why: ~maxme and bulk advancestat queue a long chain of "Congratulations…" pages that block movement and leave the bot standing in danger. */
async function clearChatDialogs(page: Page, label = 'dialogs'): Promise<void> {
    const clicked = await page.evaluate(async () => {
        const g = globalThis as never as Abi;
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
                // Level-up chains are continues; if an option list appears, pick first.
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

/** Max combat + gather skills, then drain every level-up chat page. */
async function maxAccountAndClearDialogs(page: Page): Promise<void> {
    // Prefer ~maxme (one cheat, all skills). Fall back to per-skill advancestat.
    const sent = await cheatQuiet(page, '~maxme');
    if (sent) {
        await page
            .waitForFunction(
                () => {
                    const s = (globalThis as never as Abi).__rs2b0t.Skills;
                    return s.level('attack') >= 99 && s.level('hitpoints') >= 99 && s.level('mining') >= 99;
                },
                undefined,
                { timeout: 45_000 }
            )
            .catch(() => undefined);
    }
    // Ensure the skills this suite cares about are 99 even if maxme was partial.
    await grantStats(page, BASE_STATS);
    // Level-ups keep arriving for a few seconds after the last advance — keep
    // clicking until the chat stays quiet, then one more pass for stragglers.
    await clearChatDialogs(page, 'level-up dialog(s)');
    await page.waitForTimeout(1500);
    await clearChatDialogs(page, 'straggler dialog(s)');
    const levels = await page.evaluate(() => {
        const s = (globalThis as never as Abi).__rs2b0t.Skills;
        return {
            atk: s.level('attack'),
            str: s.level('strength'),
            def: s.level('defence'),
            hp: s.level('hitpoints'),
            mine: s.level('mining'),
            fish: s.level('fishing'),
            wc: s.level('woodcutting')
        };
    });
    console.log(
        `  stats atk/str/def/hp=${levels.atk}/${levels.str}/${levels.def}/${levels.hp} ` +
            `m/f/w=${levels.mine}/${levels.fish}/${levels.wc}`
    );
}

/** Unequip worn gear into the pack, then ~clearinv.
 *  Why: clearinv alone leaves the weapon slot, so the next scenario's seed stacks a second pick/axe on the equipped one; Equipment.unequip needs an active script context, hence the one-shot LoopingBot. */
async function unequipAllWorn(page: Page): Promise<number> {
    const wornBefore = await page.evaluate(() => {
        const eq = (globalThis as never as Abi).__rs2b0t.Equipment;
        return eq
            .items()
            .map(i => i.name)
            .filter((n): n is string => !!n);
    });
    if (wornBefore.length === 0) {
        return 0;
    }

    await stopScript(page);
    await page.evaluate(scriptName => {
        const g = globalThis as never as Abi;
        const abi = g.__rs2b0t;
        g.__gbProbe = { done: false, ok: false, reason: '', withdrew: 0, unequipped: 0 };

        class UnequipBot extends abi.LoopingBot {
            private ran = false;
            override async loop(): Promise<number> {
                if (this.ran) {
                    return 5000;
                }
                this.ran = true;
                const res = g.__gbProbe!;
                try {
                    let n = 0;
                    // Re-read each pass — slots shift as items leave.
                    for (let guard = 0; guard < 12; guard++) {
                        const names = abi.Equipment.items()
                            .map(i => i.name)
                            .filter((name): name is string => !!name);
                        if (names.length === 0) {
                            break;
                        }
                        const name = names[0]!;
                        const ok = await abi.Equipment.unequip(name);
                        if (!ok) {
                            res.ok = false;
                            res.reason = `could not unequip ${name}`;
                            res.unequipped = n;
                            res.done = true;
                            return 5000;
                        }
                        n++;
                        await abi.Execution.delayTicks(1);
                    }
                    res.ok = true;
                    res.reason = '';
                    res.unequipped = n;
                } catch (e) {
                    res.ok = false;
                    res.reason = e instanceof Error ? e.message : String(e);
                }
                res.done = true;
                return 5000;
            }
        }

        abi.registerScript({ name: scriptName, create: () => new UnequipBot() });
        g.rs2b0t.runner.start(g.rs2b0t.registry.get(scriptName));
    }, `GbUnequip_${Date.now().toString(36)}`);

    await page
        .waitForFunction(() => (globalThis as never as Abi).__gbProbe?.done === true, undefined, {
            timeout: 20_000
        })
        .catch(() => undefined);

    const result = await page.evaluate(() => {
        const p = (globalThis as never as Abi).__gbProbe;
        return p ?? { done: true, ok: false, reason: 'no probe result', withdrew: 0, unequipped: 0 };
    });
    await stopScript(page);

    if (!result.ok) {
        console.log(`  warn: unequip soft-fail (${result.reason})`);
    } else if ((result.unequipped ?? 0) > 0) {
        console.log(`  unequipped ${result.unequipped} worn item(s)`);
    }
    return result.unequipped ?? 0;
}

async function clearInv(page: Page): Promise<void> {
    await unequipAllWorn(page);

    // debugproc clearinv — works on inv without p_finduid; still wait a tick.
    const sent = await cheatQuiet(page, '~clearinv');
    if (!sent) {
        throw new Error('~clearinv not sent (not ingame?)');
    }
    await page.waitForTimeout(700);
    // Confirm pack empty and nothing still worn (tools would leak into next seed).
    for (let i = 0; i < 6; i++) {
        const state = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            return {
                used: g.__rs2b0t.Inventory.used(),
                worn: g.__rs2b0t.Equipment.items()
                    .map(it => it.name)
                    .filter((n): n is string => !!n)
            };
        });
        if (state.used === 0 && state.worn.length === 0) {
            return;
        }
        if (state.worn.length > 0) {
            await unequipAllWorn(page);
        }
        await cheatQuiet(page, '~clearinv');
        await page.waitForTimeout(400);
    }
}

async function teleArrive(page: Page, spot: Tile, maxDist = 18): Promise<boolean> {
    const cmd = teleCheat(spot);
    for (let attempt = 0; attempt < 4; attempt++) {
        // tutorial/harness cheatQuiet ignores a 3rd arg — fixed ~700ms settle per send.
        await cheatQuiet(page, cmd);
        for (let poll = 0; poll < 12; poll++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && t.level === spot.level && chebyshev(t, spot) <= maxDist) {
                // Zone rebuild lags the tile update (docs/decisions/level-change-lag.md).
                // Blank Locs/Npcs here is "not loaded yet", not "camp empty".
                await page.waitForTimeout(600);
                return true;
            }
            await page.waitForTimeout(350);
        }
    }
    return false;
}

type SceneExpect = 'rocks' | 'trees' | 'fish' | 'any-loc' | 'shop' | 'bank' | 'skip';

/** Poll until the expected resource class is visible near the player.
 *  Why: after ::tele the player tile updates before scenery and NPCs rebuild, so starting GatheringBot in that window pins the leash to the camp with zero targets in scene ("no rocks in leash"). */
async function waitSceneReady(
    page: Page,
    expect: SceneExpect,
    opts: { radius?: number; timeoutMs?: number; label?: string } = {}
): Promise<void> {
    if (expect === 'skip') {
        await page.waitForTimeout(500);
        return;
    }
    const radius = opts.radius ?? 14;
    const timeoutMs = opts.timeoutMs ?? 12000;
    const label = opts.label ?? expect;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const hit = await page.evaluate(
            ([kind, r]) => {
                const g = globalThis as never as Abi & {
                    __rs2b0t: {
                        Locs: {
                            query(): {
                                results(): {
                                    name: string | null;
                                    distance(): number;
                                    actions(): string[];
                                }[];
                            };
                        };
                        Npcs: {
                            query(): {
                                results(): {
                                    name: string | null;
                                    distance(): number;
                                }[];
                            };
                        };
                    };
                    rs2b0t: { client: { sceneState: number; ingame: boolean } };
                };
                if (!g.rs2b0t?.client?.ingame || g.rs2b0t.client.sceneState !== 2) {
                    return false;
                }
                const locs = g.__rs2b0t.Locs.query()
                    .results()
                    .filter(l => l.distance() <= r);
                const npcs = g.__rs2b0t.Npcs.query()
                    .results()
                    .filter(n => n.distance() <= r);
                if (kind === 'rocks') {
                    return locs.some(
                        l => /rock/i.test(l.name ?? '') && l.actions().some(a => /mine/i.test(a ?? ''))
                    );
                }
                if (kind === 'trees') {
                    return locs.some(
                        l =>
                            /tree|oak|willow|maple|yew|magic/i.test(l.name ?? '')
                            && l.actions().some(a => /chop/i.test(a ?? ''))
                    );
                }
                if (kind === 'fish') {
                    return npcs.some(n => /fishing spot/i.test(n.name ?? ''));
                }
                if (kind === 'shop') {
                    // Shopkeeper / tool seller nearby is enough for buy paths.
                    return npcs.length > 0 || locs.length > 0;
                }
                if (kind === 'bank') {
                    return locs.some(l => /bank booth|bank chest/i.test(l.name ?? ''));
                }
                return locs.length > 0 || npcs.length > 0;
            },
            [expect, radius] as const
        );
        if (hit) {
            // One extra beat so multi-tile footprints finish streaming in.
            await page.waitForTimeout(400);
            return;
        }
        await page.waitForTimeout(350);
    }
    throw new Error(`scene not ready for ${label} within ${timeoutMs}ms (post-tele loc lag?)`);
}

/** Open a bank booth, withdraw every item whose name matches `match`, close, then ~clearinv.
 *  Why: acquire scenarios must not withdraw leftover tools from earlier tests on the same account; Bank/Execution need an active script context, hence the one-shot LoopingBot. */
async function purgeBankTools(
    page: Page,
    bankStand: Tile,
    match: RegExp,
    label: string,
    pass = 0
): Promise<void> {
    if (pass > 2) {
        console.log(`  purge ${label}: giving up after ${pass} passes`);
        await clearInv(page);
        return;
    }

    const arrived = await teleArrive(page, bankStand, 12);
    if (!arrived) {
        throw new Error(`purge ${label}: tele to bank ${bankStand.x},${bankStand.z} failed`);
    }
    await waitSceneReady(page, 'bank', { radius: 10, label: `purge-${label}/bank`, timeoutMs: 15_000 });

    await stopScript(page);
    await page.evaluate(
        ([stand, patternSource, patternFlags, scriptName]) => {
            const g = globalThis as never as Abi;
            const abi = g.__rs2b0t;
            const re = new RegExp(patternSource, patternFlags);
            g.__gbProbe = { done: false, ok: false, reason: '', withdrew: 0 };

            class PurgeBankBot extends abi.LoopingBot {
                private ran = false;
                override async loop(): Promise<number> {
                    if (this.ran) {
                        return 5000;
                    }
                    this.ran = true;
                    const res = g.__gbProbe!;
                    const log = (_m: string) => {
                        /* quiet */
                    };
                    try {
                        if (!abi.Bank.isOpen()) {
                            const opened =
                                (await abi.Bank.openBooth(stand, 'Bank booth', 'Use-quickly', log))
                                || (await abi.Bank.openNearest('Bank booth', 'Use-quickly', log));
                            if (!opened) {
                                res.ok = false;
                                res.reason = 'could not open bank';
                                res.done = true;
                                return 5000;
                            }
                        }
                        await abi.Execution.delayUntil(() => abi.Bank.loaded() || !abi.Bank.isOpen(), 4000);
                        if (!abi.Bank.isOpen()) {
                            res.ok = false;
                            res.reason = 'bank closed before load';
                            res.done = true;
                            return 5000;
                        }
                        // Empty bank is fine — loaded() is false when the bank holds nothing; still try a beat.
                        await abi.Execution.delayTicks(1);

                        let withdrew = 0;
                        for (let guard = 0; guard < 24; guard++) {
                            const hit = abi.Bank.items().find(i => i.name && re.test(i.name));
                            if (!hit?.name) {
                                break;
                            }
                            const allOp = hit.ops.find(o => o && /withdraw[\s-]*all/i.test(o)) ?? 'Withdraw-All';
                            const before = abi.Inventory.used();
                            await abi.Bank.withdraw(hit.name, allOp);
                            await abi.Execution.delayUntil(
                                () => abi.Inventory.used() > before || abi.Bank.count(hit.name!) === 0,
                                3000
                            );
                            withdrew++;
                            if (abi.Inventory.free() <= 0) {
                                // Pack full — caller will clearinv and reopen if needed.
                                break;
                            }
                        }
                        if (abi.Bank.isOpen()) {
                            await abi.Bank.close();
                        }
                        res.ok = true;
                        res.reason = '';
                        res.withdrew = withdrew;
                    } catch (e) {
                        res.ok = false;
                        res.reason = e instanceof Error ? e.message : String(e);
                    }
                    res.done = true;
                    return 5000;
                }
            }

            abi.registerScript({ name: scriptName, create: () => new PurgeBankBot() });
            g.rs2b0t.runner.start(g.rs2b0t.registry.get(scriptName));
        },
        [bankStand, match.source, match.flags, `GbPurge_${label.replace(/[^a-zA-Z0-9_]/g, '_')}_${pass}`] as const
    );

    await page
        .waitForFunction(() => (globalThis as never as Abi).__gbProbe?.done === true, undefined, { timeout: 45_000 })
        .catch(() => undefined);

    const result = await page.evaluate(() => {
        const p = (globalThis as never as Abi).__gbProbe;
        return p ?? { done: true, ok: false, reason: 'no probe result', withdrew: 0 };
    });
    await stopScript(page);

    if (!result.ok) {
        // Soft: empty bank / booth lag — clear inv anyway and continue.
        console.log(`  purge ${label}: bank open soft-fail (${result.reason}) — continuing`);
    } else if (result.withdrew > 0) {
        console.log(`  purge ${label}: withdrew ${result.withdrew} bank stack(s) matching ${match}`);
    } else {
        console.log(`  purge ${label}: bank clean (no ${match} stacks)`);
    }

    await clearInv(page);

    // Second pass if pack filled mid-withdraw (probe left matching stacks).
    if (result.ok && result.withdrew > 0) {
        // Re-check bank under another short script if we hit pack-full mid-loop.
        // Heuristic: if we withdrew a lot, there may still be stacks — one more pass is cheap.
        if (result.withdrew >= 8) {
            await purgeBankTools(page, bankStand, match, `${label}-pass2`, pass + 1);
        }
    }
}

/** Open the bank at `bankStand`, deposit every held item whose name matches `names` (case-insensitive exact), close.
 *  Why: leaving the pack empty of those items forces the script under test through Banking.open / restock rather than the "materials already held" short-circuit. */
async function depositHeldToBank(
    page: Page,
    bankStand: Tile,
    names: readonly string[],
    label: string
): Promise<void> {
    const want = names.map(n => n.trim()).filter(n => n.length > 0);
    if (want.length === 0) {
        return;
    }

    const arrived = await teleArrive(page, bankStand, 12);
    if (!arrived) {
        throw new Error(`deposit ${label}: tele to bank ${bankStand.x},${bankStand.z} failed`);
    }
    await waitSceneReady(page, 'bank', { radius: 10, label: `deposit-${label}/bank`, timeoutMs: 15_000 });

    await stopScript(page);
    await page.evaluate(
        ([stand, nameList, scriptName]) => {
            const g = globalThis as never as Abi;
            const abi = g.__rs2b0t;
            const keep = new Set((nameList as string[]).map(n => n.toLowerCase()));
            g.__gbProbe = { done: false, ok: false, reason: '', withdrew: 0 };

            class DepositBankBot extends abi.LoopingBot {
                private ran = false;
                override async loop(): Promise<number> {
                    if (this.ran) {
                        return 5000;
                    }
                    this.ran = true;
                    const res = g.__gbProbe!;
                    const log = (_m: string) => {
                        /* quiet */
                    };
                    try {
                        if (!abi.Bank.isOpen()) {
                            const opened =
                                (await abi.Bank.openBooth(stand, 'Bank booth', 'Use-quickly', log))
                                || (await abi.Bank.openNearest('Bank booth', 'Use-quickly', log));
                            if (!opened) {
                                res.ok = false;
                                res.reason = 'could not open bank';
                                res.done = true;
                                return 5000;
                            }
                        }
                        await abi.Execution.delayUntil(() => abi.Bank.loaded() || !abi.Bank.isOpen(), 4000);
                        if (!abi.Bank.isOpen()) {
                            res.ok = false;
                            res.reason = 'bank closed before load';
                            res.done = true;
                            return 5000;
                        }
                        await abi.Execution.delayTicks(1);

                        // Deposit only the seeded materials — leave coins/junk alone.
                        await abi.Bank.depositAllMatching(name => keep.has((name ?? '').toLowerCase()));
                        await abi.Execution.delayUntil(() => abi.Bank.loaded() || !abi.Bank.isOpen(), 3000);
                        await abi.Execution.delayTicks(1);

                        // Confirm pack no longer holds the targets.
                        const still = (nameList as string[]).filter(n => abi.Inventory.count(n) > 0);
                        if (abi.Bank.isOpen()) {
                            await abi.Bank.close();
                        }
                        if (still.length > 0) {
                            res.ok = false;
                            res.reason = `still holding ${still.join(', ')} after deposit`;
                            res.done = true;
                            return 5000;
                        }
                        res.ok = true;
                        res.reason = '';
                        res.withdrew = keep.size;
                    } catch (e) {
                        res.ok = false;
                        res.reason = e instanceof Error ? e.message : String(e);
                    }
                    res.done = true;
                    return 5000;
                }
            }

            abi.registerScript({ name: scriptName, create: () => new DepositBankBot() });
            g.rs2b0t.runner.start(g.rs2b0t.registry.get(scriptName));
        },
        [bankStand, want, `GbDeposit_${label.replace(/[^a-zA-Z0-9_]/g, '_')}`] as const
    );

    await page
        .waitForFunction(() => (globalThis as never as Abi).__gbProbe?.done === true, undefined, { timeout: 45_000 })
        .catch(() => undefined);

    const result = await page.evaluate(() => {
        const p = (globalThis as never as Abi).__gbProbe;
        return p ?? { done: true, ok: false, reason: 'no probe result', withdrew: 0 };
    });
    await stopScript(page);

    if (!result.ok) {
        throw new Error(`deposit ${label}: ${result.reason || 'failed'}`);
    }
    console.log(`  deposit ${label}: banked ${want.join(' + ')} (pack clear)`);
}

function printNewLogs(s: Snap, lastTime: number, stamp: () => string): number {
    let max = lastTime;
    for (const l of s.logs) {
        if (l.time > lastTime) {
            console.log(`      ${stamp()} · [${l.level}] ${l.msg.slice(0, 220)}`);
            if (l.time > max) {
                max = l.time;
            }
        }
    }
    return max;
}

// ── scenarios ────────────────────────────────────────────────────────────────

type Scenario = {
    id: string;
    /** Group tags for CLI filters: mining, fishing, wc, acquire, endgame, path, all */
    tags: string[];
    script: 'Miner' | 'Fisher' | 'Woodcutter';
    /** Teleport start — usually offset from the camp so pathing is exercised. */
    start: Tile;
    /** Named camp anchor (for path-distance checks). */
    camp?: Tile;
    /** Bank stand for bank-loop scenarios (must walk here and clear product). */
    bank?: Tile;
    settings: Record<string, string | number | boolean>;
    /** Held items to seed via `give` (debug name → display name, qty). */
    seed?: { debug: string; name: string; qty?: number }[];
    /**
     * Direct bank seed via engine `givebank` ({@link seedItemsToBank}).
     * Prefer this over give→deposit — bulk unstackables fill the pack and stall.
     */
    bankSeed?: { items: BankSeedItem[]; stand: Tile };
    /** Skill levels to advance before start. End-game uses ~90 for success rolls. */
    stats?: { skill: string; level: number }[];
    /** Before seed: open this bank and withdraw matching tools, then clearinv. */
    purgeBank?: { stand: Tile; match: RegExp; label: string };
    /**
     * @deprecated Prefer {@link bankSeed} (`givebank`). Kept only for rare cases
     * where give→deposit is intentional; bulk fixtures must use bankSeed.
     */
    depositSeedToBank?: { stand: Tile; names: string[]; label: string };
    /**
     * After bank seed (or deposit): give held items (tool + near-full pack).
     * Prefer putting inv-only gear in {@link seed} and bank fixtures in {@link bankSeed}.
     */
    seedAfterDeposit?: { debug: string; name: string; qty?: number }[];
    /** Scene readiness after tele. Path-from-bank uses 'bank' or 'skip'. */
    scene?: SceneExpect;
    budgetMs?: number;
    check: (ctx: {
        start: Snap;
        cur: Snap;
        elapsedMs: number;
        sawProduct: boolean;
        productPeak: number;
        /** Product count dropped after gather XP (deposit or drop). */
        bankedHint: boolean;
        /** True once player was within bankRadius of sc.bank while product was high. */
        sawNearBank: boolean;
        /**
         * After bankedHint+sawNearBank, player entered the soft camp disk
         * (post-bank home walk — #154 Catherby bank sits inside leash).
         */
        returnedToCampAfterBank: boolean;
        /** Closest camp distance observed after the bank trip signals fired. */
        minDistToCampAfterBank: number;
        minDistToCamp: number;
        /**
         * Farthest camp distance while the script ran (local-prefer thrash detector).
         * Dwarven/SE iron clusters should keep this small if we stay on the near wing.
         */
        maxDistToCamp: number;
        minDistToBank: number;
        /** Current distance to bank (not the run minimum — purge often visits bank first). */
        distToBank: number;
        startDistToCamp: number;
    }) => 'pass' | 'wait' | 'fail';
    failMsg?: (ctx: {
        start: Snap;
        cur: Snap;
        minDistToCamp: number;
        maxDistToCamp?: number;
        minDistToBank?: number;
        distToBank?: number;
        minDistToCampAfterBank?: number;
        productPeak?: number;
        bankedHint?: boolean;
        sawNearBank?: boolean;
        returnedToCampAfterBank?: boolean;
    }) => string;
};

const SPOT = {
    swVarrockMine: { x: 3181, z: 3371, level: 0 },
    seVarrockMine: { x: 3285, z: 3366, level: 0 },
    /**
     * SE Varrock iron rocks (~3285–3288, 3368–3370) — tight 4-rock cluster.
     * Used as camp for local-prefer thrash checks (stay on the iron pad).
     */
    seVarrockIron: { x: 3286, z: 3369, level: 0 },
    /**
     * Dwarven Mine northern iron wing (~3032–3033, 9825–9826). Southern iron sits
     * ~50 tiles S (~3036–3045, 9769–9777); thrash walks that gap after a deplete.
     */
    dwarvenIronNorth: { x: 3032, z: 9825, level: 0 },
    /** Catalog camp seed near Nurmof (underground). */
    dwarvenMineSeed: { x: 3021, z: 9800, level: 0 },
    draynorFish: { x: 3086, z: 3231, level: 0 },
    catherbyFish: { x: 2845, z: 3431, level: 0 },
    /** Catherby bank booth stand (cook→bank deposit). */
    catherbyBank: { x: 2809, z: 3441, level: 0 },
    draynorTrees: { x: 3098, z: 3242, level: 0 },
    /** Lava Maze runite rocks (wildy). */
    lavaRunite: { x: 3058, z: 3884, level: 0 },
    /** Fishing Guild dock walkway. */
    fishingGuild: { x: 2604, z: 3420, level: 0 },
    /** Ardougne West / north bank — path start for guild sharks. */
    ardougneWestBank: { x: 2616, z: 3332, level: 0 },
    /** Near Bob (Lumbridge axes). */
    bob: { x: 3231, z: 3203, level: 0 },
    /** Near Gerrant (Port Sarim fishing). */
    gerrant: { x: 3013, z: 3224, level: 0 },
    /** Surface hop for Nurmof (dwarven mine picks). */
    nurmofHop: { x: 3019, z: 3449, level: 0 },
    faladorEast: { x: 3013, z: 3355, level: 0 },
    draynorBank: { x: 3093, z: 3243, level: 0 },
    varrockWestBank: { x: 3185, z: 3440, level: 0 },
    varrockAnvil: { x: 3188, z: 3425, level: 0 },
    edgevilleBank: { x: 3094, z: 3493, level: 0 },
    /** Barbarian Village fly/bait river (location bank = Edgeville). */
    barbVillageFish: { x: 3104, z: 3430, level: 0 },
    /** Barbarian Village tin/coal rocks (catalog seed; bank Edgeville). */
    barbVillageMine: { x: 3084, z: 3417, level: 0 },
    /** Rimmington mine seed (Doric cluster; bank Falador East — long soft-home leg). */
    rimmingtonMine: { x: 2978, z: 3247, level: 0 },
    /** Seers normal trees south of bank. */
    seersTrees: { x: 2724, z: 3474, level: 0 },
    seersBank: { x: 2725, z: 3491, level: 0 },
    /**
     * Seers fly fishing shore stand (catalog camp). Collision: exitMask≠0.
     * Do not offset W/N into the river — e.g. (2712,3535) is unpathable.
     */
    seersFly: { x: 2716, z: 3532, level: 0 },
    /** Sinclair range stand for Seers fly cook loops. */
    seersFlyRange: { x: 2732, z: 3581, level: 0 },
    /** Willows NW of Crafting Guild — Auto freeform WC (outside every WC camp chunk). */
    // Was 2910,3328 (~25N of the stand); willows sit closer to the guild wall.
    willowsNwCg: { x: 2910, z: 3303, level: 0 },
    /** Wilderness Skeleton Mine (coal) known-camp seed. */
    skelMine: { x: 3018, z: 3590, level: 0 },
    /** Clear west-side stand beside the Edgeville Dungeon mixed-rock field. */
    edgevilleDungeonMine: { x: 3132, z: 9874, level: 0 },
    /** Ardougne river fly fishing — Auto freeform fish. */
    ardyRiverFly: { x: 2566, z: 3374, level: 0 }
} as const;

const TOOL_RE = {
    pick: /pickaxe/i,
    axe: /\baxe\b/i,
    fishGear: /fishing net|harpoon|lobster pot|fishing rod|fly fishing rod|feather|fishing bait/i,
    gatherTools: /pickaxe|\baxe\b|fishing net|harpoon|lobster pot|fishing rod/i
} as const;

const SCENARIOS: Scenario[] = [
    // ── early-game gather (short path into camp) ─────────────────────────────
    {
        id: 'mine-bank',
        tags: ['mining', 'mine', 'bank', 'early'],
        script: 'Miner',
        start: offsetTile(SPOT.swVarrockMine, -10, 4),
        camp: SPOT.swVarrockMine,
        // SW Varrock mine banks at Varrock West.
        bank: SPOT.varrockWestBank,
        settings: {
            // SW Varrock seed has tin in leash — not copper (and Miner default is Iron).
            rocks: 'Tin',
            location: 'Southwest Varrock Mine',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 12
        },
        // Independent loop: grant rune pick (wiped next scenario). Acquire tests buy their own.
        seed: [
            { debug: 'rune_pickaxe', name: 'Rune pickaxe', qty: 1 },
            { debug: 'tin_ore', name: 'Tin ore', qty: 26 }
        ],
        scene: 'skip',
        budgetMs: 180_000,
        check: ({
            start,
            cur,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank,
            minDistToBank,
            minDistToCampAfterBank
        }) => {
            const xpGain = cur.xp.mining - start.xp.mining;
            const ore = invMatch(cur, /ore/i);
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            // Bank loop: mine last → walk to bank → deposit → return toward camp.
            if (
                xpGain > 0
                && productPeak >= 26
                && bankedHint
                && sawNearBank
                && ore <= 2
                && minDistToBank <= 10
                && returnedToCampAfterBank
                && minDistToCampAfterBank <= 12
            ) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({
            start,
            cur,
            minDistToCamp,
            minDistToBank,
            minDistToCampAfterBank,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank
        }) =>
            `mining xp ${start.xp.mining}→${cur.xp.mining}, distCamp=${minDistToCamp}, distBank=${minDistToBank}, ore=${invMatch(cur, /ore/i)}, peak=${productPeak}, banked=${bankedHint}, nearBank=${sawNearBank} homeAfterBank=${returnedToCampAfterBank} distCampAfterBank=${minDistToCampAfterBank}`
    },
    {
        id: 'mine-power',
        tags: ['mining', 'mine', 'power', 'drop', 'early'],
        script: 'Miner',
        start: offsetTile(SPOT.swVarrockMine, 8, -6),
        camp: SPOT.swVarrockMine,
        settings: {
            rocks: 'Tin',
            // location None = power-mine: drop ore when full (no bank loop).
            // Leash is from the live start tile (not camp) — product floors to 40.
            location: 'None',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 40
        },
        // Independent loop: rune pick + near-full pack → mine last → drop.
        seed: [
            { debug: 'rune_pickaxe', name: 'Rune pickaxe', qty: 1 },
            { debug: 'tin_ore', name: 'Tin ore', qty: 26 }
        ],
        scene: 'rocks',
        budgetMs: 180_000,
        check: ({ start, cur, productPeak, bankedHint }) => {
            const xpGain = cur.xp.mining - start.xp.mining;
            const ore = invMatch(cur, /ore/i);
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            // bankedHint here = product count dropped after gather XP (drop, not bank).
            if (xpGain > 0 && bankedHint && productPeak >= 26) {
                return 'pass';
            }
            // Fallback: mined into a full pack then cleared most of it.
            if (xpGain > 0 && productPeak >= 27 && ore <= productPeak - 3) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur, productPeak, bankedHint }) =>
            `power-mine xp ${start.xp.mining}→${cur.xp.mining}, ore=${invMatch(cur, /ore/i)}, peak=${productPeak}, dropped=${bankedHint}`
    },
    // ── iron local-prefer (Dwarven / SE Varrock thrash) ───────────────────────
    {
        id: 'mine-iron-se-varrock',
        tags: ['mining', 'mine', 'iron', 'local', 'early'],
        script: 'Miner',
        // Stand a couple tiles off the iron pad so we walk in, not sit on a loc.
        start: offsetTile(SPOT.seVarrockIron, -3, -2),
        camp: SPOT.seVarrockIron,
        settings: {
            rocks: 'Iron',
            location: 'Southeast Varrock Mine',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 18
        },
        seed: [{ debug: 'rune_pickaxe', name: 'Rune pickaxe', qty: 1 }],
        scene: 'rocks',
        budgetMs: 120_000,
        check: ({ start, cur, productPeak, maxDistToCamp, elapsedMs }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const xpGain = cur.xp.mining - start.xp.mining;
            const iron = invMatch(cur, /^iron ore$/i);
            // Tight pad: stay on the SE iron cluster (prefer-local radius 12 + slack).
            const stayedLocal = maxDistToCamp <= 14;
            if (xpGain > 0 && (iron >= 2 || productPeak >= 2) && stayedLocal) {
                return 'pass';
            }
            // Gathered but wandered — fail early so thrash does not wait the budget.
            if (xpGain > 0 && maxDistToCamp > 18 && elapsedMs >= 20_000) {
                return 'fail';
            }
            return 'wait';
        },
        failMsg: ({ start, cur, minDistToCamp, maxDistToCamp, productPeak }) =>
            `se-iron xp ${start.xp.mining}→${cur.xp.mining} iron=${invMatch(cur, /^iron ore$/i)} ` +
            `peak=${productPeak} distCamp ${minDistToCamp}..${maxDistToCamp} ` +
            `tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'}`
    },
    {
        id: 'mine-iron-dwarven-north',
        tags: ['mining', 'mine', 'iron', 'local', 'dwarven'],
        script: 'Miner',
        // Northern iron wing — not the southern cluster (~50 tiles S of this pin).
        start: offsetTile(SPOT.dwarvenIronNorth, -2, 1),
        camp: SPOT.dwarvenIronNorth,
        settings: {
            rocks: 'Iron',
            location: 'Dwarven Mine',
            toolAcquire: 'Off',
            forgetfulBank: false,
            // Membership floors to 64 for named camps; UI leash is irrelevant for ore pick.
            leashRadius: 18
        },
        seed: [{ debug: 'rune_pickaxe', name: 'Rune pickaxe', qty: 1 }],
        scene: 'rocks',
        budgetMs: 150_000,
        check: ({ start, cur, productPeak, maxDistToCamp, elapsedMs }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const xpGain = cur.xp.mining - start.xp.mining;
            const iron = invMatch(cur, /^iron ore$/i);
            // Southern wing is ~cheb 50 from this camp — thrash trips exceed ~22.
            const stayedNorth = maxDistToCamp <= 16;
            if (xpGain > 0 && (iron >= 2 || productPeak >= 2) && stayedNorth) {
                return 'pass';
            }
            if (maxDistToCamp > 22 && elapsedMs >= 25_000) {
                return 'fail';
            }
            return 'wait';
        },
        failMsg: ({ start, cur, minDistToCamp, maxDistToCamp, productPeak }) =>
            `dwarven-north-iron xp ${start.xp.mining}→${cur.xp.mining} iron=${invMatch(cur, /^iron ore$/i)} ` +
            `peak=${productPeak} distCamp ${minDistToCamp}..${maxDistToCamp} ` +
            `tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'}`
    },
    /** Single-account mule gatherer smoke: a full pack with muleMode Gatherer must hold at the meet and wait for a partner rather than bank.
     *  A full Gatherer↔Mule trade needs two harnesses. */
    {
        id: 'mine-mule-gatherer-meet',
        tags: ['mining', 'mine', 'mule', 'early'],
        script: 'Miner',
        start: offsetTile(SPOT.seVarrockIron, -2, -1),
        camp: SPOT.seVarrockIron,
        bank: { x: 3253, z: 3420, level: 0 }, // Varrock East — must NOT visit for handoff
        settings: {
            rocks: 'Iron',
            location: 'Southeast Varrock Mine',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 18,
            muleMode: 'Gatherer',
            mulePartner: 'HarnessMulePartner'
        },
        seed: [
            { debug: 'rune_pickaxe', name: 'Rune pickaxe', qty: 1 },
            { debug: 'iron_ore', name: 'Iron ore', qty: 27 }
        ],
        scene: 'rocks',
        budgetMs: 90_000,
        check: ({ cur, productPeak, distToBank, minDistToCamp, elapsedMs }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            // Startup log always includes mode line; waiting/trade lines are status-only.
            const muleOn = logHas(cur, /mule:\s*gatherer with/i);
            const nearMeet = minDistToCamp <= 4;
            const stillHolding = invMatch(cur, /ore/i) >= 20 || productPeak >= 20;
            // Must not complete a bank deposit of the haul.
            if (logHas(cur, /bank:\s*deposited/i) && elapsedMs >= 12_000) {
                return 'fail';
            }
            // Use current bank distance — minDistToBank is poisoned by start-purge bank trips.
            if (muleOn && nearMeet && stillHolding && distToBank > 12 && elapsedMs >= 8_000) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ cur, minDistToCamp, distToBank, productPeak }) =>
            `mule-gatherer ore=${invMatch(cur, /ore/i)} peak=${productPeak} ` +
            `distCamp=${minDistToCamp} distBank=${distToBank ?? '?'} ` +
            `muleOn=${logHas(cur, /mule:\s*gatherer with/i)} bankedLog=${logHas(cur, /bank:\s*deposited/i)} ` +
            `tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'}`
    },
    /**
     * Second mine bank loop + long soft-home: Rimmington iron → Falador East (~100+ tiles).
     * Catches bank preference / post-deposit return regressions not covered by SW Varrock.
     */
    {
        id: 'mine-bank-rimmington',
        tags: ['mining', 'mine', 'bank', 'camp', 'early'],
        script: 'Miner',
        start: offsetTile(SPOT.rimmingtonMine, -6, 3),
        camp: SPOT.rimmingtonMine,
        bank: SPOT.faladorEast,
        settings: {
            rocks: 'Iron',
            location: 'Rimmington Mine',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 18
        },
        seed: [
            { debug: 'rune_pickaxe', name: 'Rune pickaxe', qty: 1 },
            { debug: 'iron_ore', name: 'Iron ore', qty: 26 }
        ],
        scene: 'skip',
        budgetMs: 210_000,
        check: ({
            start,
            cur,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank,
            minDistToBank,
            minDistToCampAfterBank
        }) => {
            const xpGain = cur.xp.mining - start.xp.mining;
            const ore = invMatch(cur, /ore/i);
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            if (
                xpGain > 0
                && productPeak >= 26
                && bankedHint
                && sawNearBank
                && ore <= 2
                && minDistToBank <= 12
                && returnedToCampAfterBank
                && minDistToCampAfterBank <= 14
            ) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({
            start,
            cur,
            minDistToCamp,
            minDistToBank,
            minDistToCampAfterBank,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank
        }) =>
            `rimmington xp ${start.xp.mining}→${cur.xp.mining} distCamp=${minDistToCamp} distBank=${minDistToBank} ` +
            `ore=${invMatch(cur, /ore/i)} peak=${productPeak} banked=${bankedHint} nearBank=${sawNearBank} ` +
            `homeAfterBank=${returnedToCampAfterBank} distCampAfterBank=${minDistToCampAfterBank}`
    },
    {
        id: 'fish-bank',
        tags: ['fishing', 'fish', 'bank', 'early'],
        script: 'Fisher',
        start: offsetTile(SPOT.draynorFish, 8, 6),
        camp: SPOT.draynorFish,
        bank: SPOT.draynorBank,
        settings: {
            fishMethod: 'Small net — shrimp/anchovy',
            location: 'Draynor Village',
            cookMode: 'Off',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 18
        },
        // Net + 26 raw = 27 slots; one free so it must fish the last catch,
        // then walk to bank and deposit the pack.
        seed: [
            { debug: 'net', name: 'Small fishing net', qty: 1 },
            { debug: 'raw_shrimp', name: 'Raw shrimps', qty: 26 }
        ],
        // Fishing 99 from BASE_STATS.
        scene: 'skip',
        budgetMs: 180_000,
        check: ({
            start,
            cur,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank,
            minDistToBank,
            minDistToCampAfterBank
        }) => {
            const xpGain = cur.xp.fishing - start.xp.fishing;
            const raw = invMatch(cur, /^raw /i);
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            // Bank loop: fish last → walk to bank → deposit → return toward camp.
            if (
                xpGain > 0
                && productPeak >= 26
                && bankedHint
                && sawNearBank
                && raw <= 2
                && minDistToBank <= 10
                && returnedToCampAfterBank
                && minDistToCampAfterBank <= 12
            ) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({
            start,
            cur,
            minDistToCamp,
            minDistToBank,
            minDistToCampAfterBank,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank
        }) =>
            `fishing xp ${start.xp.fishing}->${cur.xp.fishing}, distCamp=${minDistToCamp}, distBank=${minDistToBank}, raw=${invMatch(cur, /^raw /i)}, peak=${productPeak}, banked=${bankedHint}, nearBank=${sawNearBank} homeAfterBank=${returnedToCampAfterBank} distCampAfterBank=${minDistToCampAfterBank}`
    },
    /**
     * Barbarian Village fly → Edgeville bank. Wide campRadius (72) + off-camp bank:
     * membership + soft home without Catherby cook complexity.
     */
    {
        id: 'fish-bank-barb',
        tags: ['fishing', 'fish', 'bank', 'camp', 'early'],
        script: 'Fisher',
        start: offsetTile(SPOT.barbVillageFish, -5, 4),
        camp: SPOT.barbVillageFish,
        bank: SPOT.edgevilleBank,
        settings: {
            fishMethod: 'Fly fishing — trout/salmon',
            location: 'Barbarian Village',
            cookMode: 'Off',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 18
        },
        seed: [
            { debug: 'fly_fishing_rod', name: 'Fly fishing rod', qty: 1 },
            { debug: 'feather', name: 'Feather', qty: 100 },
            { debug: 'raw_trout', name: 'Raw trout', qty: 25 }
        ],
        scene: 'skip',
        budgetMs: 200_000,
        check: ({
            start,
            cur,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank,
            minDistToBank,
            minDistToCampAfterBank
        }) => {
            const xpGain = cur.xp.fishing - start.xp.fishing;
            const raw = invMatch(cur, /^raw /i);
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            if (
                xpGain > 0
                && productPeak >= 25
                && bankedHint
                && sawNearBank
                && raw <= 3
                && minDistToBank <= 12
                && returnedToCampAfterBank
                && minDistToCampAfterBank <= 14
            ) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({
            start,
            cur,
            minDistToCamp,
            minDistToBank,
            minDistToCampAfterBank,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank
        }) =>
            `barb-fish xp ${start.xp.fishing}→${cur.xp.fishing} distCamp=${minDistToCamp} distBank=${minDistToBank} ` +
            `raw=${invMatch(cur, /^raw /i)} peak=${productPeak} banked=${bankedHint} nearBank=${sawNearBank} ` +
            `homeAfterBank=${returnedToCampAfterBank} distCampAfterBank=${minDistToCampAfterBank}`
    },
    /**
     * Fisher gatherer mule smoke (Draynor): full raw haul → meet + hold, must not bank.
     * Complements mine-mule-gatherer-meet so product keywords / depositable paths differ.
     */
    {
        id: 'fish-mule-gatherer-meet',
        tags: ['fishing', 'fish', 'mule', 'early'],
        script: 'Fisher',
        start: offsetTile(SPOT.draynorFish, 4, 3),
        camp: SPOT.draynorFish,
        bank: SPOT.draynorBank,
        settings: {
            fishMethod: 'Small net — shrimp/anchovy',
            location: 'Draynor Village',
            cookMode: 'Off',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 18,
            muleMode: 'Gatherer',
            mulePartner: 'HarnessMulePartner'
        },
        seed: [
            { debug: 'net', name: 'Small fishing net', qty: 1 },
            { debug: 'raw_shrimp', name: 'Raw shrimps', qty: 27 }
        ],
        scene: 'skip',
        budgetMs: 90_000,
        check: ({ cur, productPeak, distToBank, minDistToCamp, elapsedMs }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const muleOn = logHas(cur, /mule:\s*gatherer with/i);
            const nearMeet = minDistToCamp <= 6;
            const stillHolding = invMatch(cur, /^raw /i) >= 20 || productPeak >= 20;
            if (logHas(cur, /bank:\s*deposited/i) && elapsedMs >= 12_000) {
                return 'fail';
            }
            // Current bank dist — Draynor start-purge visits the booth and poisons minDistToBank.
            if (muleOn && nearMeet && stillHolding && distToBank > 8 && elapsedMs >= 8_000) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ cur, minDistToCamp, distToBank, productPeak }) =>
            `fish-mule-gatherer raw=${invMatch(cur, /^raw /i)} peak=${productPeak} ` +
            `distCamp=${minDistToCamp} distBank=${distToBank ?? '?'} ` +
            `muleOn=${logHas(cur, /mule:\s*gatherer with/i)} bankedLog=${logHas(cur, /bank:\s*deposited/i)} ` +
            `tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'}`
    },
    {
        // Cook then bank: seed cooked so one catch fills the pack with 1 raw + 26 cooked → cook the raw → bank the cooked pile at Catherby.
        // Why: #154 — the bot must also leave the bank toward the pier after depositing; Catherby bank is ~36 from the spot, inside the 64 leash, so deposit-only false-PASSed.
        id: 'fish-cook-bank',
        tags: ['fishing', 'fish', 'cook', 'bank', 'early'],
        script: 'Fisher',
        start: offsetTile(SPOT.catherbyFish, -6, 4),
        camp: SPOT.catherbyFish,
        bank: SPOT.catherbyBank,
        settings: {
            fishMethod: 'Lobster cage — lobster',
            location: 'Catherby',
            cookMode: 'Cook then bank',
            cookFish: 'All raw',
            burntPolicy: 'Drop',
            toolAcquire: 'Off',
            forgetfulBank: false,
            // Keep seeded cooked pack — purge would force a full re-fish before cook.
            purgePackOnStart: false,
            leashRadius: 18
        },
        // Pot + 26 cooked = 27 slots; one free → fish last raw → cook → bank → home.
        seed: [
            { debug: 'lobster_pot', name: 'Lobster pot', qty: 1 },
            { debug: 'lobster', name: 'Lobster', qty: 26 }
        ],
        // Cooking/fishing already 99 from BASE_STATS.
        scene: 'skip',
        // No Make-X: one last catch + one-at-a-time cook + bank/home (Catherby range≈bank).
        budgetMs: 300_000,
        check: ({
            start,
            cur,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank,
            minDistToBank,
            minDistToCampAfterBank
        }) => {
            const fishXp = cur.xp.fishing - start.xp.fishing;
            const cookXp = cur.xp.cooking - start.xp.cooking;
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            // Full cook→bank→home: catch → cook → deposit near bank → walk to pier.
            // After home the bot may re-fish; do not require empty pack at pass time.
            if (
                fishXp > 0
                && cookXp > 0
                && productPeak >= 26
                && bankedHint
                && sawNearBank
                && minDistToBank <= 12
                && returnedToCampAfterBank
                && minDistToCampAfterBank <= 12
            ) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({
            start,
            cur,
            minDistToBank,
            minDistToCampAfterBank,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank
        }) =>
            `fish xp ${start.xp.fishing}→${cur.xp.fishing} cook xp ${start.xp.cooking}→${cur.xp.cooking} ` +
            `rawLob=${invMatch(cur, /^raw lobster$/i)} cookedLob=${invMatch(cur, /^lobster$/i)} ` +
            `peak=${productPeak} banked=${bankedHint} nearBank=${sawNearBank} distBank=${minDistToBank} ` +
            `homeAfterBank=${returnedToCampAfterBank} distCampAfterBank=${minDistToCampAfterBank}`
    },
    /** Barbarian Village cook surface (outdoor Fire from CookingRanges): cook-then-bank without Catherby.
     *  Starts nearly full of cooked with one free slot — fish the last raw, cook on the Fire, bank at Edgeville. */
    {
        id: 'fish-cook-barb',
        tags: ['fishing', 'fish', 'cook', 'bank', 'camp', 'early'],
        script: 'Fisher',
        start: offsetTile(SPOT.barbVillageFish, -3, 2),
        camp: SPOT.barbVillageFish,
        bank: SPOT.edgevilleBank,
        settings: {
            fishMethod: 'Fly fishing — trout/salmon',
            location: 'Barbarian Village',
            cookMode: 'Cook then bank',
            cookFish: 'All raw',
            burntPolicy: 'Drop',
            toolAcquire: 'Off',
            forgetfulBank: false,
            purgePackOnStart: false,
            leashRadius: 18
        },
        // Rod + feather stack + 25 cooked = 27 used, free 1 for last raw.
        seed: [
            { debug: 'fly_fishing_rod', name: 'Fly fishing rod', qty: 1 },
            { debug: 'feather', name: 'Feather', qty: 50 },
            { debug: 'trout', name: 'Trout', qty: 25 }
        ],
        scene: 'skip',
        budgetMs: 270_000,
        check: ({ start, cur, productPeak, bankedHint, sawNearBank, minDistToBank }) => {
            const fishXp = cur.xp.fishing - start.xp.fishing;
            const cookXp = cur.xp.cooking - start.xp.cooking;
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            if (
                fishXp > 0
                && cookXp > 0
                && productPeak >= 25
                && bankedHint
                && sawNearBank
                && minDistToBank <= 14
            ) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur, minDistToBank, productPeak, bankedHint, sawNearBank }) =>
            `barb-cook fish ${start.xp.fishing}→${cur.xp.fishing} cook ${start.xp.cooking}→${cur.xp.cooking} ` +
            `peak=${productPeak} banked=${bankedHint} nearBank=${sawNearBank} distBank=${minDistToBank} ` +
            `cookAt=${logHas(cur, /cook: cook-then-bank @ Fire/i)}`
    },
    /**
     * Seers fly + catalog Range (Sinclair) cook-then-bank. Start on the pathable
     * camp stand (2716,3532) — offset into the river used to soft-lock the harness.
     */
    {
        id: 'fish-cook-seers',
        tags: ['fishing', 'fish', 'cook', 'bank', 'camp', 'early'],
        script: 'Fisher',
        start: SPOT.seersFly,
        camp: SPOT.seersFly,
        bank: SPOT.seersBank,
        settings: {
            fishMethod: 'Fly fishing — trout/salmon',
            location: 'Seers (fly fishing)',
            cookMode: 'Cook then bank',
            cookFish: 'All raw',
            burntPolicy: 'Drop',
            toolAcquire: 'Off',
            forgetfulBank: false,
            purgePackOnStart: false,
            leashRadius: 18
        },
        // Rod + feathers + 25 cooked = 27 used, free 1 for last raw (same as Catherby).
        seed: [
            { debug: 'fly_fishing_rod', name: 'Fly fishing rod', qty: 1 },
            { debug: 'feather', name: 'Feather', qty: 50 },
            { debug: 'trout', name: 'Trout', qty: 25 }
        ],
        scene: 'skip',
        // Sinclair mansion range → Seers bank is a long door path after the cook.
        budgetMs: 300_000,
        check: ({ start, cur, productPeak, bankedHint, sawNearBank, minDistToBank }) => {
            const fishXp = cur.xp.fishing - start.xp.fishing;
            const cookXp = cur.xp.cooking - start.xp.cooking;
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            if (
                fishXp > 0
                && cookXp > 0
                && productPeak >= 25
                && bankedHint
                && sawNearBank
                && minDistToBank <= 14
            ) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur, minDistToBank, productPeak, bankedHint, sawNearBank }) =>
            `seers-cook fish ${start.xp.fishing}→${cur.xp.fishing} cook ${start.xp.cooking}→${cur.xp.cooking} ` +
            `peak=${productPeak} banked=${bankedHint} nearBank=${sawNearBank} distBank=${minDistToBank} ` +
            `tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'}`
    },
    /**
     * Cooker mule solo: full raw pack + muleMode Cooker + cook-then-bank → cook at camp
     * range and bank cooked (no partner needed once raw is held; trade tasks idle).
     */
    {
        id: 'fish-cooker-solo',
        tags: ['fishing', 'fish', 'cook', 'mule', 'early'],
        script: 'Fisher',
        start: offsetTile(SPOT.catherbyFish, -4, 2),
        camp: SPOT.catherbyFish,
        bank: SPOT.catherbyBank,
        settings: {
            fishMethod: 'Lobster cage — lobster',
            location: 'Catherby',
            cookMode: 'Cook then bank',
            cookFish: 'Lobster',
            burntPolicy: 'Drop',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 18,
            muleMode: 'Cooker',
            mulePartner: 'HarnessCookPartner'
        },
        seed: [
            { debug: 'raw_lobster', name: 'Raw lobster', qty: 28 }
        ],
        scene: 'skip',
        budgetMs: 240_000,
        check: ({ start, cur, bankedHint, sawNearBank, minDistToBank }) => {
            const cookXp = cur.xp.cooking - start.xp.cooking;
            const raw = invMatch(cur, /^raw lobster$/i);
            const cooked = invMatch(cur, /^lobster$/i);
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            if (
                logHas(cur, /mule:\s*cooker with/i)
                && cookXp > 0
                && raw === 0
                && (bankedHint || cooked === 0)
                && sawNearBank
                && minDistToBank <= 14
            ) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur, minDistToBank, bankedHint, sawNearBank }) =>
            `cooker cookXp ${start.xp.cooking}→${cur.xp.cooking} raw=${invMatch(cur, /^raw lobster$/i)} ` +
            `cooked=${invMatch(cur, /^lobster$/i)} banked=${bankedHint} nearBank=${sawNearBank} ` +
            `mule=${logHas(cur, /mule:\s*cooker/i)} distBank=${minDistToBank}`
    },
    {
        // Bank raw then cook: givebank 973 raw + inv pot + 26 raw → catch the last → bank hits N → withdraw and cook the batch.
        // 973 banked + 27 deposited = 1000 (explicit bankRawBeforeCook; the product default is 56).
        id: 'fish-bank-raw-cook',
        tags: ['fishing', 'fish', 'cook', 'bank', 'early'],
        script: 'Fisher',
        start: offsetTile(SPOT.catherbyFish, -6, 4),
        camp: SPOT.catherbyFish,
        bank: SPOT.catherbyBank,
        settings: {
            fishMethod: 'Lobster cage — lobster',
            location: 'Catherby',
            cookMode: 'Bank raw then cook',
            cookFish: 'Lobster',
            burntPolicy: 'Drop',
            bankRawBeforeCook: 1000,
            afterCookCycle: 'Stop',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 18
        },
        // Direct bank seed — do not give→deposit 973 (pack thrash / noted preflight).
        bankSeed: {
            stand: SPOT.catherbyBank,
            items: [{ debugName: 'raw_lobster', displayName: 'Raw lobster', qty: 973 }]
        },
        seed: [
            { debug: 'lobster_pot', name: 'Lobster pot', qty: 1 },
            { debug: 'raw_lobster', name: 'Raw lobster', qty: 26 }
        ],
        scene: 'skip',
        budgetMs: 240_000,
        check: ({ start, cur, productPeak, bankedHint, sawNearBank, minDistToBank }) => {
            const fishXp = cur.xp.fishing - start.xp.fishing;
            const cookXp = cur.xp.cooking - start.xp.cooking;
            const batchStart = logHas(cur, /cook:\s*bank holds\s+\d+.*starting batch/i);
            const withdrew = logHas(cur, /cook:\s*withdr/i);
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            // Catch last → bank raw to N → batch arm → cook XP (or at least withdraw).
            if (
                fishXp > 0
                && bankedHint
                && sawNearBank
                && productPeak >= 26
                && batchStart
                && (cookXp > 0 || withdrew)
                && minDistToBank <= 14
            ) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur, minDistToBank, productPeak, bankedHint, sawNearBank }) =>
            `fish xp ${start.xp.fishing}→${cur.xp.fishing} cook xp ${start.xp.cooking}→${cur.xp.cooking} ` +
            `batch=${logHas(cur, /starting batch/i)} withdr=${logHas(cur, /cook:\s*withdr/i)} ` +
            `rawLob=${invMatch(cur, /^raw lobster$/i)} peak=${productPeak} ` +
            `banked=${bankedHint} nearBank=${sawNearBank} distBank=${minDistToBank}`
    },
    {
        id: 'wc-bank',
        tags: ['woodcutting', 'wc', 'bank', 'early'],
        script: 'Woodcutter',
        start: offsetTile(SPOT.draynorTrees, -8, 5),
        camp: SPOT.draynorTrees,
        bank: SPOT.draynorBank,
        settings: {
            treeName: 'Tree',
            location: 'Draynor (trees)',
            burnMode: 'Off',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 12
        },
        // Independent loop: rune axe + near-full pack → chop last → bank.
        seed: [
            { debug: 'rune_axe', name: 'Rune axe', qty: 1 },
            { debug: 'logs', name: 'Logs', qty: 26 }
        ],
        scene: 'skip',
        budgetMs: 210_000,
        check: ({
            start,
            cur,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank,
            minDistToBank,
            minDistToCampAfterBank
        }) => {
            const xpGain = cur.xp.woodcutting - start.xp.woodcutting;
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            // Bank loop: chop → deposit → return toward camp.
            // Why: after banking the bot re-chops and refills before the next harness snap, so requiring logs<=2 at pass time false-fails.
            if (
                xpGain > 0
                && productPeak >= 26
                && bankedHint
                && sawNearBank
                && minDistToBank <= 10
                && returnedToCampAfterBank
                && minDistToCampAfterBank <= 12
            ) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({
            start,
            cur,
            minDistToCamp,
            minDistToBank,
            minDistToCampAfterBank,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank
        }) =>
            `wc xp ${start.xp.woodcutting}->${cur.xp.woodcutting}, distCamp=${minDistToCamp}, distBank=${minDistToBank}, logs=${invMatch(cur, /logs/i)}, peak=${productPeak}, banked=${bankedHint}, nearBank=${sawNearBank} homeAfterBank=${returnedToCampAfterBank} distCampAfterBank=${minDistToCampAfterBank}`
    },
    /**
     * Second WC bank camp (Seers normal trees → Seers booth). Catches location table
     * / bank stand regressions outside Draynor.
     */
    {
        id: 'wc-bank-seers',
        tags: ['woodcutting', 'wc', 'bank', 'camp', 'early'],
        script: 'Woodcutter',
        start: offsetTile(SPOT.seersTrees, -5, 3),
        camp: SPOT.seersTrees,
        bank: SPOT.seersBank,
        settings: {
            treeName: 'Tree',
            location: 'Seers (trees)',
            burnMode: 'Off',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 12
        },
        seed: [
            { debug: 'rune_axe', name: 'Rune axe', qty: 1 },
            { debug: 'logs', name: 'Logs', qty: 26 }
        ],
        scene: 'skip',
        budgetMs: 180_000,
        check: ({
            start,
            cur,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank,
            minDistToBank,
            minDistToCampAfterBank
        }) => {
            const xpGain = cur.xp.woodcutting - start.xp.woodcutting;
            const logs = invMatch(cur, /logs/i);
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            if (
                xpGain > 0
                && productPeak >= 26
                && bankedHint
                && sawNearBank
                && logs <= 2
                && minDistToBank <= 12
                && returnedToCampAfterBank
                && minDistToCampAfterBank <= 14
            ) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({
            start,
            cur,
            minDistToCamp,
            minDistToBank,
            minDistToCampAfterBank,
            productPeak,
            bankedHint,
            sawNearBank,
            returnedToCampAfterBank
        }) =>
            `seers-wc xp ${start.xp.woodcutting}→${cur.xp.woodcutting} distCamp=${minDistToCamp} distBank=${minDistToBank} ` +
            `logs=${invMatch(cur, /logs/i)} peak=${productPeak} banked=${bankedHint} nearBank=${sawNearBank} ` +
            `homeAfterBank=${returnedToCampAfterBank} distCampAfterBank=${minDistToCampAfterBank}`
    },
    {
        id: 'wc-burn',
        tags: ['woodcutting', 'wc', 'burn', 'firemaking', 'early'],
        script: 'Woodcutter',
        start: offsetTile(SPOT.draynorTrees, 6, -4),
        camp: SPOT.draynorTrees,
        settings: {
            treeName: 'Tree',
            location: 'Draynor (trees)',
            burnMode: 'Chop then burn',
            fireSpot: 'Auto',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 12
        },
        // Independent loop: rune axe + tinder + logs → chop-then-burn path.
        seed: [
            { debug: 'rune_axe', name: 'Rune axe', qty: 1 },
            { debug: 'tinderbox', name: 'Tinderbox', qty: 1 },
            { debug: 'logs', name: 'Logs', qty: 26 }
        ],
        scene: 'skip',
        // Jail guard kites eat budget; need time to re-camp and light after clear.
        budgetMs: 210_000,
        check: ({ start, cur }) => {
            const fmXp = cur.xp.firemaking - start.xp.firemaking;
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            // Chop-then-burn: lighting the seeded pack is the product path under test.
            if (fmXp > 0) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur }) =>
            `fm xp ${start.xp.firemaking}→${cur.xp.firemaking}, logs=${invMatch(cur, /^logs$/i)}`
    },

    // ── end-game pathing ─────────────────────────────────────────────────────
    {
        id: 'mine-path-runite',
        tags: ['mining', 'mine', 'endgame', 'path', 'wildy'],
        script: 'Miner',
        // Walk into the lava-maze runite pocket (not standing on the rocks).
        start: offsetTile(SPOT.lavaRunite, -14, -10),
        camp: SPOT.lavaRunite,
        settings: {
            rocks: 'Runite',
            location: 'Lava Maze Runite Mine',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 16
        },
        // Independent path loop: rune pick; acquire scenarios wipe/buy separately.
        seed: [{ debug: 'rune_pickaxe', name: 'Rune pickaxe', qty: 1 }],
        scene: 'skip',
        // Spiders + flee can eat wall-clock; must still land a live ore before pass.
        budgetMs: 300_000,
        check: ({ start, cur, sawProduct, productPeak, minDistToCamp, startDistToCamp }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const xpGain = cur.xp.mining - start.xp.mining;
            const runite = invMatch(cur, /runite ore/i);
            // Why: flee or near-camp alone false-PASSes with 0 XP, so the bot has to mine.
            const gathered = xpGain > 0 || sawProduct || runite > 0 || productPeak > 0;
            if (!gathered) {
                return 'wait';
            }
            // Path into the pocket (or already near after kite).
            const pathed = startDistToCamp >= 8 && minDistToCamp <= startDistToCamp - 3;
            const nearCamp = minDistToCamp <= 14;
            if (nearCamp || pathed) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur, minDistToCamp, productPeak }) =>
            `runite path xp ${start.xp.mining}→${cur.xp.mining} ore=${invMatch(cur, /runite ore/i)} ` +
            `peak=${productPeak} distCamp=${minDistToCamp} fled=${logHas(cur, /combat:\s*under attack/i)} ` +
            `tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'}`
    },
    {
        id: 'fish-path-shark',
        tags: ['fishing', 'fish', 'endgame', 'path', 'guild'],
        script: 'Fisher',
        // Flow: leave Ardougne north/west bank and walk into the Fishing Guild.
        start: SPOT.ardougneWestBank,
        camp: SPOT.fishingGuild,
        settings: {
            fishMethod: 'Harpoon — sharks',
            location: 'Fishing Guild',
            cookMode: 'Off',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 18
        },
        seed: [{ debug: 'harpoon', name: 'Harpoon', qty: 1 }],
        // Fishing 99 from BASE_STATS covers sharks — no mid-suite raise.
        scene: 'bank',
        budgetMs: 210_000,
        check: ({ start, cur, sawProduct, minDistToCamp, startDistToCamp, elapsedMs }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const xpGain = cur.xp.fishing - start.xp.fishing;
            const pathed = startDistToCamp >= 20 && minDistToCamp <= startDistToCamp - 12;
            const nearGuild = minDistToCamp <= 14;
            const shark = invMatch(cur, /shark/i);
            // Path into guild + either XP/product or long enough dwell near spots.
            if (pathed && nearGuild && (xpGain > 0 || sawProduct || shark > 0)) {
                return 'pass';
            }
            if (xpGain > 0 && nearGuild) {
                return 'pass';
            }
            // Approached guild docks and stayed — pathing proved even if shark roll is cold.
            if (pathed && nearGuild && elapsedMs >= 90_000) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur, minDistToCamp }) =>
            `shark path xp ${start.xp.fishing}→${cur.xp.fishing}, distGuild=${minDistToCamp}, tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'}, raw=${invMatch(cur, /^raw /i)}`
    },

    // ── tool acquire (bank-isolated; assert shop/smith not leftover withdraw) ─
    {
        id: 'buy-pick',
        tags: ['acquire', 'buy', 'mining', 'tools'],
        script: 'Miner',
        // Flow: missing tool + 32k → Fally East bank, then Nurmof for Rune pickaxe.
        start: SPOT.faladorEast,
        camp: SPOT.nurmofHop,
        settings: {
            rocks: 'Copper',
            location: 'Dwarven Mine',
            toolAcquire: 'Buy / repair',
            forgetfulBank: false,
            leashRadius: 14
        },
        purgeBank: { stand: SPOT.faladorEast, match: TOOL_RE.pick, label: 'picks@fally-e' },
        // 32k = Nurmof rune list price; mining already 99 from BASE_STATS.
        seed: [{ debug: 'coins', name: 'Coins', qty: 32_000 }],
        scene: 'bank',
        // Trapdoor hop + random-event recovery; prior run lost ~60s mid-path.
        budgetMs: 300_000,
        check: ({ cur, elapsedMs }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            // Best affordable with 32k is Rune pickaxe @ Nurmof (shop path, not success tier).
            const boughtRune = logHas(cur, /acquire:\s*bought\s+\d+×\s*Rune pickaxe/i);
            const gotRune = hasTool(cur, 'Rune pickaxe');
            if (boughtRune && gotRune) {
                return 'pass';
            }
            if (boughtRune && elapsedMs >= 30_000) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ cur }) =>
            `boughtRune=${logHas(cur, /acquire:\s*bought\s+\d+×\s*Rune pickaxe/i)} runePick=${hasTool(cur, 'Rune pickaxe')} anyPick=${hasAnyPick(cur)} coins=${invCount(cur, 'Coins')} inv=${cur.inv.map(i => i.name).join(',') || 'empty'}`
    },
    {
        id: 'buy-axe',
        tags: ['acquire', 'buy', 'woodcutting', 'wc', 'tools'],
        script: 'Woodcutter',
        // Missing axe → Draynor bank (location bank) then Bob.
        start: SPOT.draynorBank,
        camp: SPOT.bob,
        settings: {
            treeName: 'Tree',
            location: 'Draynor (trees)',
            burnMode: 'Off',
            toolAcquire: 'Buy / repair',
            forgetfulBank: false,
            leashRadius: 12
        },
        purgeBank: { stand: SPOT.draynorBank, match: TOOL_RE.axe, label: 'axes@draynor' },
        // Bob tops out at Steel axe (200gp). Enough coins for that shop path only.
        seed: [{ debug: 'coins', name: 'Coins', qty: 500 }],
        scene: 'bank',
        budgetMs: 200_000,
        check: ({ cur, elapsedMs }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const boughtSteel = logHas(cur, /acquire:\s*bought\s+\d+×\s*Steel axe/i);
            const gotSteel = hasTool(cur, 'Steel axe');
            if (boughtSteel && gotSteel) {
                return 'pass';
            }
            if (boughtSteel && elapsedMs >= 30_000) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ cur }) =>
            `boughtSteel=${logHas(cur, /acquire:\s*bought\s+\d+×\s*Steel axe/i)} steelAxe=${hasTool(cur, 'Steel axe')} anyAxe=${hasAnyAxe(cur)} coins=${invCount(cur, 'Coins')} inv=${cur.inv.map(i => i.name).join(',') || 'empty'}`
    },
    {
        id: 'repair-axe-bob',
        tags: ['acquire', 'repair', 'woodcutting', 'wc', 'tools'],
        script: 'Woodcutter',
        // Broken steel-tier axe in pack → Draynor bank float → Bob item-on-NPC repair.
        // Debug obj is tiered (macro_broken_steel_hatchet); display name is always "Broken axe".
        start: SPOT.draynorBank,
        camp: SPOT.bob,
        settings: {
            treeName: 'Tree',
            location: 'Draynor (trees)',
            burnMode: 'Off',
            toolAcquire: 'Buy / repair',
            forgetfulBank: false,
            leashRadius: 12
        },
        purgeBank: { stand: SPOT.draynorBank, match: TOOL_RE.axe, label: 'axes@draynor' },
        // Steel broken axe repairs free at Bob (oc_cost 0); small coin float for bank withdraw path.
        seed: [
            { debug: 'macro_broken_steel_hatchet', name: 'Broken axe', qty: 1 },
            { debug: 'coins', name: 'Coins', qty: 1000 }
        ],
        scene: 'bank',
        budgetMs: 200_000,
        check: ({ cur, elapsedMs }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const repaired = logHas(cur, /acquire:\s*repaired\s+Broken axe\s+at\s+Bob/i);
            const started = logHas(cur, /acquire:\s*repair\s+Broken axe\s+via\s+Bob/i);
            const gotSteel = hasTool(cur, 'Steel axe');
            const stillBroken = hasTool(cur, 'Broken axe');
            if (repaired && gotSteel && !stillBroken) {
                return 'pass';
            }
            // Repair log is authoritative even if equip lagged a tick.
            if (repaired && !stillBroken) {
                return 'pass';
            }
            if (repaired && elapsedMs >= 30_000) {
                return 'pass';
            }
            if (started && gotSteel && !stillBroken) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ cur }) =>
            `repairedLog=${logHas(cur, /acquire:\s*repaired\s+Broken axe/i)} ` +
            `repairStart=${logHas(cur, /acquire:\s*repair\s+Broken axe/i)} ` +
            `steelAxe=${hasTool(cur, 'Steel axe')} broken=${hasTool(cur, 'Broken axe')} ` +
            `coins=${invCount(cur, 'Coins')} inv=${cur.inv.map(i => i.name).join(',') || 'empty'} ` +
            `worn=${cur.worn.join(',') || 'none'}`
    },
    {
        id: 'repair-pick-nurmof',
        tags: ['acquire', 'repair', 'mining', 'tools'],
        script: 'Miner',
        // Broken steel-tier pick → Fally East bank float → Nurmof hop + item-on-NPC repair.
        // Debug obj is tiered (macro_broken_steel_pickaxe); display name is always "Broken pickaxe".
        start: SPOT.faladorEast,
        camp: SPOT.nurmofHop,
        settings: {
            rocks: 'Copper',
            location: 'Dwarven Mine',
            toolAcquire: 'Buy / repair',
            forgetfulBank: false,
            leashRadius: 14
        },
        purgeBank: { stand: SPOT.faladorEast, match: TOOL_RE.pick, label: 'picks@fally-e' },
        // Steel broken pick costs 17gp at Nurmof; pad for bank withdrawCoinsFor(1000).
        seed: [
            { debug: 'macro_broken_steel_pickaxe', name: 'Broken pickaxe', qty: 1 },
            { debug: 'coins', name: 'Coins', qty: 1000 }
        ],
        scene: 'bank',
        budgetMs: 200_000,
        check: ({ cur, elapsedMs }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const repaired = logHas(cur, /acquire:\s*repaired\s+Broken pickaxe\s+at\s+Nurmof/i);
            const started = logHas(cur, /acquire:\s*repair\s+Broken pickaxe\s+via\s+Nurmof/i);
            const usablePick = logHas(cur, /acquire:\s*usable pick after\s+Nurmof\s+repair/i);
            const gotSteel = hasTool(cur, 'Steel pickaxe');
            const stillBroken = hasTool(cur, 'Broken pickaxe');
            if ((repaired || usablePick) && gotSteel && !stillBroken) {
                return 'pass';
            }
            if ((repaired || usablePick) && !stillBroken) {
                return 'pass';
            }
            if ((repaired || usablePick) && elapsedMs >= 30_000) {
                return 'pass';
            }
            if (started && gotSteel && !stillBroken) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ cur }) =>
            `repairedLog=${logHas(cur, /acquire:\s*repaired\s+Broken pickaxe/i)} ` +
            `repairStart=${logHas(cur, /acquire:\s*repair\s+Broken pickaxe/i)} ` +
            `steelPick=${hasTool(cur, 'Steel pickaxe')} broken=${hasTool(cur, 'Broken pickaxe')} ` +
            `coins=${invCount(cur, 'Coins')} inv=${cur.inv.map(i => i.name).join(',') || 'empty'} ` +
            `worn=${cur.worn.join(',') || 'none'}`
    },
    {
        id: 'buy-net',
        tags: ['acquire', 'buy', 'fishing', 'tools'],
        script: 'Fisher',
        // Missing net → Draynor bank then Gerrant (or Harry if closer — Gerrant for Draynor).
        start: SPOT.draynorBank,
        camp: SPOT.gerrant,
        settings: {
            fishMethod: 'Small net — shrimp/anchovy',
            location: 'Draynor Village',
            cookMode: 'Off',
            toolAcquire: 'Buy / repair',
            forgetfulBank: false,
            leashRadius: 18
        },
        purgeBank: { stand: SPOT.draynorBank, match: TOOL_RE.fishGear, label: 'fishgear@draynor' },
        seed: [{ debug: 'coins', name: 'Coins', qty: 1200 }],
        scene: 'bank',
        budgetMs: 200_000,
        check: ({ cur, elapsedMs }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const bought = logHas(cur, /acquire:\s*bought\s+\d+×\s*Small fishing net/i)
                || logHas(cur, /acquire:\s*bought\s+\d+×\s*.*net/i);
            const gotNet = invCount(cur, 'Small fishing net') > 0;
            if (bought && gotNet) {
                return 'pass';
            }
            if (bought && elapsedMs >= 30_000) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ cur }) =>
            `boughtLog=${logHas(cur, /acquire:\s*bought/i)} net=${invCount(cur, 'Small fishing net')} coins=${invCount(cur, 'Coins')}`
    },
    {
        id: 'restock-fly-barb',
        tags: ['acquire', 'buy', 'fishing', 'bait', 'restock', 'tools'],
        script: 'Fisher',
        // Gerrant banks at Draynor — start and purge there so the multi-buy fund trip is immediate.
        // Missing fly rod + feathers → one Draynor bank open → Gerrant multi-buy (rod + feathers, same shop visit) → barb river.
        start: SPOT.draynorBank,
        camp: SPOT.barbVillageFish,
        bank: SPOT.draynorBank,
        settings: {
            fishMethod: 'Fly fishing — trout/salmon',
            location: 'Barbarian Village',
            cookMode: 'Off',
            toolAcquire: 'Buy / repair',
            // Modest target so the feather buy finishes quickly in e2e.
            baitQty: 50,
            forgetfulBank: false,
            leashRadius: 18
        },
        purgeBank: { stand: SPOT.draynorBank, match: TOOL_RE.fishGear, label: 'fishgear@draynor' },
        // Fly rod 5gp + 50 feathers @ 2gp = 105gp; pad for path/repair float.
        seed: [{ debug: 'coins', name: 'Coins', qty: 3000 }],
        scene: 'bank',
        budgetMs: 240_000,
        check: ({ start, cur, minDistToCamp, startDistToCamp }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const boughtRod = logHas(cur, /acquire:\s*bought\s+\d+×\s*Fly fishing rod/i);
            const boughtFeather = logHas(cur, /acquire:\s*bought\s+\d+×\s*Feather/i);
            const gotRod = hasTool(cur, 'Fly fishing rod') || invCount(cur, 'Fly fishing rod') > 0;
            const gotFeather = invCount(cur, 'Feather') > 0;
            const fishXp = cur.xp.fishing - start.xp.fishing;
            const troutSalmon = invMatch(cur, /raw (trout|salmon)/i);
            const pathed = startDistToCamp >= 8 && minDistToCamp <= startDistToCamp - 5;
            const nearCamp = minDistToCamp <= 14;
            // Core: Gerrant sold both pieces and we left toward barb camp (or fished).
            // multiBuy/elapsed alone used to soft-PASS while stuck on Gerrant's tile.
            if (boughtRod && boughtFeather && gotRod && gotFeather) {
                if (nearCamp || pathed || fishXp > 0 || troutSalmon > 0) {
                    return 'pass';
                }
            }
            return 'wait';
        },
        failMsg: ({ start, cur, minDistToCamp }) =>
            `boughtRod=${logHas(cur, /acquire:\s*bought\s+\d+×\s*Fly fishing rod/i)} ` +
            `boughtFeather=${logHas(cur, /acquire:\s*bought\s+\d+×\s*Feather/i)} ` +
            `multiBuy=${logHas(cur, /acquire:\s*multi-buy/i)} ` +
            `rod=${invCount(cur, 'Fly fishing rod')} feather=${invCount(cur, 'Feather')} ` +
            `coins=${invCount(cur, 'Coins')} fishXpΔ=${cur.xp.fishing - start.xp.fishing} ` +
            `distCamp=${minDistToCamp} tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'} ` +
            `inv=${cur.inv.map(i => i.name).join(',') || 'empty'}`
    },
    // ── Auto freeform (start outside every preset 64×64 map square) ──────────
    {
        id: 'auto-freeform-wc-willows-cg',
        tags: ['freeform', 'auto', 'woodcutting', 'wc', 'early'],
        script: 'Woodcutter',
        // Willows NW of Crafting Guild — not same chunk as any WOODCUTTING_LOCATIONS spot.
        start: SPOT.willowsNwCg,
        camp: SPOT.willowsNwCg,
        settings: {
            treeName: 'Willow',
            location: 'Auto',
            burnMode: 'Off',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 40
        },
        seed: [{ debug: 'rune_axe', name: 'Rune axe', qty: 1 }],
        scene: 'skip',
        budgetMs: 180_000,
        check: ({ start, cur, minDistToCamp }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            // Named Auto snap would log "location: Draynor Willows (auto); bank …"
            if (logHas(cur, /location:\s*(Draynor|Seers|Edgeville|Gnome|Crafting)/i)) {
                return 'fail';
            }
            const freeform = logHas(cur, /location:\s*no preset\s*—\s*nearest bank/i);
            const xpGain = cur.xp.woodcutting - start.xp.woodcutting;
            const logs = invMatch(cur, /logs?/i);
            // Gather near start (not walking to a distant named camp).
            if (freeform && (xpGain > 0 || logs > 0) && minDistToCamp <= 40) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur, minDistToCamp }) =>
            `freeform=${logHas(cur, /location:\s*no preset/i)} ` +
            `namedSnap=${logHas(cur, /location:\s*(Draynor|Seers|Edgeville|Gnome)/i)} ` +
            `wcXpΔ=${cur.xp.woodcutting - start.xp.woodcutting} logs=${invMatch(cur, /logs?/i)} ` +
            `distStart=${minDistToCamp} tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'}`
    },
    {
        id: 'mine-wilderness-skeleton',
        tags: ['known-camp', 'auto', 'mining', 'mine', 'wildy'],
        script: 'Miner',
        // Auto now recognizes the Wilderness Skeleton Mine as a known coal camp.
        start: SPOT.skelMine,
        camp: SPOT.skelMine,
        settings: {
            rocks: 'Coal',
            location: 'Auto',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 40
        },
        seed: [{ debug: 'rune_pickaxe', name: 'Rune pickaxe', qty: 1 }],
        scene: 'skip',
        budgetMs: 200_000,
        check: ({ start, cur, minDistToCamp }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const selected = logHas(cur, /location:\s*Wilderness Skeleton Mine\s*\(auto\)/i);
            const xpGain = cur.xp.mining - start.xp.mining;
            // Coal is not "* ore"; count coal + any ore product.
            const haul = invMatch(cur, /^(coal|.+ ore)$/i);
            if (selected && (xpGain > 0 || haul > 0) && minDistToCamp <= 50) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur, minDistToCamp }) =>
            `selected=${logHas(cur, /location:\s*Wilderness Skeleton Mine\s*\(auto\)/i)} ` +
            `mineXpΔ=${cur.xp.mining - start.xp.mining} haul=${invMatch(cur, /^(coal|.+ ore)$/i)} ` +
            `distStart=${minDistToCamp} tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'}`
    },
    {
        id: 'mine-edgeville-dungeon',
        tags: ['known-camp', 'mining', 'mine', 'dungeon', 'edgeville'],
        script: 'Miner',
        start: SPOT.edgevilleDungeonMine,
        camp: SPOT.edgevilleDungeonMine,
        settings: {
            rocks: 'Coal',
            location: 'Edgeville Dungeon Mine',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 40
        },
        seed: [{ debug: 'rune_pickaxe', name: 'Rune pickaxe', qty: 1 }],
        scene: 'rocks',
        budgetMs: 200_000,
        check: ({ start, cur, minDistToCamp }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const selected = logHas(cur, /location:\s*Edgeville Dungeon Mine;/i);
            const xpGain = cur.xp.mining - start.xp.mining;
            const haul = invMatch(cur, /^(coal|.+ ore)$/i);
            if (selected && (xpGain > 0 || haul > 0) && minDistToCamp <= 50) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur, minDistToCamp }) =>
            `selected=${logHas(cur, /location:\s*Edgeville Dungeon Mine;/i)} ` +
            `mineXpΔ=${cur.xp.mining - start.xp.mining} haul=${invMatch(cur, /^(coal|.+ ore)$/i)} ` +
            `distStart=${minDistToCamp} tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'}`
    },
    {
        id: 'auto-freeform-fish-ardy-river',
        tags: ['freeform', 'auto', 'fishing', 'fish'],
        script: 'Fisher',
        // Ardougne river fly spots — outside every FISHING_LOCATIONS chunk.
        start: SPOT.ardyRiverFly,
        camp: SPOT.ardyRiverFly,
        settings: {
            fishMethod: 'Fly fishing — trout/salmon',
            location: 'Auto',
            cookMode: 'Off',
            toolAcquire: 'Off',
            baitQty: 100,
            forgetfulBank: false,
            leashRadius: 40
        },
        seed: [
            { debug: 'fly_fishing_rod', name: 'Fly fishing rod', qty: 1 },
            { debug: 'feather', name: 'Feather', qty: 100 }
        ],
        scene: 'skip',
        budgetMs: 180_000,
        check: ({ start, cur, minDistToCamp }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            if (logHas(cur, /location:\s*(Fishing Guild|Barbarian|Catherby|Draynor|Seers)/i)) {
                return 'fail';
            }
            const freeform = logHas(cur, /location:\s*no preset\s*—\s*nearest bank/i);
            const xpGain = cur.xp.fishing - start.xp.fishing;
            const fish = invMatch(cur, /raw (trout|salmon)/i);
            if (freeform && (xpGain > 0 || fish > 0) && minDistToCamp <= 40) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur, minDistToCamp }) =>
            `freeform=${logHas(cur, /location:\s*no preset/i)} ` +
            `namedSnap=${logHas(cur, /location:\s*(Fishing Guild|Barbarian|Catherby|Draynor)/i)} ` +
            `fishXpΔ=${cur.xp.fishing - start.xp.fishing} raw=${invMatch(cur, /raw (trout|salmon)/i)} ` +
            `distStart=${minDistToCamp} tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'}`
    },
    {
        id: 'smith-rune-axe',
        tags: ['acquire', 'smith', 'woodcutting', 'wc', 'tools', 'endgame'],
        script: 'Woodcutter',
        // Materials live in Varrock West bank, so the script must open the bank, withdraw, then walk to the anvil.
        // Location stays Draynor so the camp bankStand is far and the nearby-bank preference has to snap to Varrock West underfoot.
        start: SPOT.varrockWestBank,
        camp: SPOT.varrockAnvil,
        settings: {
            treeName: 'Tree',
            location: 'Draynor (trees)',
            burnMode: 'Off',
            toolAcquire: 'Buy / repair',
            forgetfulBank: false,
            leashRadius: 12
        },
        purgeBank: { stand: SPOT.varrockWestBank, match: TOOL_RE.axe, label: 'axes@varrock-w' },
        // Bank mats via givebank so restock must withdraw (not materials-held short-circuit).
        bankSeed: {
            stand: SPOT.varrockWestBank,
            items: [
                { debugName: 'hammer', displayName: 'Hammer', qty: 1 },
                { debugName: 'runite_bar', displayName: 'Runite bar', qty: 1 }
            ]
        },
        scene: 'bank',
        budgetMs: 210_000,
        check: ({ cur }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const smithed = logHas(cur, /acquire:\s*smithed\s+Rune axe/i);
            const gotRune = hasTool(cur, 'Rune axe') || invCount(cur, 'Rune axe') > 0;
            const equippedLog = logHas(cur, /equipped\s+Rune axe/i);
            // Why: the smithed log alone soft-PASSes on an equip failure, so the axe must be held or wielded.
            if (smithed && gotRune) {
                return 'pass';
            }
            if (smithed && equippedLog) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ cur }) =>
            `smithedLog=${logHas(cur, /acquire:\s*smithed/i)} equippedLog=${logHas(cur, /equipped\s+Rune axe/i)} runeAxe=${hasTool(cur, 'Rune axe')} invAxe=${invCount(cur, 'Rune axe')} bar=${invCount(cur, 'Runite bar')} hammer=${invCount(cur, 'Hammer')} inv=${cur.inv.map(i => i.name).join(',') || 'empty'}`
    }
];

function wantScenario(s: Scenario): boolean {
    if (filters.length === 0) {
        return true;
    }
    return filters.some(f => f === 'all' || s.id === f || s.tags.includes(f) || s.script.toLowerCase() === f);
}

// ── run ──────────────────────────────────────────────────────────────────────

const selected = SCENARIOS.filter(wantScenario);
if (selected.length === 0) {
    failHard(
        `no scenarios match [${filters.join(', ')}]. ids: ${SCENARIOS.map(s => s.id).join(', ')}`
    );
}

console.log(`gatheringbot-test base=${base} user=${USER} scenarios=${selected.map(s => s.id).join(',')}`);
console.log(`per-scenario budget ≈ ${Math.round(PER_SCENARIO_MS / 1000)}s (override with BUDGET_S=)`);

const browser = await launchBrowser({ swiftshader: true });
const results: { id: string; ok: boolean; detail: string; ms: number }[] = [];

try {
    const page = await browser.newPage();
    const t0 = Date.now();
    const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]') && /error|fail|park|PARKED/i.test(txt)) {
            console.log(`  ${stamp()} ${txt.slice(0, 200)}`);
        }
    });

    await mainlandAccount(page, base, USER);
    console.log(`${stamp()} mainland-ready as '${USER}'`);

    // Why: early zones (Draynor jail guard) kill a low-HP bot stuck behind "Congratulations, you advanced…", so max once and drain the chat before any tele/seed/start.
    console.log(`${stamp()} base stats → 99 (maxme + clear dialogs)`);
    await maxAccountAndClearDialogs(page);

    // Registry sanity — scripts must be present in the deployed client.
    const names = await page.evaluate(() => {
        const r = (globalThis as never as Abi).rs2b0t.registry;
        return ['Miner', 'Fisher', 'Woodcutter'].map(n => `${n}=${r.get(n) ? 'ok' : 'MISSING'}`);
    });
    console.log(`${stamp()} registry ${names.join(' ')}`);
    if (names.some(n => n.includes('MISSING'))) {
        failHard('script registry missing Miner/Fisher/Woodcutter — redeploy bot client');
    }

    for (const sc of selected) {
        const scStart = Date.now();
        console.log(`\n══ ${sc.id} (${sc.script}) ══`);
        try {
            await stopScript(page);
            // Drain any leftover level-up / NPC chat before tele into danger zones.
            await clearChatDialogs(page);
            await clearInv(page);

            // Isolate bank tools so acquire cannot withdraw leftovers from prior runs.
            if (sc.purgeBank) {
                await purgeBankTools(page, sc.purgeBank.stand, sc.purgeBank.match, sc.purgeBank.label);
            }

            // Bank fixtures first (givebank) so pack never holds bulk stackables.
            if (sc.bankSeed) {
                console.log(
                    `  bankSeed @ (${sc.bankSeed.stand.x},${sc.bankSeed.stand.z}): ` +
                        sc.bankSeed.items.map(i => `${i.debugName}×${i.qty}`).join(', ')
                );
                await seedItemsToBank(page, sc.bankSeed.items, sc.bankSeed.stand);
            }
            // Held gear / near-full pack AFTER bank seed (same lesson as firegiant-test).
            for (const it of sc.seed ?? []) {
                await seedItem(page, it.debug, it.name, it.qty ?? 1);
                console.log(`  seeded ${it.qty ?? 1}x ${it.name}`);
            }
            // Legacy give→deposit path (prefer bankSeed for new scenarios).
            if (sc.depositSeedToBank) {
                await depositHeldToBank(
                    page,
                    sc.depositSeedToBank.stand,
                    sc.depositSeedToBank.names,
                    sc.depositSeedToBank.label
                );
            }
            for (const it of sc.seedAfterDeposit ?? []) {
                await seedItem(page, it.debug, it.name, it.qty ?? 1);
                console.log(`  seeded after deposit ${it.qty ?? 1}x ${it.name}`);
            }
            // Already-met levels (99 from BASE_STATS) are skipped.
            await grantStats(page, sc.stats ?? []);
            await clearChatDialogs(page);

            // Acquire tests must not already hold the tool after purge+seed.
            if (
                sc.id.startsWith('buy-')
                || sc.id.startsWith('repair-')
                || sc.id === 'smith-rune-axe'
                || sc.id === 'restock-fly-barb'
                || sc.id === 'fish-bank-raw-cook'
            ) {
                const pre = await snap(page);
                if ((sc.id === 'buy-pick') && hasAnyPick(pre)) {
                    throw new Error('precondition: already holding a pickaxe after purge');
                }
                if ((sc.id === 'buy-axe' || sc.id === 'smith-rune-axe') && hasAnyAxe(pre)) {
                    throw new Error('precondition: already holding an axe after purge');
                }
                if (sc.id === 'repair-axe-bob') {
                    if (invCount(pre, 'Broken axe') < 1 && !hasTool(pre, 'Broken axe')) {
                        throw new Error('precondition: no Broken axe after seed');
                    }
                    // Usable axes would skip repair; broken-only pack is required.
                    const usableAxe = pre.inv.some(i => /\baxe\b/i.test(i.name) && !/broken/i.test(i.name) && !/pickaxe/i.test(i.name))
                        || pre.worn.some(w => /\baxe\b/i.test(w) && !/broken/i.test(w) && !/pickaxe/i.test(w));
                    if (usableAxe) {
                        throw new Error('precondition: usable axe present after purge+seed (would skip Bob repair)');
                    }
                    if (invCount(pre, 'Coins') < 1) {
                        throw new Error(`precondition: need coins for repair float (have ${invCount(pre, 'Coins')})`);
                    }
                }
                if (sc.id === 'repair-pick-nurmof') {
                    if (invCount(pre, 'Broken pickaxe') < 1 && !hasTool(pre, 'Broken pickaxe')) {
                        throw new Error('precondition: no Broken pickaxe after seed');
                    }
                    const usablePick = pre.inv.some(i => /pickaxe/i.test(i.name) && !/broken/i.test(i.name))
                        || pre.worn.some(w => /pickaxe/i.test(w) && !/broken/i.test(w));
                    if (usablePick) {
                        throw new Error('precondition: usable pick present after purge+seed (would skip Nurmof repair)');
                    }
                    if (invCount(pre, 'Coins') < 17) {
                        throw new Error(`precondition: need ≥17gp for steel pick repair (have ${invCount(pre, 'Coins')})`);
                    }
                }
                if (sc.id === 'buy-net' && invCount(pre, 'Small fishing net') > 0) {
                    throw new Error('precondition: already holding a net after purge');
                }
                if (sc.id === 'restock-fly-barb') {
                    if (invCount(pre, 'Fly fishing rod') > 0 || hasTool(pre, 'Fly fishing rod')) {
                        throw new Error('precondition: already holding a fly fishing rod after purge');
                    }
                    if (invCount(pre, 'Feather') > 0) {
                        throw new Error('precondition: already holding feathers after purge');
                    }
                    if (invCount(pre, 'Coins') < 200) {
                        throw new Error(`precondition: need coins for rod+feathers (have ${invCount(pre, 'Coins')})`);
                    }
                }
                if (sc.id === 'buy-pick' && invCount(pre, 'Coins') < 32_000) {
                    throw new Error(`precondition: need 32000 coins after seed (have ${invCount(pre, 'Coins')})`);
                }
                if (sc.id.startsWith('buy-') && sc.id !== 'buy-pick' && invCount(pre, 'Coins') < 1) {
                    throw new Error('precondition: no coins after seed');
                }
                if (sc.id === 'smith-rune-axe') {
                    // Mats live in bank only — pack empty so restock must withdraw.
                    if (invCount(pre, 'Runite bar') > 0 || invCount(pre, 'Hammer') > 0) {
                        throw new Error(
                            'precondition: hammer/bar still in pack after bankSeed ' +
                                `(bar=${invCount(pre, 'Runite bar')} hammer=${invCount(pre, 'Hammer')})`
                        );
                    }
                    if (hasAnyAxe(pre)) {
                        throw new Error('precondition: already holding an axe after purge+bankSeed');
                    }
                }
                if (sc.id === 'fish-bank-raw-cook') {
                    if (invCount(pre, 'Lobster pot') < 1) {
                        throw new Error('precondition: need Lobster pot after inv seed');
                    }
                    if (invCount(pre, 'Raw lobster') < 26) {
                        throw new Error(
                            `precondition: need 26 Raw lobster in pack (have ${invCount(pre, 'Raw lobster')})`
                        );
                    }
                    // One free slot so the last catch can fill the pack.
                    if (pre.free < 1) {
                        throw new Error(`precondition: need ≥1 free inv slot (free=${pre.free})`);
                    }
                }
            }

            const arrived = await teleArrive(page, sc.start);
            if (!arrived) {
                const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
                throw new Error(`tele to ${sc.start.x},${sc.start.z} failed (at ${t ? `${t.x},${t.z},${t.level}` : '?'})`);
            }
            console.log(`  arrived near ${sc.start.x},${sc.start.z}${sc.camp ? ` (camp ${sc.camp.x},${sc.camp.z})` : ''}`);

            const expect = sc.scene ?? 'skip';
            if (expect !== 'skip') {
                await waitSceneReady(page, expect, {
                    radius: Math.max(14, Number(sc.settings.leashRadius) || 12),
                    label: `${sc.id}/${expect}`
                });
                console.log(`  scene ready (${expect})`);
            } else {
                // Brief settle so tele zone finishes streaming before script start.
                await page.waitForTimeout(700);
            }

            await setSettings(page, sc.script, sc.settings);
            const applied = await page.evaluate(name => {
                const keys = [
                    'rocks',
                    'treeName',
                    'fishMethod',
                    'location',
                    'leashRadius',
                    'toolAcquire',
                    'muleMode',
                    'mulePartner'
                ];
                const out: Record<string, string | null> = {};
                for (const k of keys) {
                    out[k] = sessionStorage.getItem(`rs2b0t:set:${name}:${k}`);
                }
                return out;
            }, sc.script);
            console.log(`  settings ${JSON.stringify(applied)}`);
            await startScript(page, sc.script);
            console.log(`  started ${sc.script}`);

            const start = await snap(page);
            const startDistToCamp = start.tile && sc.camp ? chebyshev(start.tile, sc.camp) : 0;
            let minDistToCamp = startDistToCamp;
            let maxDistToCamp = startDistToCamp;
            let minDistToBank = start.tile && sc.bank ? chebyshev(start.tile, sc.bank) : 999;
            // Post-bank home (#154): only count camp approach after deposit signals.
            // Soft arrive disk is 8; allow a little pier slack so path end still counts.
            const CAMP_HOME_AFTER_BANK = 12;
            let returnedToCampAfterBank = false;
            let minDistToCampAfterBank = 999;
            let lastLog = 0;
            let sawProduct = false;
            let productPeak = 0;
            let bankedHint = false;
            let sawNearBank = false;
            let prevProduct = 0;
            const budget = sc.budgetMs ?? PER_SCENARIO_MS;
            let outcome: 'pass' | 'fail' = 'fail';
            let detail = '';

            while (Date.now() - scStart < budget) {
                await page.waitForTimeout(4000);
                const cur = await snap(page);
                lastLog = printNewLogs(cur, lastLog, stamp);

                if (cur.tile && sc.camp) {
                    const d = chebyshev(cur.tile, sc.camp);
                    if (d < minDistToCamp) {
                        minDistToCamp = d;
                    }
                    if (d > maxDistToCamp) {
                        maxDistToCamp = d;
                    }
                }
                let distToBank = 999;
                if (cur.tile && sc.bank) {
                    const dBank = chebyshev(cur.tile, sc.bank);
                    distToBank = dBank;
                    if (dBank < minDistToBank) {
                        minDistToBank = dBank;
                    }
                }

                // fish-cook-* seeds cooked catch, so track cooked+raw to keep productPeak / near-bank / bankedHint firing on deposit (the product keywords are raw-only).
                // fish-bank-raw-cook tracks raw lobster through the bank trip.
                const product =
                    sc.id === 'fish-cook-bank' || sc.id === 'fish-cooker-solo'
                        ? invMatch(cur, /^(raw )?lobster$/i)
                        : sc.id === 'fish-cook-barb' || sc.id === 'fish-cook-seers'
                            ? invMatch(cur, /^(raw )?(trout|salmon)$/i)
                            : sc.id === 'fish-bank-raw-cook'
                                ? invMatch(cur, /^raw lobster$/i)
                                : sc.script === 'Miner'
                                    ? invMatch(cur, /ore/i)
                                    : sc.script === 'Fisher'
                                        ? invMatch(cur, /^raw /i)
                                        : invMatch(cur, /logs/i);
                if (product > 0) {
                    sawProduct = true;
                }
                if (product > productPeak) {
                    productPeak = product;
                }
                // Why: deposit can clear the pack between 4s snaps and Draynor trees sit on the bank disk, so near-bank reads productPeak rather than the live product (wc-bank).
                if (
                    cur.tile
                    && sc.bank
                    && productPeak >= 10
                    && chebyshev(cur.tile, sc.bank) <= 10
                ) {
                    sawNearBank = true;
                }
                // Deposit log + we were at/near bank this run.
                if (logHas(cur, /bank:\s*deposited/i) && minDistToBank <= 14) {
                    sawNearBank = true;
                    bankedHint = true;
                }
                const gatherXp =
                    cur.xp.mining + cur.xp.fishing + cur.xp.woodcutting
                    > start.xp.mining + start.xp.fishing + start.xp.woodcutting;
                const cookXpUp = cur.xp.cooking > start.xp.cooking;
                const isCookScenario = /^fish-cook/.test(sc.id) || sc.id === 'fish-cooker-solo';
                if (
                    prevProduct >= 3
                    && product < prevProduct - 1
                    && (gatherXp || (isCookScenario && cookXpUp))
                ) {
                    bankedHint = true;
                }
                // Deposit log is authoritative (cooked banked even if peak tracking misses).
                if (logHas(cur, /bank:\s*deposited/i)) {
                    bankedHint = true;
                }
                prevProduct = product;

                // After deposit at bank, require a live walk back toward camp resources.
                // Do not use overall minDistToCamp — start tile is already near camp.
                if (bankedHint && sawNearBank && cur.tile && sc.camp) {
                    const dCamp = chebyshev(cur.tile, sc.camp);
                    if (dCamp < minDistToCampAfterBank) {
                        minDistToCampAfterBank = dCamp;
                    }
                    if (dCamp <= CAMP_HOME_AFTER_BANK) {
                        returnedToCampAfterBank = true;
                    }
                }

                const elapsedMs = Date.now() - scStart;
                const checkCtx = {
                    start,
                    cur,
                    elapsedMs,
                    sawProduct,
                    productPeak,
                    bankedHint,
                    sawNearBank,
                    returnedToCampAfterBank,
                    minDistToCampAfterBank,
                    minDistToCamp,
                    maxDistToCamp,
                    minDistToBank,
                    distToBank,
                    startDistToCamp
                };
                const failCtx = {
                    start,
                    cur,
                    minDistToCamp,
                    maxDistToCamp,
                    minDistToBank,
                    distToBank,
                    minDistToCampAfterBank,
                    productPeak,
                    bankedHint,
                    sawNearBank,
                    returnedToCampAfterBank
                };
                const verdict = sc.check(checkCtx);
                if (verdict === 'pass') {
                    outcome = 'pass';
                    detail =
                        `xpΔ m/f/w/c/fm/sm=${cur.xp.mining - start.xp.mining}/${cur.xp.fishing - start.xp.fishing}/` +
                        `${cur.xp.woodcutting - start.xp.woodcutting}/${cur.xp.cooking - start.xp.cooking}/` +
                        `${cur.xp.firemaking - start.xp.firemaking}/${cur.xp.smithing - start.xp.smithing} ` +
                        `productPeak=${productPeak} distCamp ${startDistToCamp}→${minDistToCamp}` +
                        (sc.bank
                            ? ` distBank→${minDistToBank} nearBank=${sawNearBank}` +
                              ` homeAfterBank=${returnedToCampAfterBank} distCampAfterBank→${minDistToCampAfterBank}`
                            : '') +
                        ` tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'}`;
                    break;
                }
                if (verdict === 'fail') {
                    outcome = 'fail';
                    detail = sc.failMsg?.(failCtx) ?? `runner=${cur.runner}`;
                    break;
                }
                if (cur.runner === 'stopped' || cur.runner === 'crashed') {
                    const again = sc.check(checkCtx);
                    if (again === 'pass') {
                        outcome = 'pass';
                        detail =
                            `stopped ok; productPeak=${productPeak} distCamp→${minDistToCamp}` +
                            (sc.bank
                                ? ` distBank→${minDistToBank} homeAfterBank=${returnedToCampAfterBank}` +
                                  ` distCampAfterBank→${minDistToCampAfterBank}`
                                : '');
                    } else {
                        outcome = 'fail';
                        detail = `runner ${cur.runner}; ${sc.failMsg?.(failCtx) ?? ''}`;
                    }
                    break;
                }
            }

            if (outcome !== 'pass' && Date.now() - scStart >= budget) {
                const cur = await snap(page);
                const distToBank =
                    cur.tile && sc.bank ? chebyshev(cur.tile, sc.bank) : 999;
                outcome = 'fail';
                detail =
                    `timeout; ${
                        sc.failMsg?.({
                            start,
                            cur,
                            minDistToCamp,
                            maxDistToCamp,
                            minDistToBank,
                            distToBank,
                            minDistToCampAfterBank,
                            productPeak,
                            bankedHint,
                            sawNearBank,
                            returnedToCampAfterBank
                        }) ?? ''
                    }`;
            }

            await stopScript(page);
            const ms = Date.now() - scStart;
            results.push({ id: sc.id, ok: outcome === 'pass', detail, ms });
            console.log(`${outcome === 'pass' ? 'PASS' : 'FAIL'} ${sc.id} (${Math.round(ms / 1000)}s) ${detail}`);
        } catch (e) {
            await stopScript(page).catch(() => undefined);
            const ms = Date.now() - scStart;
            const detail = e instanceof Error ? e.message : String(e);
            results.push({ id: sc.id, ok: false, detail, ms });
            console.log(`FAIL ${sc.id} (${Math.round(ms / 1000)}s) ${detail}`);
        }
    }
} finally {
    await browser.close();
}

console.log('\n── summary ──');
for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(16)} ${Math.round(r.ms / 1000)}s  ${r.detail}`);
}
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
    process.exit(1);
}
console.log('PASS');
