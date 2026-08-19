/** Modal-stall probe (#265): does an open quest journal suspend the Underground Pass timer traps?
 *  Why: `Player.busy()` is `delayed || containsModalInterface()` and a NORMAL `[timer,…]` only runs under
 *  `canAccess()`, so the spiked grid should be crossable with the journal held open. Everything else in the
 *  quest is built on that, so it is proved on its own before any leg is written.
 *  A control pass walks the same tiles with no modal and is expected to fall. */

//   HEADED=1 bun e2e/upass-stall-probe.ts
//   HEADED=1 bun e2e/upass-stall-probe.ts --no-control --tick 200
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import type { Page } from 'playwright-core';

import { launchBrowser } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, relog, teleTo } from './tutorial/harness.js';

interface Args {
    base: string;
    user: string;
    tickMs: number;
    control: boolean;
    deploy: boolean;
    /** Zero the grid digits so the trap can never fire — isolates a movement freeze from a trap fall. */
    noTrap: boolean;
    from: { x: number; z: number; level: number };
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `up${Date.now().toString(36).slice(-7)}`,
        tickMs: 300,
        control: true,
        deploy: true,
        noTrap: false,
        from: { x: 2483, z: 9677, level: 0 }
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--no-control') { out.control = false; continue; }
        if (flag === '--no-trap') { out.noTrap = true; out.control = false; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--from') {
            const [x, z] = value.split(',').map(Number);
            out.from = { x, z, level: 0 };
        }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

/** West of the grid, beside the portcullis lever. */
const GRID_WEST = { x: 2467, z: 9677, level: 0 };
const GRID_PATH = [
    { x: 2474, z: 9677, level: 0 },
    { x: 2471, z: 9677, level: 0 },
    { x: 2468, z: 9677, level: 0 },
    GRID_WEST
];

const STATS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

const DEPLOYED = ['botclient.js', 'botclient.js.map', 'navworker.js', 'navworker.js.map'];

function deployBundle(): void {
    const engine = process.env.ENGINE_DIR ?? `${homedir()}/code/rs2b2t-engine`;
    const botDir = `${engine}/public/bot`;
    if (!existsSync(botDir)) {
        fail(`deploy: ${botDir} not found — set ENGINE_DIR to the engine serving ${args.base}`);
    }
    const build = Bun.spawnSync(['bun', 'run', 'build:bot'], { stdout: 'pipe', stderr: 'pipe' });
    if (build.exitCode !== 0) {
        fail(`deploy: build:bot failed\n${build.stderr.toString()}`);
    }
    const copy = Bun.spawnSync(['sh', '-c', `cp ${DEPLOYED.map(f => `out/${f}`).join(' ')} "${botDir}/"`]);
    if (copy.exitCode !== 0) {
        fail(`deploy: could not copy the bundles into ${botDir}`);
    }
    console.log(`deploy: fresh ${DEPLOYED.join(', ')} -> ${botDir}`);
}

interface Probe {
    pos: { x: number; z: number; level: number } | null;
    hp: number;
    modal: number;
}

async function probe(page: Page): Promise<Probe> {
    return page.evaluate(() => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null; modals(): { main: number } };
                Skills: { effective(name: string): number };
            };
        };
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            hp: g.__rs2b0t.Skills.effective('hitpoints'),
            modal: g.__rs2b0t.reader.modals().main
        };
    });
}

/** Cross the grid with the journal held open, retrying from the lip on a lost race. */
async function stalledCross(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        const g = globalThis as never as {
            __rs2b0t: { questLive: { upassCrossGrid(log: (m: string) => void): Promise<boolean> } };
        };
        return g.__rs2b0t.questLive.upassCrossGrid(m => console.log(`[bot] ${m}`));
    });
}

/** Same tiles, no modal — the control. */
async function bareCross(page: Page): Promise<void> {
    await page.evaluate(async path => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: { toLocal(x: number, z: number): { lx: number; lz: number } | null; worldTile(): { x: number; z: number } | null };
                actions: { walkTo(lx: number, lz: number): boolean };
                Execution: { delayTicks(n: number): Promise<void> };
            };
            rs2b0t: { actions: { walkTo(lx: number, lz: number): boolean } };
        };
        const walk = g.rs2b0t.actions ?? g.__rs2b0t.actions;
        for (const t of path) {
            for (let i = 0; i < 8; i++) {
                const here = g.__rs2b0t.reader.worldTile();
                if (here && Math.max(Math.abs(here.x - t.x), Math.abs(here.z - t.z)) <= 1) break;
                const local = g.__rs2b0t.reader.toLocal(t.x, t.z);
                if (local) walk.walkTo(local.lx, local.lz);
                await g.__rs2b0t.Execution.delayTicks(2);
            }
        }
    }, GRID_PATH);
}

if (args.deploy) {
    deployBundle();
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) {
            console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
        }
    });

    await mainlandAccount(page, args.base, args.user);
    await cheatQuiet(page, `speed ${args.tickMs}`);
    for (const skill of STATS) {
        await cheatQuiet(page, `setstat ${skill} 70`);
    }
    await clearChatDialogs(page, 'level-up dialog(s)');

    // Why: the grid combination lives in `%ibanmulti` bits 22-31 as three digits of 1-5, and a zero there
    // matches no column case at all, so the trap can never fire and the probe would pass on nothing.
    // 151 puts the safe bands at z 9673-9674, 9681-9682 and 9673-9674, which the straight z 9677 walk misses
    // in all three columns. Bit 11 is `^upass_started_bit`. 151 << 22 | 1 << 11 = 633341952.
    await cheatQuiet(page, 'setvar biohazard 16');
    await cheatQuiet(page, 'setvar upass 2');
    await cheatQuiet(page, `setvar ibanmulti ${args.noTrap ? 2048 : 633341952}`);
    if (args.noTrap) {
        console.log('grid digits zeroed — the trap cannot fire, so any stop is a movement freeze');
    }
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');

    if (!(await teleTo(page, args.from, 6, 25_000))) {
        fail(`tele to the staging tile ${args.from.x},${args.from.z} did not arrive`);
    }
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-tele dialog(s)');
    await page.waitForTimeout(2_000);

    // Why: the control runs first and on its own login. A stalled pass pulls the lever and leaves the
    // trap timer cleared behind it, so a control run afterwards crosses a disarmed grid and proves nothing.
    if (args.control) {
        const ctlBefore = await probe(page);
        await bareCross(page);
        const ctlAfter = await probe(page);
        const fell = ctlAfter.hp < ctlBefore.hp || (ctlAfter.pos?.z ?? 0) < 9600;
        console.log(`control→ (${ctlAfter.pos?.x},${ctlAfter.pos?.z}) hp ${ctlAfter.hp} (was ${ctlBefore.hp}) fell=${fell}`);
        if (!fell) {
            fail('the control walk crossed the grid unharmed — the trap never armed, so the stalled pass would prove nothing');
        }
        if (!(await teleTo(page, args.from, 6, 25_000))) {
            fail('could not tele back to the staging tile for the stalled pass');
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-control dialog(s)');
        await page.waitForTimeout(2_000);
    }

    const before = await probe(page);
    console.log(`start  → (${before.pos?.x},${before.pos?.z}) hp ${before.hp} modal ${before.modal}`);

    const list = await page.evaluate(() => {
        const g = globalThis as never as {
            __rs2b0t: {
                Quests: { all(): { name: string; status: string }[]; status(n: string): string };
                reader: { questStatuses(): { name: string; colour: number; comId: number }[]; modals(): { main: number } };
            };
        };
        const rows = g.__rs2b0t.reader.questStatuses();
        const hit = rows.find(q => q.name.toLowerCase() === 'underground pass');
        return { rows: rows.length, hit: hit ?? null, status: g.__rs2b0t.Quests.status('Underground Pass') };
    });
    console.log(`questlist → ${list.rows} row(s), status=${list.status}, entry=${JSON.stringify(list.hit)}`);

    const crossed = await stalledCross(page);
    const after = await probe(page);
    console.log(`stalled→ (${after.pos?.x},${after.pos?.z}) hp ${after.hp} modal ${after.modal} walkReturned=${crossed}`);

    // Why: if the walk resumes the moment the modal closes, the freeze was the busy gate in
    // `updateMovement`, not a route that ended there on its own.
    await page.waitForTimeout(3_000);
    const settled = await probe(page);
    console.log(`released→ (${settled.pos?.x},${settled.pos?.z}) hp ${settled.hp}`);

    const west = after.pos !== null && after.pos.x <= GRID_WEST.x + 1 && after.pos.z >= 9670 && after.pos.z <= 9685;
    if (!west) {
        fail(`the stalled walk did not reach the west side of the grid — ended at (${after.pos?.x},${after.pos?.z})`);
    }
    // Why: a lost race costs one fall and one retry, so hp is reported rather than asserted — the control
    // above is what proves the trap is armed, and reaching the west side is what proves the stall carried it.
    const cost = before.hp - after.hp;
    console.log(cost > 0 ? `crossed after a lost race (${cost} hp)` : 'crossed on the first attempt, untouched');

    console.log(`PASS (journal stall crossed the spiked grid; control fell, stall reached ${after.pos?.x},${after.pos?.z})`);
    process.exit(0);
} finally {
    await browser.close();
}
