/** End-to-end hard-trail run against the local server — one trail of up to six legs, each handing back a random new hard clue: --id, --mins, --trails, --speed, --no-teleports.
 *  HEADED=1 (optionally SLOWMO=ms) opens a visible window to watch a trail run. */

//   bun e2e/clues/hardclue-e2e.ts                     # start from a random hard clue
//   bun e2e/clues/hardclue-e2e.ts --id 2794 --mins 45 # start from a chosen one
//   bun e2e/clues/hardclue-e2e.ts --trails 3          # run three trails back to back
//   bun e2e/clues/hardclue-e2e.ts --speed 150         # 4x world tick rate
//   bun e2e/clues/hardclue-e2e.ts --no-teleports      # force everything on foot
import fs from 'node:fs';

import type { Browser, Page } from 'playwright-core';

import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { PACK_UNREACHABLE } from '#/bot/api/ai/clues/data/unreachable.js';

import { boot as bootClient, cheatQuiet, launchBrowser, login, logout, setSettings } from '../lib/harness.js';

const base = process.env.CLUE_BASE ?? 'http://localhost:8890';
const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 ? argv[i + 1] : null;
};

// World.TICKRATE is 600ms; ::speed floors at 20.
const DEFAULT_TICK_MS = 600;
const MIN_TICK_MS = 20;

const TRAIL_DEADLINE_MS = Number(arg('mins') ?? 45) * 60_000;
const TRAILS = Number(arg('trails') ?? 1);
const HARD_IDS = Object.keys(CLUE_DB)
    .map(Number)
    .filter(id => CLUE_DB[id].obj.includes('_hard_'))
    .sort((a, b) => a - b);
const startId = arg('id') !== null ? Number(arg('id')) : null;
const tickMs = arg('speed') !== null ? Math.max(MIN_TICK_MS, Number(arg('speed'))) : null;
const teleports = !argv.includes('--no-teleports');

// Chainbody, not platebody: rune_platebody is gated behind Dragon Slayer
// (levelrequire tier40) and silently refuses to equip on a fresh account.
const GEAR = ['rune_chainbody', 'rune_platelegs', 'rune_full_helm', 'rune_kiteshield', 'rune_scimitar'];
const FOOD = 'Lobster';
const FOOD_OBJ = 'lobster';
const FOOD_COUNT = 12;
// Why: without the runes in the pack a long leg walks rather than routing through the teleport catalog.
const TELEPORT_KIT: [string, number][] = [
    ['lawrune', 40],
    ['airrune', 100],
    ['firerune', 40],
    ['waterrune', 40],
    ['earthrune', 40],
    ['ring_of_dueling_8', 1]
];
const KIT: [string, string][] = [
    ['spade', 'spade'],
    ['trail_sextant', 'sextant'],
    ['trail_watch', 'watch'],
    ['trail_chart', 'chart']
];

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { start(s: unknown): void; stop?(): void; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        registry: { get(n: string): unknown };
        actions?: { continueDialog?: () => boolean };
    };
};

type Abi = {
    __rs2b0t: {
        Inventory: { items(): { id: number; name: string | null; interact(op: string): Promise<boolean> | boolean }[] };
    };
};

function log(m: string): void {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
}

const cheat = (page: Page, text: string): Promise<boolean> => cheatQuiet(page, text, 900);

async function boot(browser: Browser): Promise<Page> {
    const page = await browser.newPage();
    const username = `he${Date.now().toString(36).slice(-6)}`;

    log(`booting ${base} as ${username}`);
    await page.goto(`${base}/bot.html`);
    await bootClient(page);
    log('client up — logging in');
    for (let i = 0; i < 6 && !(await login(page, username)); i++) {
        await page.waitForTimeout(3000);
    }
    // Why: reloading alone leaves the server holding the player online, so log out through the game's button first or the relogin loop burns minutes.
    log('skipping the tutorial');
    await cheat(page, 'tele 0,50,50,20,20');
    const cleanExit = await logout(page);
    await page.reload();
    await bootClient(page);
    let backIn = await login(page, username);
    for (let i = 0; i < 8 && !backIn; i++) {
        await page.waitForTimeout(5000);
        backIn = await login(page, username);
    }
    if (!backIn) {
        throw new Error('relogin failed');
    }
    if (!cleanExit) {
        log('note: clean logout did not take — the relogin waited out the server grace period');
    }

    log('seeding stats, kit and gear');
    await cheat(page, '~maxme');
    await page.evaluate(async () => {
        const a = (globalThis as never as R).rs2b0t.actions;
        for (let i = 0; i < 25; i++) {
            a?.continueDialog?.();
            await new Promise(r => setTimeout(r, 250));
        }
    });

    for (const [obj, probe] of KIT) {
        const held = (): Promise<boolean> =>
            page.evaluate(n => (globalThis as never as Abi).__rs2b0t.Inventory.items().some(i => (i.name ?? '').toLowerCase() === n), probe);
        for (let attempt = 0; attempt < 4 && !(await held()); attempt++) {
            await cheat(page, `give ${obj}`);
        }
    }
    for (const item of GEAR) {
        await cheat(page, `give ${item}`);
    }
    const worn: string[] = await page.evaluate(async () => {
        const abi = (globalThis as never as Abi).__rs2b0t;
        const on: string[] = [];
        for (const it of abi.Inventory.items()) {
            if (/^rune /i.test(it.name ?? '')) {
                await it.interact('Wear');
                await it.interact('Wield');
                await new Promise(r => setTimeout(r, 300));
            }
        }
        // Anything still in the pack refused to equip — a level or quest gate.
        for (const it of abi.Inventory.items()) {
            if (/^rune /i.test(it.name ?? '')) {
                on.push(it.name!);
            }
        }
        return on;
    });
    if (worn.length > 0) {
        log(`WARNING: these would not equip and stayed in the pack: ${worn.join(', ')}`);
    }

    await cheat(page, `give ${FOOD_OBJ} ${FOOD_COUNT}`);
    await cheat(page, 'give coins 2000');
    if (teleports) {
        for (const [obj, count] of TELEPORT_KIT) {
            await cheat(page, `give ${obj} ${count}`);
        }
    }

    // Why: ClueSolver's `food` setting defaults to blank, and its bank stop then deposits the food as loot.
    await setSettings(page, 'ClueSolver', { food: FOOD, foodWithdraw: FOOD_COUNT, eatAtHp: 60, restorePrayer: true, useTeleports: teleports });

    if (tickMs !== null) {
        await cheat(page, `speed ${tickMs}`);
        log(`world tick rate ${tickMs}ms (${(DEFAULT_TICK_MS / tickMs).toFixed(1)}x)`);
    }

    await cheat(page, 'tele 0,50,53,53,28');
    log(`ready (${username})`);
    return page;
}

const holdsClueLike = (page: Page): Promise<boolean> =>
    page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Inventory.items().some(i => /clue|casket/i.test(i.name ?? '')));

interface TrailResult {
    startId: number;
    startObj: string;
    ok: boolean;
    /** Died on a clue the nav pack cannot reach — a known gap, not a regression. */
    blocked?: string;
    legs: number;
    guardians: number;
    puzzles: number;
    ms: number;
    reason?: string;
    tail: string[];
}

/** Names the known nav-pack gap a trail rolled into.
 *  Why: a third of hard clues sit behind one, and dying on those is not a solver regression. */
function blockedBy(seedId: number, lines: string[]): string | null {
    const name = (id: number): string => CLUE_DB[id]?.obj ?? `clue_${id}`;
    // The seed itself may never reach a leg line — an unreachable coord
    // grinds the walker — so check it directly before scanning the log.
    if (PACK_UNREACHABLE[seedId]) {
        return `${name(seedId)}: ${PACK_UNREACHABLE[seedId]}`;
    }
    for (const [idStr, why] of Object.entries(PACK_UNREACHABLE)) {
        const obj = CLUE_DB[Number(idStr)]?.obj;
        if (obj && lines.some(l => l.includes(obj))) {
            return `${obj}: ${why}`;
        }
    }
    return null;
}

async function runTrail(page: Page, seedId: number): Promise<TrailResult> {
    const row = CLUE_DB[seedId];
    const started = Date.now();
    await page.evaluate(() => {
        try {
            (globalThis as never as R).rs2b0t.runner.stop?.();
        } catch {
            // no runner to stop
        }
    });
    await page.waitForTimeout(400);

    for (let attempt = 0; attempt < 4 && !(await holdsClueLike(page)); attempt++) {
        await cheat(page, `give ${row.obj}`);
    }
    if (!(await holdsClueLike(page))) {
        return { startId: seedId, startObj: row.obj, ok: false, legs: 0, guardians: 0, puzzles: 0, ms: Date.now() - started, reason: 'seeding the clue failed', tail: [] };
    }

    const before = await page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).length);
    await page.evaluate(() => {
        const r = (globalThis as never as R).rs2b0t;
        r.runner.start(r.registry.get('ClueSolver'));
    });

    const deadline = Date.now() + TRAIL_DEADLINE_MS;
    let lastLen = 0;
    while (Date.now() < deadline) {
        await page.waitForTimeout(5000);
        const all: string[] = await page.evaluate(n => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).slice(n).map(l => l.msg), before);
        for (const line of all.slice(lastLen)) {
            if (/leg \d+ —|guards this dig|Wizard killed|puzzle solved|puzzle already solved|trail complete|abandoning |teleport ok|tele \w+ ok|rubbing /.test(line)) {
                log(`  ${line}`);
            }
        }
        lastLen = all.length;

        const count = (re: RegExp): number => all.filter(l => re.test(l)).length;
        const done = all.some(l => l.includes('trail complete'));
        const abandoned = all.find(l => l.includes('abandoning '));
        if (done || abandoned) {
            return {
                startId: seedId,
                startObj: row.obj,
                ok: Boolean(done),
                blocked: done ? undefined : (blockedBy(seedId, all.slice(-40)) ?? undefined),
                legs: count(/leg \d+ —/),
                guardians: count(/Wizard killed/),
                puzzles: count(/puzzle solved in \d+ moves/),
                ms: Date.now() - started,
                reason: done ? undefined : abandoned?.replace(/^.*abandoning /, 'abandon: '),
                tail: all.slice(-25)
            };
        }
    }

    const tail: string[] = await page.evaluate(n => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).slice(n).map(l => l.msg), before);
    const at = await page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
    return {
        startId: seedId,
        startObj: row.obj,
        ok: false,
        blocked: blockedBy(seedId, tail.slice(-40)) ?? undefined,
        legs: tail.filter(l => /leg \d+ —/.test(l)).length,
        guardians: tail.filter(l => /Wizard killed/.test(l)).length,
        puzzles: tail.filter(l => /puzzle solved in \d+ moves/.test(l)).length,
        ms: Date.now() - started,
        reason: `deadline at (${at?.x},${at?.z},${at?.level})`,
        tail: tail.slice(-25)
    };
}

const verdict = (r: TrailResult): string => (r.ok ? 'COMPLETE' : r.blocked ? 'BLOCKED ' : 'FAILED  ');

const browser = await launchBrowser();

const results: TrailResult[] = [];
try {
    const page = await boot(browser);
    for (let n = 0; n < TRAILS; n++) {
        const seed = startId ?? HARD_IDS[Math.floor(Math.random() * HARD_IDS.length)];
        log(`trail ${n + 1}/${TRAILS} — seeding ${CLUE_DB[seed].obj} [${seed}]`);
        const r = await runTrail(page, seed);
        results.push(r);
        log(`trail ${n + 1}: ${verdict(r).trim()} — ${r.legs} legs, ${r.guardians} guardians, ${r.puzzles} puzzles, ${Math.round(r.ms / 1000)}s${r.blocked ? ` — blocked by ${r.blocked}` : r.reason ? ` — ${r.reason}` : ''}`);
    }
} finally {
    await browser.close();
}

fs.writeFileSync('out/hardclue-e2e.json', JSON.stringify(results, null, 1));
console.log('\n==== HARD TRAIL E2E ====');
for (const r of results) {
    const why = r.blocked ? ` — blocked by ${r.blocked}` : r.reason ? ` — ${r.reason}` : '';
    console.log(`${verdict(r)} from ${r.startObj} [${r.startId}] — ${r.legs} legs, ${r.guardians} guardians, ${r.puzzles} puzzles, ${Math.round(r.ms / 1000)}s${why}`);
    if (!r.ok && !r.blocked) {
        for (const l of r.tail) {
            console.log(`    ${l}`);
        }
    }
}

const done = results.filter(r => r.ok);
const blocked = results.filter(r => !r.ok && r.blocked);
const failed = results.filter(r => !r.ok && !r.blocked);
const legs = results.reduce((n, r) => n + r.legs, 0);
console.log(
    `\n${done.length} COMPLETE · ${blocked.length} BLOCKED (known nav-pack gaps) · ${failed.length} FAILED` +
        `\n${legs} legs solved, ${results.reduce((n, r) => n + r.guardians, 0)} guardians killed, ${results.reduce((n, r) => n + r.puzzles, 0)} puzzles solved` +
        '\nDetails: out/hardclue-e2e.json'
);
// A trail that rolled an unreachable clue is not a regression, so it does not
// fail the run; anything else does.
process.exit(failed.length === 0 ? 0 : 1);
