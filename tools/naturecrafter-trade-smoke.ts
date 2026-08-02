/**
 * Short dual-account air master↔runner trade smoke (NatureCrafter decline fix).
 *
 *   HEADED=1 bun tools/naturecrafter-trade-smoke.ts
 *
 * Asserts master receives essence (accept log / ess in pack / craft XP gain).
 *
 * Dual-window pattern matches gatheringbot-*-pair / mulecrafter:
 *   - separate browser contexts
 *   - sequential mainlandAccount (bootAndLogin + setvar tutorial + relog)
 *   - never page.reload() for off-island (that swallows a context into about:blank)
 *   - master maxmeAndClearDialogs before further seeds
 *   - runner bank: seedItemsToBank(blankrune) verified at booth
 *
 * Success: do not treat absolute RC XP as pass (maxme baseline is huge).
 */
import type { Page } from 'playwright-core';
import { launchBrowser, fail } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    mainlandAccount,
    maxmeAndClearDialogs,
    seedItemsToBank,
    startScript
} from './tutorial/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';

const base = process.env.BASE ?? 'http://localhost:8890';
const budgetS = Number(process.env.BUDGET_S) || 180;
const stamp = Date.now().toString(36).slice(-5);
const M_USER = `ncm${stamp}`;
const R_USER = `ncr${stamp}`;
const proof = createHarnessProof({ issue: 292, slug: 'naturecrafter-trade' });

/** Air ruins stand (2983, 3288). */
const AIR_RUINS = { x: 2983, z: 3288, level: 0 };
/** Falador East bank — NatureCrafter air runner loop. */
const FALLY_EAST_BANK = { x: 3013, z: 3355, level: 0 };

type Tile = { x: number; z: number; level: number };

type Snap = {
    tile: Tile | null;
    ess: number;
    runes: number;
    rcXp: number;
    state: string;
    logs: string[];
};

type Abi = {
    __rs2b0t: {
        Inventory: { count(n: string): number; items(): { name: string | null }[] };
        Skills: { xp(s: string): number };
        reader: { worldTile(): Tile | null };
    };
    rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } | null } };
};

function teleCmd(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: Tile, maxDist = 12): Promise<void> {
    for (let a = 0; a < 5; a++) {
        if (!(await cheatQuiet(page, teleCmd(spot)))) {
            await page.waitForTimeout(400);
            continue;
        }
        for (let p = 0; p < 14; p++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (
                t
                && t.level === spot.level
                && Math.max(Math.abs(t.x - spot.x), Math.abs(t.z - spot.z)) <= maxDist
            ) {
                await page.waitForTimeout(500);
                return;
            }
            await page.waitForTimeout(300);
        }
    }
    fail(`tele to ${spot.x},${spot.z} failed`);
}

async function setNC(page: Page, mode: 'Master' | 'Runner', partner: string): Promise<void> {
    await page.evaluate(
        ([m, p]) => {
            const pairs: [string, string][] = [
                ['rune', 'Air runes'],
                ['mode', m],
                ['partner', p],
                ['bankEvery', '0'],
                ['withdrawEss', '25']
            ];
            for (const [k, v] of pairs) {
                sessionStorage.setItem(`rs2b0t:set:NatureCrafter:${k}`, v);
                try {
                    localStorage.setItem(`rs2b0t:set:NatureCrafter:${k}`, v);
                } catch {
                    /* ignore */
                }
            }
        },
        [mode, partner] as const
    );
}

async function snap(page: Page): Promise<Snap> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        return {
            tile: g.__rs2b0t.reader.worldTile(),
            ess: g.__rs2b0t.Inventory.count('Rune essence'),
            runes: g.__rs2b0t.Inventory.count('Air rune'),
            rcXp: g.__rs2b0t.Skills.xp('runecraft'),
            state: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg).slice(-25)
        };
    });
}

/** Confirm the page still has a live bot client (not about:blank after a bad reload). */
async function assertIngame(page: Page, label: string): Promise<void> {
    const url = page.url();
    if (!url || url === 'about:blank' || !/bot\.html/i.test(url)) {
        fail(`${label}: page is not on bot.html (url=${url}) — dual-context startup swallowed the window`);
    }
    const ok = await page
        .evaluate(() => {
            const c = (globalThis as never as { rs2b0t?: { client?: { ingame: boolean; sceneState: number } } })
                .rs2b0t?.client;
            return Boolean(c?.ingame && c.sceneState === 2);
        })
        .catch(() => false);
    if (!ok) {
        fail(`${label}: not ingame/scene-ready after bring-up`);
    }
}

const browser = await launchBrowser({ swiftshader: true });
let mPage: Page | null = null;
let rPage: Page | null = null;
const t0 = Date.now();
const stampFn = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;

try {
    await proof.ensureDirs();
    console.log(`naturecrafter-trade-smoke master=${M_USER} runner=${R_USER} budget=${budgetS}s base=${base}`);

    // Separate contexts (two logins). Create both pages first so headed windows stay up;
    // bring up sequentially with mainlandAccount (no page.reload off-island path).
    mPage = await (await browser.newContext()).newPage();
    rPage = await (await browser.newContext()).newPage();

    console.log(`${stampFn()} bring up master '${M_USER}'`);
    await mainlandAccount(mPage, base, M_USER);
    await assertIngame(mPage, 'master');
    console.log(`${stampFn()} master maxme + clear level-up dialogs`);
    await maxmeAndClearDialogs(mPage);
    await clearChatDialogs(mPage);
    await cheatQuiet(mPage, '~clearinv');
    await mPage.waitForTimeout(300);
    if (!(await cheatQuiet(mPage, 'give air_talisman 1'))) {
        await cheatQuiet(mPage, '~item air_talisman 1');
    }
    await teleArrive(mPage, AIR_RUINS);
    await setNC(mPage, 'Master', R_USER);
    console.log(`${stampFn()} master ready at air ruins`);

    console.log(`${stampFn()} bring up runner '${R_USER}'`);
    await mainlandAccount(rPage, base, R_USER);
    await assertIngame(rPage, 'runner');
    // No maxme on runner — air withdraw/deliver needs no high stats; keeps dialogs quiet.
    await cheatQuiet(rPage, '~clearinv');
    await rPage.waitForTimeout(300);
    await teleArrive(rPage, FALLY_EAST_BANK);
    // blankrune = Rune essence on this engine. Verified at booth (givebank / ~bankitem).
    console.log(`${stampFn()} runner seed bank essence`);
    await seedItemsToBank(
        rPage,
        [{ debugName: 'blankrune', displayName: 'Rune essence', qty: 500 }],
        FALLY_EAST_BANK
    );
    if (!(await cheatQuiet(rPage, 'give blankrune 25'))) {
        await cheatQuiet(rPage, '~item blankrune 25');
    }
    await setNC(rPage, 'Runner', M_USER);
    console.log(`${stampFn()} runner ready at Falador East (500 banked + 25 held)`);

    // Baseline after maxme — never treat absolute XP as success.
    const m0 = await snap(mPage);
    const baseRcXp = m0.rcXp;
    const baseRunes = m0.runes;
    console.log(`${stampFn()} baseline master ess=${m0.ess} runes=${m0.runes} rcXp=${baseRcXp}`);

    await startScript(mPage, 'NatureCrafter');
    await startScript(rPage, 'NatureCrafter');
    console.log(`${stampFn()} both NatureCrafter started — waiting for trade`);

    let ok = false;
    let detail = '';
    while (Date.now() - t0 < budgetS * 1000) {
        await new Promise(r => setTimeout(r, 4000));
        // Bail early if a context died mid-run.
        await assertIngame(mPage, 'master-loop');
        await assertIngame(rPage, 'runner-loop');

        const m = await snap(mPage);
        const r = await snap(rPage);
        const mDeclined = m.logs.some(l => /declining|safety:/i.test(l));
        const mAccepted = m.logs.some(l => /received \d+ essence|accepting \d+ essence/i.test(l));
        const rDelivered = r.logs.some(l => /delivered \d+ essence|offering/i.test(l));
        const xpGain = m.rcXp > baseRcXp;
        const runeGain = m.runes > baseRunes;
        console.log(
            `${stampFn()} M ess=${m.ess} runes=${m.runes}(+${m.runes - baseRunes}) xp=+${m.rcXp - baseRcXp} @${m.tile?.x},${m.tile?.z} | R ess=${r.ess} @${r.tile?.x},${r.tile?.z} | decline=${mDeclined} accept=${mAccepted} deliv=${rDelivered}`
        );
        if (mDeclined && !mAccepted) {
            detail = `master declined: ${m.logs.filter(l => /declin|safety/i.test(l)).join('; ')}`;
        }
        if (mAccepted || m.ess > 0 || runeGain || xpGain) {
            ok = true;
            detail = `master ess=${m.ess} runes=${m.runes}(+${m.runes - baseRunes}) xp=+${m.rcXp - baseRcXp} acceptLog=${mAccepted}`;
            break;
        }
        if (rDelivered && m.ess > 0) {
            ok = true;
            detail = `runner delivered; master ess=${m.ess}`;
            break;
        }
    }

    if (!ok) {
        const m = await snap(mPage!);
        const r = await snap(rPage!);
        await proof.writeFailure(mPage);
        fail(
            `no successful trade in ${budgetS}s Mlogs=${m.logs.slice(-8).join('|')} Rlogs=${r.logs.slice(-8).join('|')} ${detail}`
        );
    }

    await proof.writeSuccess(mPage!, { master: M_USER, runner: R_USER, detail, budgetS });
    console.log(`PASS naturecrafter-trade-smoke ${detail}`);
    process.exit(0);
} catch (e) {
    console.error(e);
    if (mPage) {
        await proof.writeFailure(mPage).catch(() => undefined);
    }
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
