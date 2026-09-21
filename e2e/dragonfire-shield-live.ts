// PRIVATE TEST — DO NOT PUSH, DO NOT OPEN A PR, DO NOT MERGE UPSTREAM.
// Pairs with the private DragonfireShield script on branch feat/dragonfire-shield.
/** Live proof for the DragonfireShield farm: once `%dragon_shield = 1` (what Oziach sets when he tells
 *  you where the shield is, so the quest is not required), Duke Horacio hands out a free un-noted
 *  Dragonfire shield every conversation. The script shuttles Al Kharid bank ↔ Lumbridge castle,
 *  farms the Duke, drops the shields to the floor, loots the pile and banks them, carrying the noted
 *  shields each trip. Proof: out/dragonfire-shield-proof.json */
//   ~/redeploy.sh && HEADED=1 bun e2e/dragonfire-shield-live.ts
import type { Page } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import {
    cheatQuiet,
    getServerVarQuiet,
    mainlandAccount,
    maxmeAndClearDialogs,
    relog,
    seedItemsToBank,
    startScript
} from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8888'
});

// PRINCE_ALI=done: run the farm on an account that completed Prince Ali Rescue, so the Al Kharid
// toll is waived and the route must still take the toll gate with zero coins instead of a long detour.
const PRINCE_ALI_DONE = process.env.PRINCE_ALI === 'done';

// ZERO_BANK=1: start with the bank empty of shields to prove a from-scratch run leaves the bank,
// farms the Duke, and banks the first load instead of looping "no shields to bring" at the booth.
const ZERO_BANK = process.env.ZERO_BANK === '1';

const AL_BANK = { x: 3269, z: 3167, level: 0 };
const MIN_FARMED = 3;
const WATCH_MS = 240_000;

type Log = { time: number; level: string; msg: string };
type Abi = {
    __rs2b0t: {
        Inventory: { countById(id: number): number };
        LoopingBot: new () => { loop(): unknown };
        registerScript(m: { name: string; create(): unknown }): unknown;
        Bank: {
            isOpen(): boolean;
            openBooth(t: unknown, name: string, op: string): Promise<boolean>;
            openNearest(name: string, op: string): Promise<boolean>;
            close(): Promise<boolean>;
            countById(id: number): number;
        };
    };
    rs2b0t: {
        runner: {
            state: string;
            start(m: unknown): void;
            stop(reason: string): void;
            ctx?: { log?: Log[] } | null;
        };
        registry: { get(name: string): unknown };
        reader: {
            objCatalog(): { id: number; certlink: number; certtemplate: number }[];
        };
    };
    __dfsBank?: { unNoted: number; notes: number; noteId: number };
};

const proof = createHarnessProof({ slug: 'dragonfire-shield' });

async function bankSnapshot(page: Page): Promise<{ unNoted: number; notes: number; noteId: number }> {
    await page.evaluate(() => {
        const g = globalThis as never as Abi;
        const api = g.__rs2b0t;
        const noteId = (() => {
            try {
                const catalog = g.rs2b0t.reader.objCatalog();
                const note = catalog.find(o => o.certlink !== -1 && o.certtemplate !== -1 && o.certlink === 1540);
                return note ? note.id : null;
            } catch {
                return null;
            }
        })();
        g.__dfsBank = { unNoted: 0, notes: 0, noteId: noteId ?? -1 };
        class Snap extends api.LoopingBot {
            private ran = false;
            override async loop(): Promise<number> {
                if (this.ran) {
                    return 5000;
                }
                this.ran = true;
                try {
                    const opened =
                        (await api.Bank.openBooth(AL_BANK, 'Bank booth', 'Use-quickly')) ||
                        (await api.Bank.openNearest('Bank booth', 'Use-quickly'));
                    if (!opened || !api.Bank.isOpen()) {
                        throw new Error('could not open bank for snapshot');
                    }
                    g.__dfsBank = {
                        unNoted: api.Bank.countById(1540),
                        notes: noteId === null ? 0 : api.Bank.countById(noteId),
                        noteId: noteId ?? -1
                    };
                } finally {
                    await api.Bank.close().catch(() => undefined);
                    g.rs2b0t.runner.stop('harness snapshot stop');
                }
                return 5000;
            }
        }
        g.rs2b0t.runner.start(api.registerScript({ name: 'DfsBankSnap', create: () => new Snap() }));
    });
    const t0 = Date.now();
    while (Date.now() - t0 < 45_000) {
        if ((await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state)) === 'idle') {
            break;
        }
        await page.waitForTimeout(200);
    }
    return page.evaluate(() => (globalThis as never as Abi).__dfsBank ?? { unNoted: -1, notes: -1, noteId: -1 });
}

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
try {
    await proof.ensureDirs();
    const watchDir = join(process.cwd(), 'screenshots', 'watch');
    await mkdir(watchDir, { recursive: true });
    const winWatch = `\\\\wsl.localhost\\${process.env.WSL_DISTRO_NAME ?? 'Ubuntu'}\\home\\shonc\\rs2bot\\rs2b0t\\screenshots\\watch`;
    console.log(`watch frames -> ${winWatch} (open the folder in Windows Explorer)`);
    const user = `dfs${Date.now().toString(36).slice(-5)}`;
    console.log(`dragonfire-shield-live base=${base} user=${user}`);
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);

    await cheatQuiet(page, 'setvar dragon_shield 1');
    await cheatQuiet(page, 'speed 200');
    if (PRINCE_ALI_DONE) {
        await cheatQuiet(page, 'setvar princequest 110');
    }
    const varp = await getServerVarQuiet(page, 'dragon_shield');
    if (varp !== 1) {
        throw new Error(`dragon_shield expected 1, got ${varp}`);
    }
    if (PRINCE_ALI_DONE) {
        const prince = await getServerVarQuiet(page, 'princequest');
        if (prince !== 110) {
            throw new Error(`princequest expected 110, got ${prince}`);
        }
    }
    console.log(`dragon_shield=${varp}${PRINCE_ALI_DONE ? ' prince_ali=done' : ''}`);
    // Reload the client so the server-pushed variables (incl. a recoloured quest list) settle before the Duke is talked to.
    await relog(page, user);
    await maxmeAndClearDialogs(page);

    // A completed Prince Ali means no coins are ever held; ZERO_BANK clears the shields to prove a
// from-scratch start. Otherwise the bank is seeded with 20 shields + 100 coins.
    const seedList = PRINCE_ALI_DONE
        ? [{ debugName: 'antidragonbreathshield', displayName: 'Dragonfire shield', qty: 20 }]
        : ZERO_BANK
            ? [{ debugName: 'Coins', displayName: 'Coins', qty: 100 }]
            : [
                { debugName: 'antidragonbreathshield', displayName: 'Dragonfire shield', qty: 20 },
                { debugName: 'Coins', displayName: 'Coins', qty: 100 }
            ];
    await seedItemsToBank(page, seedList, AL_BANK);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:DragonfireShield:tripSecs', '40'));
    await startScript(page, 'DragonfireShield');
    console.log('DragonfireShield started — watching for the farm loop');

    const collected: string[] = [];
    let lastT = 0;
    let bestFarmed = 0;
    let tripsSeen = 0;
    let frameN = 0;
    let lastShot = 0;
    const deadline = Date.now() + WATCH_MS;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            return { runner: g.rs2b0t.runner.state, logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-60) };
        });
        for (const line of snap.logs) {
            if (line.time > lastT) {
                collected.push(line.msg);
                console.log(`  · ${line.msg}`);
            }
        }
        if (snap.logs.length) {
            lastT = Math.max(lastT, ...snap.logs.map(l => l.time));
        }
        const trips = [...collected.join('\n').matchAll(/trip (\d+): total (\d+) shield\(s\) farmed/g)].map(m => ({
            trip: Number(m[1]),
            farmed: Number(m[2])
        }));
        tripsSeen = trips.length;
        bestFarmed = trips.at(-1)?.farmed ?? bestFarmed;
        if (bestFarmed >= MIN_FARMED) {
            break;
        }
        if (snap.runner !== 'running') {
            break;
        }
        await page.waitForTimeout(4000);
    }
    await page.evaluate(() => {
        try {
            (globalThis as never as Abi).rs2b0t.runner.stop('harness stop');
        } catch {
            /* ignore */
        }
    });
    await page.waitForTimeout(1500);

    const bank = await bankSnapshot(page);
    const logText = collected.join('\n');
    const feeOk = /gate fee \d+ — withdrew \d+ coins/.test(logText);
    const withheldCoins = /withdrew \d+ coins/.test(logText);
    const gateCrosses = [...logText.matchAll(/Al Kharid toll gate: crossed at/g)].length;
    // Quest-done runs: the toll is free, so the farm must cross the gate both ways with zero coins — a
    // long detour around Al Kharid would still farm, so the gate-cross count is the route proxy.
    const ok = PRINCE_ALI_DONE
        ? tripsSeen >= 1 && bestFarmed >= MIN_FARMED && !withheldCoins && gateCrosses >= 2
        : tripsSeen >= 1 && bestFarmed >= MIN_FARMED && feeOk;
    const detail = ok
        ? `trips=${tripsSeen} farmed=${bestFarmed} bank(ds 1540)=${bank.unNoted} notes=${bank.notes} tollCrosses=${gateCrosses}${PRINCE_ALI_DONE ? ' (no coins)' : ` fee=${feeOk}`}`
        : `trips=${tripsSeen} farmed=${bestFarmed} fee=${feeOk} tollCrosses=${gateCrosses} sample=${collected.slice(-6).join(' | ') || '(no logs)'}`;
    console.log(`result: ${ok ? 'PASS' : 'FAIL'} ${detail}`);

    await (ok ? proof.writeSuccess : proof.writeFailure).call(proof, page, {
        dragonShieldVarp: varp,
        princeAliDone: PRINCE_ALI_DONE,
        trips: tripsSeen,
        farmed: bestFarmed,
        bankSnapshot: bank,
        seed: { unNoted: ZERO_BANK ? 0 : 20, coins: PRINCE_ALI_DONE ? 0 : 100 },
        gateFee: feeOk,
        tollCrosses: gateCrosses,
        sample: collected.slice(-20)
    });
    if (!ok) {
        process.exit(1);
    }
    console.log('PASS dragonfire-shield-live');
    process.exit(0);
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}