// RuneCrafter multibox e2e: 1 Mule Recipient + N Runners (default 20) in ONE
// multibox wall page — the issue-#209 acceptance test at scale.
// Phase 1 preps each account on a throwaway page (tutorial skip, maxme, seed,
// tele, logout) — server-side state persists, so STAMP=<tag> PREP=0 reuses them.
// Phase 2 opens multibox.html, presets each box's settings, adds every account,
// waits for the staggered logins, then controller.startAll() and soaks.
// Usage: bun tools/runecrafter-multibox-test.ts [base] [budget-min] [num-runners] [rune]

import type { Browser, Page } from 'playwright-core';
import { launchBrowser, parseArgs, cheatQuiet, fail, setSettings, type } from './lib/harness.js';
import { mainlandAccount } from './tutorial/harness.js';

// parseArgs folds every numeric arg into `minutes`, so split budget/count ourselves
const argv = process.argv.slice(2);
const { base } = parseArgs(argv.filter(a => a.includes('://')), { base: process.env.BASE ?? 'http://localhost:8891' });
const nums = argv.filter(a => a.trim() !== '' && Number.isFinite(Number(a))).map(Number);
const words = argv.filter(a => !a.includes('://') && !(a.trim() !== '' && Number.isFinite(Number(a))));
const budgetMin = nums[0] || 8;
const NUM_RUNNERS = nums[1] || 20;
const RUNE = words[0] || 'Air runes';
const SHOT_DIR = process.env.SHOT_DIR || '';
const PREP = process.env.PREP !== '0';
const PREP_CONCURRENCY = Number(process.env.PREP_CONCURRENCY) || 3;

interface RuneRoute {
    talisman: string;
    runeName: string;
    xpPerEssence: number;
    bank: { x: number; z: number; level: number };
    ruins: { x: number; z: number; level: number };
}

const ROUTES: Record<string, RuneRoute> = {
    'Air runes': {
        talisman: 'air_talisman', runeName: 'air rune', xpPerEssence: 5,
        bank: { x: 3013, z: 3355, level: 0 },
        ruins: { x: 2988, z: 3294, level: 0 }
    },
    'Earth runes': {
        talisman: 'earth_talisman', runeName: 'earth rune', xpPerEssence: 6.5,
        bank: { x: 3253, z: 3420, level: 0 },
        ruins: { x: 3303, z: 3477, level: 0 }
    }
};

const route = ROUTES[RUNE];
if (!route) { fail(`unknown rune '${RUNE}' — expected one of: ${Object.keys(ROUTES).join(', ')}`); }

const stamp = process.env.STAMP || Date.now().toString(36).slice(-5);
const M_USER = `mbm${stamp}`;
const R_USERS = Array.from({ length: NUM_RUNNERS }, (_, i) => `mbr${i}${stamp}`);

// ── prep helpers (same cheats as runecrafter-test.ts, one page per account) ──

type Tile = { x: number; z: number; level: number };

type Abi = {
    __rs2b0t: {
        Inventory: { items(): { name: string | null; id: number; count: number }[] };
        Skills: { xp(s: string): number };
        reader: { worldTile(): Tile | null };
    };
    rs2b0t: {
        client: { logout(): Promise<void> };
        runner: { state: string };
        reader: {
            modals(): { main: number; side: number; chat: number };
            chatContinueComId(): number;
            chatOptions(): { text: string; comId: number }[];
        };
        actions: { continueDialog(): boolean; ifButton(comId: number): boolean };
    };
};

function chebyshev(a: Tile, b: Tile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

async function teleArrive(page: Page, spot: Tile, maxDist = 18): Promise<boolean> {
    const cmd = `tele ${spot.level},${spot.x >> 6},${spot.z >> 6},${spot.x & 63},${spot.z & 63}`;
    for (let attempt = 0; attempt < 4; attempt++) {
        await cheatQuiet(page, cmd);
        for (let poll = 0; poll < 12; poll++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && t.level === spot.level && chebyshev(t, spot) <= maxDist) {
                await page.waitForTimeout(600);
                return true;
            }
            await page.waitForTimeout(350);
        }
    }
    return false;
}

async function countInvItem(page: Page, name: string): Promise<number> {
    return page.evaluate(n => {
        const items = (globalThis as never as Abi).__rs2b0t.Inventory.items();
        return items.filter(i => (i.name ?? '').toLowerCase() === n.toLowerCase()).reduce((s, i) => s + Math.max(1, i.count), 0);
    }, name);
}

async function seedItem(page: Page, debugName: string, displayName: string, qty = 1): Promise<void> {
    for (let i = 0; i < 8; i++) {
        if (!(await cheatQuiet(page, `give ${debugName} ${qty}`))) throw new Error(`give not sent for ${displayName}`);
        for (let poll = 0; poll < 4; poll++) {
            if ((await countInvItem(page, displayName)) >= qty) return;
            await page.waitForTimeout(250);
        }
    }
    throw new Error(`could not seed ${displayName}`);
}

async function clearInv(page: Page): Promise<void> {
    for (let i = 0; i < 6; i++) {
        if (!(await cheatQuiet(page, '~clearinv'))) throw new Error('~clearinv not sent');
        await page.waitForTimeout(700);
        const left = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Inventory.items().filter(i => i.name).length);
        if (left === 0) return;
    }
}

async function clearChatDialogs(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const { actions, reader } = (globalThis as never as Abi).rs2b0t;
        let quiet = 0;
        for (let i = 0; i < 120; i++) {
            const chatOpen = reader.modals().chat !== -1;
            const canContinue = reader.chatContinueComId() !== -1;
            const opts = reader.chatOptions();
            if (!chatOpen && !canContinue && opts.length === 0) {
                quiet++;
                if (quiet >= 4) break;
                await new Promise(r => setTimeout(r, 200));
                continue;
            }
            quiet = 0;
            if (canContinue) { actions.continueDialog(); }
            else if (opts.length > 0) { actions.ifButton(opts[0]!.comId); }
            await new Promise(r => setTimeout(r, 250));
        }
    });
}

async function maxAccount(page: Page): Promise<void> {
    if (await cheatQuiet(page, '~maxme')) {
        await page.waitForFunction(
            () => (globalThis as never as Abi).__rs2b0t.Skills.xp('attack') >= 13_000_000,
            undefined,
            { timeout: 45_000 }
        ).catch(() => undefined);
    }
    await clearChatDialogs(page);
    await page.waitForTimeout(1200);
    await clearChatDialogs(page);
}

async function prepAccount(browser: Browser, user: string, kind: 'recipient' | 'runner'): Promise<void> {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
        await mainlandAccount(page, base, user);
        await maxAccount(page);
        await clearInv(page);
        if (kind === 'recipient') {
            await seedItem(page, route.talisman, route.talisman.replace(/_/g, ' '), 1);
        } else {
            // typed ::give path so the cert (noted essence) stacks; the runner's first
            // restock deposits it, giving the account a bank to draw 26s from
            await type(page, '::give cert_blankrune 1000');
            if ((await countInvItem(page, 'rune essence')) === 0) throw new Error(`${user}: cert_blankrune seed did not land`);
        }
        // settings are per-box (= per-account) in the wall, but bot.html's plain
        // namespace is what a solo relaunch would read — set both to be safe
        await setSettings(page, 'RuneCrafter', kind === 'recipient'
            ? { rune: RUNE, mode: 'Mule Recipient', partner: '' }
            : { rune: RUNE, mode: 'Runner', partner: M_USER });
        const spot = kind === 'recipient' ? route.ruins : route.bank;
        if (!(await teleArrive(page, spot))) throw new Error(`${user}: could not teleport to start spot`);
        await page.evaluate(() => (globalThis as never as Abi).rs2b0t.client.logout()).catch(() => undefined);
        await page.waitForTimeout(1200);
        console.log(`  prepped ${user} (${kind})`);
    } finally {
        await ctx.close();
    }
}

// ── multibox wall driving ────────────────────────────────────────────────────

type Mbx = {
    multibox: {
        controller: { startAll(): void; stopAll(): void; setAllRenderers(on: boolean): void };
        add(a: { username: string; password: string }): unknown;
        focus(id: number): void;
        slots(): { id: number; username: string; ingame: boolean; scriptState?: string }[];
    };
};

type SlotSample = {
    box: string | null;
    state: string;
    ess: number;
    runes: number;
    rcXp: number;
    pos: Tile | null;
    lastLog: string;
    stopReason: string;
};

function sampleWall(page: Page): Promise<SlotSample[]> {
    return page.evaluate(rn => {
        return Array.from(document.querySelectorAll('iframe')).map(f => {
            const el = f as HTMLIFrameElement;
            const box = new URL(el.src).searchParams.get('box');
            const w = el.contentWindow as never as Abi & { rs2b0t?: { runner?: { state: string; ctx?: { log?: { msg: string }[] } } } };
            if (!w || !w.__rs2b0t || !w.rs2b0t?.runner) {
                return { box, state: 'booting', ess: 0, runes: 0, rcXp: 0, pos: null, lastLog: '', stopReason: '' };
            }
            const items = w.__rs2b0t.Inventory.items();
            const msgs = (w.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg);
            return {
                box,
                state: w.rs2b0t.runner.state,
                ess: items.filter(i => (i.name ?? '').toLowerCase() === 'rune essence').reduce((s, i) => s + Math.max(1, i.count), 0),
                runes: items.filter(i => (i.name ?? '').toLowerCase() === rn).reduce((s, i) => s + Math.max(1, i.count), 0),
                rcXp: w.__rs2b0t.Skills.xp('runecraft'),
                pos: w.__rs2b0t.reader.worldTile(),
                lastLog: (msgs[msgs.length - 1] ?? '').slice(0, 48),
                stopReason: msgs.filter(m => /Stopping\.|crashed/i.test(m)).slice(-1)[0] ?? ''
            };
        });
    }, route.runeName);
}

async function shot(page: Page, name: string): Promise<void> {
    if (!SHOT_DIR) return;
    try {
        await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
    } catch { /* evidence only */ }
}

// ── main ─────────────────────────────────────────────────────────────────────

const browser = await launchBrowser({ swiftshader: true });
try {
    if (PREP) {
        console.log(`prepping ${1 + NUM_RUNNERS} accounts (stamp ${stamp}, concurrency ${PREP_CONCURRENCY})...`);
        await prepAccount(browser, M_USER, 'recipient');
        const queue = [...R_USERS];
        const workers = Array.from({ length: Math.min(PREP_CONCURRENCY, queue.length) }, async () => {
            for (let u = queue.shift(); u; u = queue.shift()) {
                await prepAccount(browser, u, 'runner');
            }
        });
        await Promise.all(workers);
        console.log(`all ${1 + NUM_RUNNERS} accounts prepped\n`);
    } else {
        console.log(`PREP=0 — reusing accounts with stamp '${stamp}'`);
    }

    // tall viewport so screenshots show a long run of rail tiles, not just 4 slots
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 2000 } })).newPage();
    page.on('pageerror', e => console.log(`[wall] pageerror: ${e}`));
    await page.goto(`${base}/multibox.html?nodeid=10`);
    await page.waitForFunction(() => Boolean((globalThis as never as Mbx).multibox), undefined, { timeout: 30_000 });
    console.log('multibox wall booted');

    // per-box settings live in the tab's shared sessionStorage under rs2b0t:<box>:…
    await page.evaluate(([users, recipient, rune]) => {
        const put = (k: string, v: string) => { sessionStorage.setItem(k, v); try { localStorage.setItem(k, v); } catch { /* full */ } };
        for (const u of users) {
            const isRecipient = u === recipient;
            put(`rs2b0t:${u}:selectedScript`, 'RuneCrafter');
            put(`rs2b0t:${u}:set:RuneCrafter:rune`, rune);
            put(`rs2b0t:${u}:set:RuneCrafter:mode`, isRecipient ? 'Mule Recipient' : 'Runner');
            put(`rs2b0t:${u}:set:RuneCrafter:partner`, isRecipient ? '' : recipient);
        }
    }, [[M_USER, ...R_USERS], M_USER, RUNE] as const);

    // 21 SwiftShader clients can't boot at once — add in waves, renderers off, and
    // let each wave reach the title loop before spawning the next
    const all = [M_USER, ...R_USERS];
    for (let i = 0; i < all.length; i += 4) {
        for (const u of all.slice(i, i + 4)) {
            await page.evaluate(user => { (globalThis as never as Mbx).multibox.add({ username: user, password: 'test' }); }, u);
        }
        await page.evaluate(() => (globalThis as never as Mbx).multibox.controller.setAllRenderers(false));
        const target = Math.min(i + 4, all.length);
        await page.waitForFunction(n => {
            const frames = Array.from(document.querySelectorAll('iframe'));
            return frames.filter(f => (((f as HTMLIFrameElement).contentWindow as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } })?.rs2b0t?.client.constructor.loopCycle ?? 0) > 10).length >= n;
        }, target, { timeout: 180_000 }).catch(() => undefined);
        console.log(`  ${target}/${all.length} clients booted`);
    }
    console.log(`${1 + NUM_RUNNERS} slots added — waiting for the staggered logins...`);

    const allIn = await page.waitForFunction(
        n => (globalThis as never as Mbx).multibox.slots().filter(s => s.ingame).length >= n,
        1 + NUM_RUNNERS,
        { timeout: 420_000 }
    ).then(() => true).catch(() => false);
    const ingameNow = (await page.evaluate(() => (globalThis as never as Mbx).multibox.slots())).filter(s => s.ingame).length;
    if (!allIn) {
        const states = await page.evaluate(() => Array.from(document.querySelectorAll('iframe')).map(f => {
            const el = f as HTMLIFrameElement;
            const w = el.contentWindow as never as { rs2b0t?: { client: { ingame: boolean; loginMessage?: string; constructor: { loopCycle: number } } } };
            const c = w?.rs2b0t?.client;
            return `${new URL(el.src).searchParams.get('box')}: ${c ? `ingame=${c.ingame} loop=${c.constructor.loopCycle} msg='${c.loginMessage ?? ''}'` : 'no client'}`;
        }));
        console.log(states.join('\n'));
        fail(`only ${ingameNow}/${1 + NUM_RUNNERS} slots reached ingame within 7min`);
    }
    console.log(`all ${ingameNow} slots ingame — starting every script`);

    await page.evaluate(() => (globalThis as never as Mbx).multibox.controller.startAll());
    await page.evaluate(() => (globalThis as never as Mbx).multibox.controller.setAllRenderers(true));
    // keep the recipient (first slot) in the focused pane so screenshots show its paint
    await page.evaluate(() => (globalThis as never as Mbx).multibox.focus(1));
    await page.waitForTimeout(3000);
    await shot(page, `wall-start-${RUNE.split(' ')[0].toLowerCase()}`);

    console.log(`\nsoaking for ${budgetMin}min. dashboard every ~30s:\n`);
    const bySlot = (all: SlotSample[]) => {
        const m = all.find(s => s.box === M_USER);
        if (!m) throw new Error(`recipient box '${M_USER}' not found among iframes (${all.map(s => s.box).join(',')})`);
        return { m, rr: R_USERS.map(u => all.find(s => s.box === u)).filter((s): s is SlotSample => Boolean(s)) };
    };

    const first = bySlot(await sampleWall(page));
    const xp0 = first.m.rcXp;
    const startedAt = Date.now();
    const deadline = startedAt + budgetMin * 60_000;
    const prevEss = new Map<string, number>();
    const deliveries = new Map<string, number>();
    const stopped = new Map<string, string>();
    let sawRecipientStop = '';
    let mm = first.m;
    let midShotDone = false;

    while (Date.now() < deadline) {
        const { m, rr } = bySlot(await sampleWall(page));
        mm = m;
        const mins = Math.round((Date.now() - startedAt) / 6000) / 10;
        const craftedEss = Math.round((m.rcXp - xp0) / route.xpPerEssence);
        if (m.state !== 'running' && !sawRecipientStop) sawRecipientStop = m.stopReason || m.state;

        for (const r of rr) {
            const u = r.box ?? '?';
            const prev = prevEss.get(u) ?? 0;
            if (prev > 0 && r.ess === 0) deliveries.set(u, (deliveries.get(u) ?? 0) + 1);
            prevEss.set(u, r.ess);
            if (r.state !== 'running' && !stopped.has(u)) stopped.set(u, r.stopReason || r.state);
        }

        const delivered = [...deliveries.values()].reduce((a, b) => a + b, 0);
        const carrying = rr.filter(r => r.ess > 0).length;
        const rate = Math.round(craftedEss / Math.max(0.1, (Date.now() - startedAt) / 3_600_000));
        console.log(`── t=${mins}min | recipient ${m.runes} ${route.runeName}s · ${craftedEss} ess crafted (~${rate}/hr) ${m.state} · ${m.lastLog}`);
        console.log(`   runners: ${delivered} deliveries total · ${carrying}/${rr.length} carrying essence · ${stopped.size} stopped`);

        if (!midShotDone && mins >= budgetMin / 2) {
            midShotDone = true;
            await shot(page, `wall-mid-${RUNE.split(' ')[0].toLowerCase()}`);
        }
        await page.waitForTimeout(30_000);
    }

    await shot(page, `wall-end-${RUNE.split(' ')[0].toLowerCase()}`);
    await page.evaluate(() => (globalThis as never as Mbx).multibox.controller.stopAll());

    const craftedEss = Math.round((mm.rcXp - xp0) / route.xpPerEssence);
    const elapsedMin = Math.round((Date.now() - startedAt) / 6000) / 10;
    const perRunner = R_USERS.map(u => deliveries.get(u) ?? 0);
    const idle = R_USERS.filter(u => (deliveries.get(u) ?? 0) === 0);

    console.log(`\n=== MULTIBOX SOAK DONE (${elapsedMin}min, ${NUM_RUNNERS} runners, ${RUNE}) ===`);
    console.log(`recipient crafted ${craftedEss} essence (${mm.runes} ${route.runeName}s) — ~${Math.round(craftedEss / Math.max(0.1, elapsedMin / 60))} essence/hr`);
    console.log(`deliveries per runner: ${perRunner.join(', ')} (total ${perRunner.reduce((a, b) => a + b, 0)})`);

    const problems: string[] = [];
    if (sawRecipientStop) problems.push(`recipient stopped mid-soak: ${sawRecipientStop}`);
    if (stopped.size > 0) problems.push(`${stopped.size} runner(s) stopped: ${[...stopped.entries()].map(([u, w]) => `${u} (${w})`).join('; ')}`);
    if (craftedEss === 0) problems.push('recipient crafted nothing');
    // the recipient completes ~2 trades/min flat out, so with enough runners the queue is
    // deliberately over-saturated (most-recent-wins) and some can't be served in-budget.
    // Under-saturated: everyone must deliver. Over-saturated: total throughput must hold.
    const totalDeliv = perRunner.reduce((a, b) => a + b, 0);
    if (NUM_RUNNERS <= elapsedMin * 1.5) {
        if (idle.length > 0) problems.push(`${idle.length} runner(s) never delivered: ${idle.join(', ')}`);
    } else if (totalDeliv < elapsedMin * 1.2) {
        problems.push(`throughput too low: ${totalDeliv} deliveries in ${elapsedMin}min (recipient saturated should manage ~2/min)`);
    }

    if (problems.length === 0) {
        console.log(`\nPASS: ${NUM_RUNNERS} runners fed the mule recipient in one multibox wall for ${elapsedMin}min — no stops, ${totalDeliv} deliveries (${NUM_RUNNERS - idle.length}/${NUM_RUNNERS} runners served).`);
        await browser.close();
        process.exit(0);
    }
    fail(`soak found ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
