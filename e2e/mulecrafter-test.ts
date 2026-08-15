// MuleCrafter e2e: 1 crafter + N mules (default 1) for a 10 min soak on Air runes — the bank→ruins→bank loop, trading at the ruins, and dry-signalling at the bank.
// Usage: bun e2e/mulecrafter-test.ts [base] [budget-min] [num-mules] [rune: "Air rune" (default) or "Mind rune"]

import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs, cheatQuiet, fail, stopScript, setSettings, type } from './lib/harness.js';
import { mainlandAccount, startScript } from './tutorial/harness.js';

const { base, rest } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8890' });
const budgetMin = Number(rest[0]) || 2.5;
const NUM_MULES = Number(rest[1]) || 1;
const RUNE = rest[2] || 'Air rune';

interface RuneRoute {
    talisman: string;
    runeName: string;
    xpPerEssence: number;
    essencePer: number;
    zones: { name: string; x: [number, number]; z: [number, number] }[];
}

const ROUTES: Record<string, RuneRoute> = {
    'Air rune': {
        talisman: 'air_talisman', runeName: 'air rune', xpPerEssence: 5,
        essencePer: 5000,
        zones: [
            { name: 'fally', x: [2995, 3030], z: [3335, 3375] },
            { name: 'altar', x: [2965, 3005], z: [3270, 3305] }
        ]
    },
    'Mind rune': {
        talisman: 'mind_talisman', runeName: 'mind rune', xpPerEssence: 5.5,
        essencePer: 5000,
        zones: [
            { name: 'edge', x: [3080, 3110], z: [3480, 3510] },
            { name: 'altar', x: [2970, 3000], z: [3495, 3525] }
        ]
    }
};

const route = ROUTES[RUNE];
if (!route) { fail(`unknown rune '${RUNE}' — expected one of: ${Object.keys(ROUTES).join(', ')}`); }

const FALLY_EAST = { x: 3013, z: 3355, level: 0 };

const stamp = Date.now().toString(36).slice(-5);
const C_USER = `sokc${stamp}`;
const M_USERS = Array.from({ length: NUM_MULES }, (_, i) => `skm${i}${stamp}`);

// ── ABI ──────────────────────────────────────────────────────────────────────

type Tile = { x: number; z: number; level: number };

type Abi = {
    __rs2b0t: {
        Inventory: { items(): { name: string | null; id: number; count: number }[] };
        Skills: { xp(s: string): number };
        reader: { worldTile(): Tile | null };
    };
    rs2b0t: {
        runner: { state: string; ctx?: { log?: { msg: string }[] } };
        reader: {
            modals(): { main: number; side: number; chat: number };
            chatContinueComId(): number;
            chatOptions(): { text: string; comId: number }[];
        };
        actions: {
            continueDialog(): boolean;
            ifButton(comId: number): boolean;
        };
    };
};

// ── helpers ──────────────────────────────────────────────────────────────────

function chebyshev(a: Tile, b: Tile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function teleCheat(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: Tile, maxDist = 18): Promise<boolean> {
    const cmd = teleCheat(spot);
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
    const cmd = `give ${debugName} ${qty}`;
    for (let i = 0; i < 8; i++) {
        const sent = await cheatQuiet(page, cmd);
        if (!sent) throw new Error(`give not sent (not ingame?) for ${displayName}`);
        for (let poll = 0; poll < 4; poll++) {
            const n = await countInvItem(page, displayName);
            if (n >= qty) return;
            await page.waitForTimeout(250);
        }
    }
    const inv = await page.evaluate(() =>
        (globalThis as never as Abi).__rs2b0t.Inventory.items()
            .filter(i => i.name).map(i => `${i.count}x ${i.name}`).join(', ')
    );
    throw new Error(`could not seed ${displayName} via '${cmd}' (inv=${inv || 'empty'})`);
}

async function clearInv(page: Page): Promise<void> {
    for (let i = 0; i < 6; i++) {
        const sent = await cheatQuiet(page, '~clearinv');
        if (!sent) throw new Error('~clearinv not sent (not ingame?)');
        await page.waitForTimeout(700);
        const items = await page.evaluate(() =>
            (globalThis as never as Abi).__rs2b0t.Inventory.items().filter(i => i.name)
        );
        if (items.length === 0) return;
    }
}

async function clearChatDialogs(page: Page, label = 'dialogs'): Promise<void> {
    const clicked = await page.evaluate(async () => {
        const { actions, reader } = (globalThis as never as Abi).rs2b0t;
        let n = 0, quiet = 0;
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
            if (canContinue) { if (actions.continueDialog()) n++; }
            else if (opts.length > 0) { if (actions.ifButton(opts[0]!.comId)) n++; }
            await new Promise(r => setTimeout(r, 250));
        }
        return n;
    });
    if (clicked > 0) console.log(`  cleared ${clicked} ${label}`);
}

async function maxAccountAndClearDialogs(page: Page): Promise<void> {
    const sent = await cheatQuiet(page, '~maxme');
    if (sent) {
        await page.waitForFunction(
            () => {
                const s = (globalThis as never as Abi).__rs2b0t.Skills;
                return s.xp('attack') >= 13_000_000 && s.xp('hitpoints') >= 13_000_000;
            },
            undefined,
            { timeout: 45_000 }
        ).catch(() => undefined);
    }
    await clearChatDialogs(page, 'level-up dialog(s)');
    await page.waitForTimeout(1500);
    await clearChatDialogs(page, 'straggler dialog(s)');
}

// ── zone helper (for logging) ────────────────────────────────────────────────

function zone(p: Tile | null): string {
    if (!p) return '??';
    if (p.z > 4000) return 'temple';
    const hit = route.zones.find(zn => p.x >= zn.x[0] && p.x <= zn.x[1] && p.z >= zn.z[0] && p.z <= zn.z[1]);
    return hit ? hit.name : `${p.x},${p.z}`;
}

// ── sampler ──────────────────────────────────────────────────────────────────

function sample(page: Page): Promise<{
    pos: Tile | null;
    runes: number;
    ess: number;
    rcXp: number;
    state: string;
    lastLog: string;
    stopReason: string;
}> {
    return page.evaluate(rn => {
        const g = globalThis as never as Abi;
        const items = g.__rs2b0t.Inventory.items();
        const logs = g.rs2b0t.runner.ctx?.log ?? [];
        const msgs = logs.map(l => l.msg);
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            runes: items.filter(i => (i.name ?? '').toLowerCase() === rn).reduce((s, i) => s + Math.max(1, i.count), 0),
            ess: items.filter(i => (i.name ?? '').toLowerCase() === 'rune essence').reduce((s, i) => s + Math.max(1, i.count), 0),
            rcXp: g.__rs2b0t.Skills.xp('runecraft'),
            state: g.rs2b0t.runner.state,
            lastLog: (msgs[msgs.length - 1] ?? '').slice(0, 46),
            stopReason: msgs.filter(m => /Stopping\.|crashed/i.test(m)).slice(-1)[0] ?? ''
        };
    }, route.runeName);
}

// ── common setup ─────────────────────────────────────────────────────────────

async function setupAccount(page: Page, user: string, mode: 'Crafter' | 'Mule', partner: string): Promise<void> {
    page.on('pageerror', e => console.log(`[${user}] pageerror: ${e}`));
    await mainlandAccount(page, base, user);
    await maxAccountAndClearDialogs(page);
    await clearInv(page);
    await seedItem(page, route.talisman, route.talisman.replace(/_/g, ' '), 1);
    // Keyboard ::give for cert_blankrune — requires keyboard path to stack properly.
    await type(page, '::give cert_blankrune 1000');
    await setSettings(page, 'MuleCrafter', { rune: RUNE, mode, partner });
    const arrived = await teleArrive(page, FALLY_EAST);
    if (!arrived) fail(`${user}: could not teleport to Falador East bank`);
    await page.waitForTimeout(1500);
    await startScript(page, 'MuleCrafter');
    console.log(`  ${user} (${mode}) ready`);
}

// ── main ─────────────────────────────────────────────────────────────────────

const browser = await launchBrowser();
try {
    const ctxC = await browser.newContext();
    const pageC = await ctxC.newPage();
    const mPages: Page[] = [];
    for (let i = 0; i < NUM_MULES; i++) {
        mPages.push(await (await browser.newContext()).newPage());
    }

    console.log(`bringing up crafter + ${NUM_MULES} mule(s) for ${RUNE} (sequential)...`);

    const partnerList = M_USERS.join(',');
    await setupAccount(pageC, C_USER, 'Crafter', partnerList);

    for (let i = 0; i < NUM_MULES; i++) {
        await setupAccount(mPages[i], M_USERS[i], 'Mule', C_USER);
    }

    console.log(`\nall started — soaking for ${budgetMin}min. dashboard every ~30s:\n`);

    const xp0 = (await sample(pageC)).rcXp;
    const startedAt = Date.now();
    const deadline = startedAt + budgetMin * 60_000;
    const prevEss = Array(NUM_MULES).fill(0);
    const deliveries = Array(NUM_MULES).fill(0);
    const stoppedMules = new Map<number, string>();
    let sawCrafterStop = '';
    let cc = await sample(pageC);

    async function stopAll(): Promise<void> {
        await stopScript(pageC);
        for (const p of mPages) await stopScript(p);
    }

    while (Date.now() < deadline) {
        cc = (await Promise.all([sample(pageC), ...mPages.map(sample)]))[0];
        const rr = await Promise.all(mPages.map(sample));
        const mins = Math.round((Date.now() - startedAt) / 6000) / 10;
        const craftedEss = Math.round((cc.rcXp - xp0) / route.xpPerEssence);
        const inFlight = rr.reduce((s, r) => s + r.ess, 0);
        if (cc.state !== 'running' && !sawCrafterStop) {
            sawCrafterStop = cc.stopReason || cc.state;
        }

        rr.forEach((r, i) => {
            if (prevEss[i] > 0 && r.ess === 0) deliveries[i]++;
            prevEss[i] = r.ess;
            if (r.state !== 'running' && !stoppedMules.has(i)) {
                stoppedMules.set(i, r.stopReason || r.state);
            }
        });

        const rate = Math.round(craftedEss / Math.max(0.1, (Date.now() - startedAt) / 3_600_000));
        console.log(`── t=${mins}min | crafter ${cc.runes} ${route.runeName}s · ${craftedEss} ess crafted (+${cc.rcXp - xp0} xp, ~${rate} ess/hr) @${zone(cc.pos)} ${cc.state} | ${inFlight} ess in mule packs`);
        rr.forEach((r, i) => {
            console.log(`   M${i} ${zone(r.pos).padEnd(9)} ess=${String(r.ess).padStart(3)} runes=${String(r.runes).padStart(3)} deliv=${String(deliveries[i]).padStart(3)} ${r.state.padEnd(8)} · ${r.lastLog}`);
        });

        if (cc.state === 'crashed' || rr.some(r => r.state === 'crashed')) {
            console.log('!! a bot crashed — ending the soak early');
            await stopAll();
            break;
        }
        await pageC.waitForTimeout(30_000);
    }

    await stopAll();

    const craftedEss = Math.round((cc.rcXp - xp0) / route.xpPerEssence);
    const elapsedMin = Math.round((Date.now() - startedAt) / 6000) / 10;
    const totalDeliveries = deliveries.reduce((a, b) => a + b, 0);
    const idle = deliveries.map((d, i) => ({ d, i })).filter(x => x.d === 0).map(x => `M${x.i}`);

    console.log(`\n=== SOAK DONE (${elapsedMin}min, ${NUM_MULES} mule(s), ${RUNE}) ===`);
    console.log(`crafter crafted ${craftedEss} essence (${cc.runes} ${route.runeName}s, +${cc.rcXp - xp0} rc xp) — ~${Math.round(craftedEss / Math.max(0.1, elapsedMin / 60))} essence/hr`);
    console.log(`deliveries per mule: ${deliveries.join(', ')} (total ${totalDeliveries})`);
    if (stoppedMules.size > 0) {
        for (const [i, why] of stoppedMules) console.log(`   M${i} stopped: ${why}`);
    }

    const problems: string[] = [];
    if (sawCrafterStop) problems.push(`crafter stopped mid-soak: ${sawCrafterStop}`);
    if (stoppedMules.size > 0) problems.push(`${stoppedMules.size} mule(s) stopped: ${[...stoppedMules.entries()].map(([i, w]) => `M${i} (${w})`).join('; ')}`);
    if (idle.length > 0) problems.push(`${idle.join(', ')} never delivered — wedged or starved`);
    if (craftedEss === 0) problems.push('crafter crafted nothing');

    if (problems.length === 0) {
        console.log(`\nPASS: ${NUM_MULES} mule(s) fed the crafter for ${elapsedMin}min with no stops, no crashes and every mule delivering.`);
        await browser.close();
        process.exit(0);
    }
    fail(`soak found ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
