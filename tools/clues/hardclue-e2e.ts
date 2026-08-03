/**
 * End-to-end hard-trail run against the local server.
 *
 * The per-clue sweep (live-clue-sweep.ts) proves one leg at a time. This runs a
 * whole trail — up to six legs, each handing back a random new hard clue — so
 * the multi-leg path, the guardian fights and the puzzle boxes are exercised in
 * the order a real trail produces them.
 *
 *   bun tools/clues/hardclue-e2e.ts                     # start from a random hard clue
 *   bun tools/clues/hardclue-e2e.ts --id 2794 --mins 45 # start from a chosen one
 *   bun tools/clues/hardclue-e2e.ts --trails 3          # run three trails back to back
 */
import fs from 'node:fs';

import { chromium, type Browser, type Page } from 'playwright-core';

import { CLUE_DB } from '#/bot/clues/data/cluedb.js';

const base = process.env.CLUE_BASE ?? 'http://localhost:8890';
const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 ? argv[i + 1] : null;
};

const TRAIL_DEADLINE_MS = Number(arg('mins') ?? 45) * 60_000;
const TRAILS = Number(arg('trails') ?? 1);
const HARD_IDS = Object.keys(CLUE_DB)
    .map(Number)
    .filter(id => CLUE_DB[id].obj.includes('_hard_'))
    .sort((a, b) => a - b);
const startId = arg('id') !== null ? Number(arg('id')) : null;

const GEAR = ['rune_platebody', 'rune_platelegs', 'rune_full_helm', 'rune_kiteshield', 'rune_scimitar'];
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

async function cheat(page: Page, text: string): Promise<void> {
    await page.evaluate(t => {
        const c = (globalThis as never as R).rs2b0t.client as never as { out: { p1Enc(op: number): void; p1(v: number): void; pjstr(s: string): void } };
        c.out.p1Enc(224);
        c.out.p1(t.length + 1);
        c.out.pjstr(t);
    }, text);
    await page.waitForTimeout(900);
}

async function boot(browser: Browser): Promise<Page> {
    const page = await browser.newPage();
    const username = `he${Date.now().toString(36).slice(-6)}`;
    const ready = (): Promise<unknown> =>
        page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60_000 });
    const login = async (): Promise<boolean> => {
        await page.evaluate(([u, p]) => {
            const c = (globalThis as never as R).rs2b0t.client;
            c.loginUser = u;
            c.loginPass = p;
            void c.login(u, p, false);
        }, [username, 'test']);
        return page
            .waitForFunction(() => (globalThis as never as R).rs2b0t.client.ingame && (globalThis as never as R).rs2b0t.client.sceneState === 2, undefined, { timeout: 12_000 })
            .then(() => true)
            .catch(() => false);
    };

    await page.goto(`${base}/bot.html`);
    await ready();
    for (let i = 0; i < 6 && !(await login()); i++) {
        await page.waitForTimeout(3000);
    }
    // Skip the tutorial, then come back in on a clean scene.
    await cheat(page, 'tele 0,50,50,20,20');
    await page.reload();
    await ready();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) {
        await page.waitForTimeout(5000);
        backIn = await login();
    }
    if (!backIn) {
        throw new Error('relogin failed');
    }

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
    await page.evaluate(async () => {
        const abi = (globalThis as never as Abi).__rs2b0t;
        for (const it of abi.Inventory.items()) {
            if (/^rune /i.test(it.name ?? '')) {
                await it.interact('Wear');
                await it.interact('Wield');
                await new Promise(r => setTimeout(r, 250));
            }
        }
    });
    await cheat(page, 'give lobster 20');
    await cheat(page, 'give coins 2000');
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
    legs: number;
    guardians: number;
    puzzles: number;
    ms: number;
    reason?: string;
    tail: string[];
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
            if (/leg \d+ —|guards this dig|Wizard killed|puzzle solved|trail complete|abandoning /.test(line)) {
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
                legs: count(/leg \d+ —/),
                guardians: count(/Wizard killed/),
                puzzles: count(/puzzle solved/),
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
        legs: tail.filter(l => /leg \d+ —/.test(l)).length,
        guardians: tail.filter(l => /Wizard killed/.test(l)).length,
        puzzles: tail.filter(l => /puzzle solved/.test(l)).length,
        ms: Date.now() - started,
        reason: `deadline at (${at?.x},${at?.z},${at?.level})`,
        tail: tail.slice(-25)
    };
}

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox']
});

const results: TrailResult[] = [];
try {
    const page = await boot(browser);
    for (let n = 0; n < TRAILS; n++) {
        const seed = startId ?? HARD_IDS[Math.floor(Math.random() * HARD_IDS.length)];
        log(`trail ${n + 1}/${TRAILS} — seeding ${CLUE_DB[seed].obj} [${seed}]`);
        const r = await runTrail(page, seed);
        results.push(r);
        log(`trail ${n + 1}: ${r.ok ? 'COMPLETE' : 'FAILED'} — ${r.legs} legs, ${r.guardians} guardians, ${r.puzzles} puzzles, ${Math.round(r.ms / 1000)}s${r.reason ? ` — ${r.reason}` : ''}`);
    }
} finally {
    await browser.close();
}

fs.writeFileSync('out/hardclue-e2e.json', JSON.stringify(results, null, 1));
console.log('\n==== HARD TRAIL E2E ====');
for (const r of results) {
    console.log(`${r.ok ? 'COMPLETE' : 'FAILED  '} from ${r.startObj} [${r.startId}] — ${r.legs} legs, ${r.guardians} guardians, ${r.puzzles} puzzles, ${Math.round(r.ms / 1000)}s${r.reason ? ` — ${r.reason}` : ''}`);
    if (!r.ok) {
        for (const l of r.tail) {
            console.log(`    ${l}`);
        }
    }
}
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} trails complete. Details: out/hardclue-e2e.json`);
process.exit(passed === results.length ? 0 : 1);
