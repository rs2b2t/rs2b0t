// Live proof: a hard-clue dig guardian is fought while eating. Proof: out/clue-guardian-eat-proof.json
// Why: one SolveClue call spans a full trail, so a host's own Eat task never gets a turn between legs; prayer stays at 1 so Protect from Magic cannot blunt the wizard.

//   HEADED=1 bun e2e/clue-guardian-eat-live.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { HARNESS_VIEWPORT, boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, parseArgs, setSettings } from './lib/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8888' });
const user = process.env.USER_NAME ?? `guard${Date.now() % 100000}`;

/** trail_clue_hard_sextant012 — digs at (3055,3696), guarded by a Zamorak Wizard. */
const CLUE_ID = 2745;
const CLUE_OBJ = 'trail_clue_hard_sextant012';
const DIG = { x: 3055, z: 3696, level: 0 } as const;
/** Edgeville: the trail's own bank stop, so the run starts on top of it. */
const START = { x: 3094, z: 3493, level: 0 } as const;

const SCIMITAR = 1333;
const SPADE = 952;
const TRIO: [string, number, string][] = [
    ['trail_sextant', 2574, 'Sextant'],
    ['trail_watch', 2575, 'Watch'],
    ['trail_chart', 2576, 'Chart']
];
/**
 * PlayerStatMap minus prayer — this build has no slayer, and STAT18/19 are
 * disabled placeholders, so ::setstat rejects anything outside this set.
 */
const STATS = [
    'attack', 'strength', 'defence', 'ranged', 'magic', 'hitpoints',
    'crafting', 'mining', 'smithing', 'fishing', 'cooking', 'firemaking',
    'woodcutting', 'runecraft', 'herblore', 'agility', 'thieving', 'fletching'
];
const LEVEL = 70;

const GUARDIAN = 'Zamorak Wizard';
const BUDGET_MS = Number(process.env.BUDGET_MS ?? 900_000);
/** SCRIPTED_HIT=n forces blood if the wizard splashes; off by default. */
const SCRIPTED_HIT = Number(process.env.SCRIPTED_HIT ?? 0);

type Api = {
    rs2b0t: {
        registry: { get(n: string): unknown };
        runner: { ctx: { log: { msg: string }[] } | null; start(m: unknown): void; stop(): void };
        reader: { inventory(): { id: number; name: string | null; count: number }[]; chat(n: number): { text: string }[] };
    };
    __rs2b0t: {
        Game: { tile(): { x: number; z: number; level: number } | null };
        Skills: { level(n: string): number; effective(n: string): number };
        Inventory: { items(): { id: number; name: string | null }[]; count(n: string): number };
        Equipment: { contains(n: string): boolean };
        Npcs: { all(): { name: string | null; distance(): number }[] };
    };
};

const logLines = (page: Page): Promise<string[]> =>
    page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

/** 0 means the stat array was mid-update, not a corpse — deaths are read from chat. */
const hp = (page: Page): Promise<number> =>
    page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.effective('hitpoints'));

const died = (page: Page): Promise<boolean> =>
    page.evaluate(() => (globalThis as never as Api).rs2b0t.reader.chat(30).some(c => /oh dear.*you are dead/i.test(c.text)));

const foodLeft = (page: Page): Promise<number> =>
    page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.count('Lobster'));

const chatLines = (page: Page): Promise<string[]> =>
    page.evaluate(() => (globalThis as never as Api).rs2b0t.reader.chat(40).map(c => c.text));

const guardianUp = (page: Page): Promise<boolean> =>
    page.evaluate(n => (globalThis as never as Api).__rs2b0t.Npcs.all().some(x => x.name === n), GUARDIAN);

/** Its health bar is the only honest answer to whether the bot is hitting it. */
const guardianState = (page: Page): Promise<{ hp: number; dist: number; tile: unknown } | null> =>
    page.evaluate(n => {
        const g = (globalThis as never as Api).__rs2b0t.Npcs.all().find(x => x.name === n) as
            | { health: number; distance(): number; tile(): unknown }
            | undefined;
        return g ? { hp: g.health, dist: g.distance(), tile: g.tile() } : null;
    }, GUARDIAN);

async function give(page: Page, debugName: string, id: number, count: number): Promise<void> {
    await cheatQuiet(page, `give ${debugName} ${count}`, 1000);
    const ok = await page
        .waitForFunction(
            ([itemId, want]) => (globalThis as never as Api).rs2b0t.reader.inventory().filter(i => i.id === itemId).length >= want,
            [id, count] as const,
            { timeout: 6000 }
        )
        .then(() => true)
        .catch(() => false);
    if (!ok) {
        const inv = await page.evaluate(() => (globalThis as never as Api).rs2b0t.reader.inventory().map(i => `${i.name}#${i.id}`));
        fail(`::give ${debugName} x${count} did not land; inventory=${JSON.stringify(inv)}`);
    }
}

async function equipScimitar(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
        if (await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Equipment.contains('Rune scimitar'))) {
            return;
        }
        await page.evaluate(id => {
            const it = (globalThis as never as Api).__rs2b0t.Inventory.items().find(i => i.id === id) as
                | { interact(a: string): unknown }
                | undefined;
            it?.interact('Wield');
        }, SCIMITAR);
        await page.waitForTimeout(1200);
    }
    fail('could not wield the rune scimitar');
}

async function main(): Promise<void> {
    const browser = await launchBrowser({ swiftshader: !process.env.HEADED });
    // VIDEO=1 records the run to out/ so the fight can be watched back.
    const context = await browser.newContext(
        process.env.VIDEO
            ? { viewport: HARNESS_VIEWPORT, recordVideo: { dir: 'out/guardian-video', size: HARNESS_VIEWPORT } }
            : { viewport: HARNESS_VIEWPORT }
    );
    const page = await context.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const proof: Record<string, unknown> = { user, base, clue: CLUE_ID, dig: DIG };
    try {
        await page.goto(`${base}/bot.html`);
        await boot(page);
        if (!(await login(page, user))) {
            fail(`login failed for ${user}`);
        }
        await bringUpOffIsland(page, { user });

        console.log(`stats: ${LEVEL} across the board, prayer left at 1`);
        for (const s of STATS) {
            await cheatQuiet(page, `setstat ${s} ${LEVEL}`, 250);
        }
        const stats = await page.evaluate(
            names => {
                const sk = (globalThis as never as Api).__rs2b0t.Skills;
                return Object.fromEntries([...names, 'prayer'].map(n => [n, sk.level(n)]));
            },
            STATS
        );
        proof.stats = stats;
        const wrong = Object.entries(stats).filter(([n, v]) => (n === 'prayer' ? v !== 1 : v !== LEVEL));
        if (wrong.length > 0) {
            fail(`stats not as asked: ${JSON.stringify(wrong)} (want ${LEVEL} everywhere, prayer 1)`);
        }
        console.log(`  ${JSON.stringify(stats)}`);

        await cheatQuiet(page, '~bank_f2p', 2500);
        await cheatQuiet(page, `tele 0,${START.x >> 6},${START.z >> 6},${START.x & 63},${START.z & 63}`, 3500);

        await give(page, 'rune_scimitar', SCIMITAR, 1);
        await equipScimitar(page);
        await give(page, 'spade', SPADE, 1);
        for (const [debugName, id] of TRIO) {
            await give(page, debugName, id, 1);
        }
        // Why: `~bank_f2p` stocks a max-int lobster stack that refuses further deposits, so seeded food costs the bank stop 64s of failed hand-over; the prep withdraws its own.
        await give(page, CLUE_OBJ, CLUE_ID, 1);

        await setSettings(page, 'ClueSolver', {
            food: 'Lobster',
            foodWithdraw: 20,
            // The point of the run: no prayer, so the guardian's damage lands.
            restorePrayer: false,
            useTeleports: false
        });
        await page.evaluate(() => {
            const g = globalThis as never as Api;
            const meta = g.rs2b0t.registry.get('ClueSolver');
            if (!meta) {
                throw new Error('ClueSolver is not registered');
            }
            g.rs2b0t.runner.start(meta);
        });
        console.log(`ClueSolver started — walking to the dig at (${DIG.x},${DIG.z})`);

        const started = Date.now();
        const deadline = started + BUDGET_MS;
        let hitApplied = false;
        let fightSeen = false;
        let fightStart = Date.now();
        let minHp = await hp(page);
        let lastReport = 0;
        let seenLines = (await logLines(page)).length;
        let lastRow = '';
        const trace: { t: number; hp: number; food: number; guardian: unknown }[] = [];
        const stamp = (): string => `+${((Date.now() - started) / 1000).toFixed(1)}s`.padStart(8);

        while (Date.now() < deadline) {
            await page.waitForTimeout(fightSeen ? 200 : 1000);
            const lines = await logLines(page);
            const now = await hp(page);
            const up = await guardianUp(page);

            // Interleave the bot's own log with the world state, so a bite and the
            // tick it landed (or did not) sit next to each other.
            for (const l of lines.slice(seenLines)) {
                console.log(`${stamp()}  ${l}`);
            }
            seenLines = lines.length;

            if (up && !fightSeen) {
                fightSeen = true;
                fightStart = Date.now();
                console.log(`\n${'='.repeat(64)}\n>> ${GUARDIAN} IS UP — WATCH NOW\n   hp | food | wizard\n${'='.repeat(64)}`);
            }
            if (up && !hitApplied && SCRIPTED_HIT > 0) {
                await cheatQuiet(page, `~hit ${SCRIPTED_HIT}`, 300);
                hitApplied = true;
                console.log(`${stamp()}  >> scripted ${SCRIPTED_HIT} damage`);
            }
            if (fightSeen) {
                const food = await foodLeft(page);
                const g = await guardianState(page);
                trace.push({ t: Math.round((Date.now() - fightStart) / 1000), hp: now, food, guardian: g });
                // Only on change: a 200ms poll on a 600ms tick triples every row.
                const row = `${String(now).padStart(3)} | ${String(food).padStart(4)} | ${g ? g.hp : '-'}`;
                if (row !== lastRow) {
                    lastRow = row;
                    console.log(`${stamp()}  ${row}`);
                }
            }
            if (fightSeen && now > 0) {
                minHp = Math.min(minHp, now);
            }
            if (await died(page)) {
                proof.died = true;
                console.log(`${stamp()}  !! the bot DIED — the fight was not survived`);
                break;
            }
            if (!fightSeen && Date.now() - lastReport > 15_000) {
                lastReport = Date.now();
                const tile = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Game.tile());
                console.log(`${stamp()}  walking… hp=${now} at ${JSON.stringify(tile)}`);
            }
            // Guardian.ts's own verdict, not an NPC-snapshot read: `all()` blanks
            // for a tick now and then, and a blank list is not a dead wizard.
            if (lines.some(l => l.includes(`${GUARDIAN} killed`) || l.includes('still standing'))) {
                break;
            }
            if (lines.some(l => l.includes('abandoning'))) {
                console.log('!! the trail abandoned — dumping the log');
                break;
            }
        }

        const lines = await logLines(page);
        const engaged = lines.find(l => l.includes('guards this dig'));
        const killed = lines.find(l => l.includes(`${GUARDIAN} killed`));
        const noPrayer = lines.find(l => l.includes('no Protect from Magic available'));
        const ate = lines.filter(l => /\[clue\] eating /.test(l));

        proof.engaged = engaged ?? null;
        proof.killed = killed ?? null;
        proof.noPrayer = noPrayer ?? null;
        proof.ate = ate;
        proof.minHpDuringFight = minHp;
        proof.finalHp = await hp(page);
        proof.log = lines;
        proof.trace = trace;
        proof.chat = await chatLines(page);

        if (!existsSync('out')) {
            mkdirSync('out', { recursive: true });
        }
        writeFileSync('out/clue-guardian-eat-proof.json', JSON.stringify(proof, null, 2));

        console.log('\n==== result ====');
        console.log(`guardian engaged : ${engaged ?? 'NO'}`);
        console.log(`prayer unavailable: ${noPrayer ?? 'NO (prayer was up?)'}`);
        console.log(`ate during fight : ${ate.length} bite(s)`);
        for (const l of ate) {
            console.log(`   ${l}`);
        }
        console.log(`lowest hp        : ${minHp} (final ${proof.finalHp})`);
        console.log(`guardian killed  : ${killed ?? 'NO'}`);
        console.log('proof: out/clue-guardian-eat-proof.json');

        if (!engaged) {
            fail('never engaged the guardian — the dig did not spawn it');
        }
        // Why: the fight resolves in ~6s with huge swings, so a 1Hz poll misses the trough — a bite at all means shouldEatToUseFood fired, and only a run with no bite lets the sampled hp decide.
        const LOBSTER_HEAL = 12;
        if (ate.length === 0) {
            if (minHp > LEVEL - LOBSTER_HEAL) {
                console.log(`\nINCONCLUSIVE: the wizard splashed — hp never sampled below ${LEVEL - LOBSTER_HEAL}, so no bite was due.`);
                console.log('Re-run, or force the damage with SCRIPTED_HIT=25.');
                process.exit(2);
            }
            fail(`THE BUG: dropped to ${minHp}/${LEVEL} fighting the guardian and never ate`);
        }
        const atHp = ate.map(l => Number(/\((\d+)\//.exec(l)?.[1] ?? LEVEL));
        console.log(`lowest hp at a bite: ${Math.min(...atHp)}/${LEVEL}`);
        if (proof.died === true) {
            fail('ate, but still died in the fight');
        }
        if (!killed) {
            fail('ate, but never finished the guardian off');
        }
        console.log('\nPASS: the guardian fight ate, and was survived.');
    } finally {
        await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop()).catch(() => undefined);
        if (process.env.VIDEO) {
            const video = page.video();
            await context.close();
            const path = await video?.path();
            console.log(`video: ${path ?? 'none'}`);
        } else if (!process.env.HEADED) {
            await browser.close();
        }
    }
}

await main();
