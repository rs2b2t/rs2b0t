// Run N complete treasure trails back to back and score them (TIER=medium TRAILS=5). Proof: out/clue-trails.json
// Why: the bank is stocked by hand rather than with `~bank_f2p`, whose max-int stacks refuse further deposits and hang the trail's own bank stop on a deposit that can never land.

//   HEADED=1 SLOWMO=0 bun e2e/clue-trails-live.ts
//   TIER=medium TRAILS=5 bun e2e/clue-trails-live.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { CASKET_IDS, CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { HARNESS_VIEWPORT, boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, parseArgs, setSettings } from './lib/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8888' });
const user = process.env.USER_NAME ?? `trail${Date.now() % 100000}`;

const TIER = (process.env.TIER ?? 'hard').toLowerCase();
if (!['easy', 'medium', 'hard'].includes(TIER)) {
    fail(`TIER must be easy, medium or hard (got '${TIER}')`);
}
const TRAILS = Number(process.env.TRAILS ?? 20);
/** A trail is several legs; hard trails cross the map more than once. */
const TRAIL_BUDGET_MS = Number(process.env.TRAIL_BUDGET_MS ?? 900_000);
const POLL_MS = 1000;

/** Edgeville — a bank to start beside. */
const START = { x: 3094, z: 3493, level: 0 } as const;
const SCIMITAR = 1333;
const SPADE = 952;
const TRIO: [string, number][] = [
    ['trail_sextant', 2574],
    ['trail_watch', 2575],
    ['trail_chart', 2576]
];
const STATS = [
    'attack', 'strength', 'defence', 'ranged', 'magic', 'hitpoints', 'prayer',
    'crafting', 'mining', 'smithing', 'fishing', 'cooking', 'firemaking',
    'woodcutting', 'runecraft', 'herblore', 'agility', 'thieving', 'fletching'
];
const LEVEL = 70;
const SEED_BATCHES = 6;
const SEED_COINS = 50_000;
/** Spell-teleport runes (Air x5, Fire/Law/Earth/Water x2 per cast at TELEPORT_CASTS=4); without them the prep withdraws nothing and every leg walks.
 *  Why: jewellery is absent — the trail keeps a glory/ring it already carries but never withdraws one. */
const SEED_RUNES: [string, number][] = [
    ['airrune', 1000],
    ['firerune', 500],
    ['lawrune', 500],
    ['earthrune', 500],
    ['waterrune', 500]
];

/** SEED=<clueId> pins every round to one clue — for reproducing a single stall. */
const SEED_ONLY = Number(process.env.SEED ?? 0);
/** How long to let the solver walk back and bank the casket before the next trail. */
const BANK_WAIT_MS = Number(process.env.BANK_WAIT_MS ?? 180_000);
const TIER_CLUES = Object.keys(CLUE_DB)
    .map(Number)
    .filter(id => CLUE_DB[id].obj.includes(TIER))
    .sort((a, b) => a - b);
const CLUE_IDS = new Set(Object.keys(CLUE_DB).map(Number));
const CASKETS = new Set(Object.keys(CASKET_IDS).map(Number));

type Ended = 'solved' | 'abandoned' | 'died' | 'timeout';
interface Round {
    n: number;
    seedId: number;
    seedObj: string;
    ended: Ended;
    reason: string | null;
    seconds: number;
    legs: number;
    deathsDuring: number;
    /** Where it gave up — a stuck round is only diagnosable with a tile. */
    endedAt: { x: number; z: number; level: number } | null;
}

type BankRow = { name: string; count: number };
type Api = {
    rs2b0t: {
        registry: { get(n: string): unknown };
        runner: { state: string; ctx: { log: { msg: string }[] } | null; start(m: unknown): void; stop(reason: string): void };
        reader: { inventory(): { id: number }[]; chat(n: number): { text: string }[] };
    };
    __rs2b0t: {
        Game: { tile(): { x: number; z: number; level: number } | null };
        Skills: { level(n: string): number };
        Equipment: { contains(n: string): boolean };
        Execution: { delayTicks(n: number): Promise<void> };
        Inventory: { used(): number; items(): { id: number; interact(a: string): unknown }[] };
        Bank: {
            isOpen(): boolean;
            items(): { name: string | null; count: number }[];
            openNearestAccess(a: { name: string; op: string }, log?: (m: string) => void): Promise<boolean>;
            depositInventory(): Promise<void>;
            close(): Promise<boolean>;
            count(n: string): number;
        };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        registerScript(m: { name: string; create(): unknown }): unknown;
    };
    __seed?: { open: boolean; stop: boolean; done: boolean; note: string };
};

const tile = (page: Page): Promise<{ x: number; z: number; level: number } | null> =>
    page.evaluate(() => (globalThis as never as Api).__rs2b0t.Game.tile());

const runnerState = (page: Page): Promise<string> =>
    page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.state);

const logLines = (page: Page): Promise<string[]> =>
    page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

const deathCount = (page: Page): Promise<number> =>
    page.evaluate(() => (globalThis as never as Api).rs2b0t.reader.chat(200).filter(c => /oh dear.*you are dead/i.test(c.text)).length);

/** Bank rows are only readable while the modal is open; sample opportunistically. */
const bankRows = (page: Page): Promise<BankRow[] | null> =>
    page.evaluate(() => {
        const b = (globalThis as never as Api).__rs2b0t.Bank;
        return b.isOpen() ? b.items().map(i => ({ name: i.name ?? '?', count: i.count })) : null;
    });

const holdsTrailItem = (page: Page): Promise<boolean> =>
    page.evaluate(
        ids => (globalThis as never as Api).rs2b0t.reader.inventory().some(i => (ids as number[]).includes(i.id)),
        [...CLUE_IDS, ...CASKETS]
    );

/** Empty the pack of clues and caskets before seeding the next trail.
 *  Why: the engine allows one clue scroll at a time, so `::give` on top of a leftover either no-ops or leaves a state the solver cannot read. */
async function clearTrailItems(page: Page): Promise<void> {
    for (let guard = 0; guard < 30; guard++) {
        const dropped = await page.evaluate(
            ids => {
                const it = (globalThis as never as Api).__rs2b0t.Inventory.items().find(i => (ids as number[]).includes(i.id));
                if (!it) {
                    return false;
                }
                it.interact('Drop');
                return true;
            },
            [...CLUE_IDS, ...CASKETS]
        );
        if (!dropped) {
            return;
        }
        await page.waitForTimeout(700);
    }
}

async function give(page: Page, debugName: string, id: number, count = 1): Promise<boolean> {
    await cheatQuiet(page, `give ${debugName} ${count}`, 900);
    return page
        .waitForFunction(i => (globalThis as never as Api).rs2b0t.reader.inventory().some(x => x.id === i), id, { timeout: 6000 })
        .then(() => true)
        .catch(() => false);
}

/** Deposit a few loads by hand so the bank looks like a player's, not a preset's. */
async function seedBank(page: Page): Promise<BankRow[] | null> {
    await cheatQuiet(page, '~clearbank', 1500);
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const api = g.__rs2b0t;
        g.__seed = { open: false, stop: false, done: false, note: '' };
        class Seeder extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    g.__seed!.open = await api.Bank.openNearestAccess({ name: 'Bank booth', op: 'Use-quickly' }, m => this.log(m));
                    if (!g.__seed!.open) {
                        g.__seed!.note = 'could not open the Edgeville booth';
                        return;
                    }
                    while (!g.__seed!.stop) {
                        if (api.Inventory.used() > 0) {
                            await api.Bank.depositInventory();
                        }
                        await api.Execution.delayTicks(2);
                    }
                    await api.Bank.close();
                } finally {
                    g.__seed!.done = true;
                    g.rs2b0t.runner.stop('seed complete');
                }
            }
        }
        g.rs2b0t.runner.start(api.registerScript({ name: 'ClueTrailSeedBank', create: () => new Seeder() }));
    });

    const opened = await page
        .waitForFunction(() => (globalThis as never as Api).__seed?.open === true, undefined, { timeout: 40_000 })
        .then(() => true)
        .catch(() => false);
    if (!opened) {
        const note = await page.evaluate(() => (globalThis as never as Api).__seed?.note ?? 'timed out');
        fail(`bank seeding could not open the bank: ${note}`);
    }

    await cheatQuiet(page, `give coins ${SEED_COINS}`, 900);
    for (const [name, count] of SEED_RUNES) {
        await cheatQuiet(page, `give ${name} ${count}`, 700);
    }
    await page
        .waitForFunction(() => (globalThis as never as Api).__rs2b0t.Inventory.used() === 0, undefined, { timeout: 20_000 })
        .catch(() => undefined);
    for (let batch = 0; batch < SEED_BATCHES; batch++) {
        await cheatQuiet(page, 'give lobster 27', 900);
        await page
            .waitForFunction(() => (globalThis as never as Api).__rs2b0t.Inventory.used() === 0, undefined, { timeout: 20_000 })
            .catch(() => undefined);
    }
    const stocked = await page.evaluate(() => ({
        lobster: (globalThis as never as Api).__rs2b0t.Bank.count('Lobster'),
        coins: (globalThis as never as Api).__rs2b0t.Bank.count('Coins'),
        law: (globalThis as never as Api).__rs2b0t.Bank.count('Law rune'),
        air: (globalThis as never as Api).__rs2b0t.Bank.count('Air rune')
    }));
    // Baseline taken here, where the bank is provably open — the per-trail poll
    // only catches a bank stop by luck, and a missed baseline means no loot line.
    const baseline = await bankRows(page);
    await page.evaluate(() => {
        const s = (globalThis as never as Api).__seed;
        if (s) {
            s.stop = true;
        }
    });
    await page.waitForFunction(() => (globalThis as never as Api).__seed?.done === true, undefined, { timeout: 20_000 }).catch(() => undefined);

    if (stocked.lobster <= 0) {
        fail(`bank seeding deposited no Lobster (coins ${stocked.coins}) — the run would starve`);
    }
    console.log(`bank seeded: ${stocked.lobster} Lobster, ${stocked.coins} coins, ${stocked.law} Law / ${stocked.air} Air rune`);
    return baseline;
}

/** Open the bank deliberately and read it — the poll misses a two-tick modal. */
async function snapshotBank(page: Page): Promise<BankRow[] | null> {
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness: closing snapshot'));
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const api = g.__rs2b0t;
        g.__seed = { open: false, stop: false, done: false, note: '' };
        class Snap extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    g.__seed!.open = await api.Bank.openNearestAccess({ name: 'Bank booth', op: 'Use-quickly' }, m => this.log(m));
                } finally {
                    g.__seed!.done = true;
                }
            }
        }
        g.rs2b0t.runner.start(api.registerScript({ name: 'ClueTrailBankSnapshot', create: () => new Snap() }));
    });
    await page.waitForFunction(() => (globalThis as never as Api).__seed?.done === true, undefined, { timeout: 120_000 }).catch(() => undefined);
    const rows = await bankRows(page);
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness: snapshot done')).catch(() => undefined);
    return rows;
}

async function startSolver(page: Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('ClueSolver');
        if (!meta) {
            throw new Error('ClueSolver is not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    await page.waitForTimeout(600);
}

function diffBank(first: BankRow[] | null, last: BankRow[] | null): BankRow[] {
    if (!first || !last) {
        return [];
    }
    const before = new Map(first.map(r => [r.name, r.count]));
    return last
        .map(r => ({ name: r.name, count: r.count - (before.get(r.name) ?? 0) }))
        .filter(r => r.count > 0)
        .sort((a, b) => b.count - a.count);
}

async function main(): Promise<void> {
    const browser = await launchBrowser({ swiftshader: !process.env.HEADED });
    const context = await browser.newContext({ viewport: HARNESS_VIEWPORT });
    const page = await context.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const rounds: Round[] = [];
    let firstBank: BankRow[] | null = null;
    let lastBank: BankRow[] | null = null;
    const startedAt = Date.now();

    try {
        await page.goto(`${base}/bot.html`);
        await boot(page);
        if (!(await login(page, user))) {
            fail(`login failed for ${user}`);
        }
        await bringUpOffIsland(page, { user });

        for (const s of STATS) {
            await cheatQuiet(page, `setstat ${s} ${LEVEL}`, 250);
        }
        const stats = await page.evaluate(
            names => Object.fromEntries(names.map(n => [n, (globalThis as never as Api).__rs2b0t.Skills.level(n)])),
            STATS
        );
        if (Object.values(stats).some(v => v !== LEVEL)) {
            fail(`stats not all ${LEVEL}: ${JSON.stringify(stats)}`);
        }
        console.log(`${LEVEL} across the board (prayer included) — ${TRAILS} ${TIER} trails`);

        await cheatQuiet(page, `tele 0,${START.x >> 6},${START.z >> 6},${START.x & 63},${START.z & 63}`, 3500);
        await give(page, 'rune_scimitar', SCIMITAR);
        for (let i = 0; i < 4 && !(await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Equipment.contains('Rune scimitar'))); i++) {
            await page.evaluate(id => {
                const it = (globalThis as never as Api).__rs2b0t.Inventory.items().find(x => x.id === id);
                it?.interact('Wield');
            }, SCIMITAR);
            await page.waitForTimeout(1000);
        }
        firstBank = await seedBank(page);
        await give(page, 'spade', SPADE);
        for (const [debugName, id] of TRIO) {
            await give(page, debugName, id);
        }

        await setSettings(page, 'ClueSolver', {
            food: 'Lobster',
            foodWithdraw: 20,
            restorePrayer: true,
            // On by default now the runes are banked; TELEPORTS=0 forces every leg walked.
            useTeleports: process.env.TELEPORTS !== '0'
        });
        await setSettings(page, 'Global', { showNavPath: true, navPathShowText: true });
        await startSolver(page);

        let deaths = await deathCount(page);
        let seenLines = (await logLines(page)).length;

        for (let n = 0; n < TRAILS; n++) {
            // Random rather than round-robin: a fixed sequence keeps re-running the
            // same handful of starts, and a trail is meant to begin anywhere.
            const seedId = SEED_ONLY > 0 ? SEED_ONLY : TIER_CLUES[Math.floor(Math.random() * TIER_CLUES.length)];
            const seedObj = CLUE_DB[seedId].obj;
            console.log(`\n${'─'.repeat(72)}\ntrail ${n + 1}/${TRAILS} — seeding ${seedId} ${seedObj}\n${'─'.repeat(72)}`);
            // A dead runner is silent, and every later round would time out
            // against a script that is not running. Say so, and put it back.
            const before = await runnerState(page);
            if (before !== 'running') {
                console.log(`   !! solver was '${before}' — restarting it`);
                await startSolver(page);
            }
            await clearTrailItems(page);
            if (!(await give(page, seedObj, seedId))) {
                fail(`could not seed ${seedObj}`);
            }

            const t0 = Date.now();
            const deathsAtStart = deaths;
            let ended: Ended = 'timeout';
            let reason: string | null = null;
            let legs = 0;

            while (Date.now() - t0 < TRAIL_BUDGET_MS) {
                await page.waitForTimeout(POLL_MS);
                const lines = await logLines(page);
                for (const l of lines.slice(seenLines)) {
                    console.log(`   ${l}`);
                    if (l.startsWith('[clue] leg ')) {
                        legs++;
                    }
                    // Why: the solver leaves the clue in the pack when it gives up, so the "no trail item held" test never fires and the round sits out its budget.
                    const m = /\[clue\] abandoning [^:]*: (.+)$/.exec(l);
                    if (m && reason === null) {
                        reason = m[1];
                    }
                }
                seenLines = lines.length;

                const state = await runnerState(page);
                if (state !== 'running') {
                    console.log(`   !! solver stopped mid-trail (state '${state}')`);
                    reason = `solver stopped (${state})`;
                }
                if (reason !== null) {
                    ended = 'abandoned';
                    break;
                }

                const open = await bankRows(page);
                if (open) {
                    lastBank = open;
                    firstBank ??= open;
                }

                const now = await deathCount(page);
                if (now > deaths) {
                    deaths = now;
                    ended = 'died';
                    break;
                }
                if (!(await holdsTrailItem(page))) {
                    ended = 'solved';
                    break;
                }
            }

            // Why: ClueSolver walks back and banks the casket on its own after a solve, so the trail is unfinished until the loot lands.
            if (ended === 'solved') {
                const bankedAt = Date.now();
                let banked = false;
                while (Date.now() - bankedAt < BANK_WAIT_MS) {
                    await page.waitForTimeout(POLL_MS);
                    const lines = await logLines(page);
                    for (const l of lines.slice(seenLines)) {
                        console.log(`   ${l}`);
                    }
                    seenLines = lines.length;
                    const open = await bankRows(page);
                    if (open) {
                        lastBank = open;
                    }
                    if (lines.some(l => l.includes('banked the reward'))) {
                        banked = true;
                        break;
                    }
                }
                console.log(banked ? '   loot banked' : `   !! never banked within ${Math.round(BANK_WAIT_MS / 1000)}s`);
            }

            rounds.push({
                n: n + 1,
                seedId,
                seedObj,
                ended,
                reason,
                seconds: Math.round((Date.now() - t0) / 1000),
                legs,
                deathsDuring: deaths - deathsAtStart,
                endedAt: await tile(page)
            });
            const last = rounds[rounds.length - 1];
            console.log(`   => ${ended.toUpperCase()} in ${last.seconds}s (${legs} legs)${reason ? ` — ${reason}` : ''}`);
            if (ended === 'timeout' || ended === 'died') {
                const recent = (await logLines(page)).slice(-6);
                console.log(`      stuck at ${JSON.stringify(last.endedAt)}`);
                for (const l of recent) {
                    console.log(`      | ${l}`);
                }
            }

            if (!existsSync('out')) {
                mkdirSync('out', { recursive: true });
            }
            writeFileSync(
                'out/clue-trails.json',
                JSON.stringify({ user, base, tier: TIER, startedAt, rounds, deaths, loot: diffBank(firstBank, lastBank) }, null, 2)
            );
        }

        lastBank = (await snapshotBank(page)) ?? lastBank;

        const solved = rounds.filter(r => r.ended === 'solved').length;
        const died = rounds.filter(r => r.ended === 'died').length;
        const loot = diffBank(firstBank, lastBank);
        console.log(`\n${'='.repeat(72)}\n${TIER.toUpperCase()} TRAILS — ${rounds.length} run\n${'='.repeat(72)}`);
        console.log(`solved   ${solved}/${rounds.length}`);
        console.log(`died     ${died} trail(s), ${deaths} death(s) total`);
        console.log(`abandoned ${rounds.filter(r => r.ended === 'abandoned').length}`);
        console.log(`timeout  ${rounds.filter(r => r.ended === 'timeout').length}`);
        const why = rounds.filter(r => r.reason).map(r => `  ${r.seedObj}: ${r.reason}`);
        if (why.length > 0) {
            console.log(`\nabandon reasons:\n${why.join('\n')}`);
        }
        console.log(`elapsed  ${Math.round((Date.now() - startedAt) / 60_000)}m`);
        if (loot.length > 0) {
            console.log('\nloot banked:');
            for (const l of loot.slice(0, 25)) {
                console.log(`  ${String(l.count).padStart(6)}  ${l.name}`);
            }
        } else {
            console.log('\nloot banked: none observed (bank never sampled while open)');
        }
        console.log('\nproof: out/clue-trails.json');
    } finally {
        await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness end')).catch(() => undefined);
        if (!process.env.HEADED) {
            await browser.close();
        }
    }
}

await main();
