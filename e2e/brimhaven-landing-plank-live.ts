// Live regression: the Brimhaven landing must cross the one plank row with no broken plank.
//
//   ENGINE_DIR=... PROOF_DIR=... bun e2e/brimhaven-landing-plank-live.ts --base http://127.0.0.1:1080
//   AFTER_REBUILD=1 ENGINE_DIR=... PROOF_DIR=... bun e2e/brimhaven-landing-plank-live.ts --base http://127.0.0.1:1080
//   EXPECT_MODE=before ENGINE_DIR=... PROOF_DIR=... bun e2e/brimhaven-landing-plank-live.ts --base http://127.0.0.1:1080
//
// The ground truth is the client's own plank locs, read by loc type id, and it is kept apart from the script's choice.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

import { inArena, pillarFromHint, platformAt } from '#/bot/scripts/BrimhavenAgility/BrimhavenAgilityLogic.js';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2));
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'local engine required');
const tag = `brim${Date.now().toString(36).slice(-7)}`;
const user = `${process.env.ACCOUNT_PREFIX ?? 'upbrim'}${Date.now().toString(36).slice(-5)}`;
const proofDir = process.env.PROOF_DIR ?? 'out/brimhaven-landing-plank';
const before = process.env.EXPECT_MODE === 'before';
const afterRebuild = process.env.AFTER_REBUILD === '1';
const engine = process.env.ENGINE_DIR;
assert(engine, 'ENGINE_DIR required');
mkdirSync(proofDir, { recursive: true });

// Pillars whose shorter hop path from the ladder landing is the 24↔23 plank.
const PLANK_GOALS = new Set([5, 10, 11, 15, 16, 17, 20, 21, 22, 23]);
// Why: these come from the content, not from the script under test, so the harness cannot agree with a wrong table.
// content/pack/loc.pack: 3573-3575 are agilityarena_plank*_middle (intact) and 3576 is agilityarena_plank_broke1.
const BROKEN_LOC = 3576;
const INTACT_LOCS = [3573, 3574, 3575];
// content/scripts/minigames/game_agilityarena/scripts/agilityarena_clerk.rs2: the three plank rows between the landing (24) and platform 23.
const ROWS = [9589, 9590, 9591];
const OUTER_X = [2798, 2801];
const MIDDLE_ROW = 9590;
const ENTRANCE = { x: 2809, z: 3194, level: 0 };
const ENTRY_MS = 180_000;
const GATE_WAIT_MS = 15 * 60_000;
const SETTLE_MS = 40_000;
const ATTEMPTS = 6;

interface Tile {
    x: number;
    z: number;
    level: number;
}
interface Plank {
    id: number;
    x: number;
    z: number;
}
interface Snap {
    tile: Tile | null;
    hint: Tile | null;
    xp: number;
    level: number;
    coins: number;
    planks: Plank[];
    logs: string[];
}
interface Api {
    rs2b0t: {
        reader: {
            worldTile(): Tile | null;
            hintTile(): Tile | null;
        };
        runner: {
            pause(): void;
            resume(): void;
            ctx: { log: { msg: string }[] } | null;
        };
    };
    __rs2b0t: {
        Skills: { xp(name: string): number; level(name: string): number };
        Inventory: { count(name: string): number };
        reader: { locs(): { id: number; name: string | null; tile: Tile }[] };
    };
}

const client = deployIsolatedClient(tag, engine);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const attempts: unknown[] = [];

const snap = (): Promise<Snap> =>
    page.evaluate(
        ({ rows, outer }) => {
            const g = globalThis as never as Api;
            const pub = g.rs2b0t;
            const api = g.__rs2b0t;
            return {
                tile: pub.reader.worldTile(),
                hint: pub.reader.hintTile(),
                xp: api.Skills.xp('agility'),
                level: api.Skills.level('agility'),
                coins: api.Inventory.count('Coins'),
                planks: api.reader
                    .locs()
                    .filter(loc => loc.name === 'Plank' && rows.includes(loc.tile.z) && outer.includes(loc.tile.x))
                    .map(loc => ({ id: loc.id, x: loc.tile.x, z: loc.tile.z })),
                logs: pub.runner.ctx?.log.map(line => line.msg) ?? []
            };
        },
        { rows: ROWS, outer: OUTER_X }
    );

/** Rows whose two outer tiles both hold an intact plank, read from the client's loc type ids. */
function intactRows(planks: Plank[]): number[] {
    return ROWS.filter(z => OUTER_X.every(x => planks.some(p => p.x === x && p.z === z && INTACT_LOCS.includes(p.id))));
}

function brokenRows(planks: Plank[]): number[] {
    return ROWS.filter(z => planks.some(p => p.z === z && p.id === BROKEN_LOC));
}

function layoutOf(planks: Plank[]): string {
    return ROWS.map(z => `${z}:${OUTER_X.map(x => planks.find(p => p.x === x && p.z === z)?.id ?? '?').join('/')}`).join(' ');
}

function landingPlatform(tile: Tile | null): number {
    if (!tile || tile.level < 3 || !inArena(tile.x, tile.z)) {
        return -1;
    }
    return platformAt(tile.x, tile.z);
}

function hintPillar(hint: Tile | null): number {
    return hint ? pillarFromHint(hint.x, hint.z) : -1;
}

function plankClick(logs: string[]): { x: number; z: number } | null {
    const crossing = logs.findIndex(line => /crossing plank 24→23/.test(line));
    if (crossing < 0) {
        return null;
    }
    for (const line of logs.slice(crossing)) {
        const match = /Walk-on Plank @ (\d+),(\d+)/.exec(line);
        if (match) {
            return { x: Number(match[1]), z: Number(match[2]) };
        }
    }
    return null;
}

const fell = (logs: string[]): boolean => logs.some(line => /fell into the pit/.test(line));

async function pauseScript(): Promise<void> {
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.pause());
}

async function resumeScript(): Promise<void> {
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.resume());
}

interface Sample {
    atMs: number;
    pillar: number;
    layout: string;
    intact: number[];
}

try {
    await mainlandAccount(page, base, user, client.page);
    assert(await cheatQuiet(page, 'setstat agility 75'), 'setstat agility failed');
    assert(await cheatQuiet(page, 'setstat hitpoints 40'), 'setstat hitpoints failed');
    assert(await cheatQuiet(page, 'give coins 1000'), 'give coins failed');
    assert(await cheatQuiet(page, 'give lobster 10'), 'give lobster failed');
    await clearChatDialogs(page, 'prep');
    await setSettings(page, 'BrimhavenAgility', {
        food: 'Lobster',
        foodWithdraw: 10,
        bankAtTickets: 1000,
        stealRestock: false
    });

    let verdict = 'unconfirmed';
    for (let attempt = 1; attempt <= ATTEMPTS && verdict === 'unconfirmed'; attempt++) {
        await stopScript(page).catch(() => undefined);
        // Why: a restock stop spends the fare and leaves the account short, so the next attempt cannot pay the ship.
        assert(await cheatQuiet(page, 'give coins 1000'), `attempt ${attempt} coin top-up failed`);
        let teleported = false;
        for (let tele = 1; tele <= 3 && !teleported; tele++) {
            teleported = await teleTo(page, ENTRANCE, 2);
            if (!teleported) {
                await page.waitForTimeout(1000);
            }
        }
        if (!teleported) {
            const missed = await snap();
            attempts.push({ attempt, outcome: 'teleport-failed', tile: missed.tile });
            console.log(`ATTEMPT ${attempt} teleport failed @ ${JSON.stringify(missed.tile)}`);
            continue;
        }
        await clearChatDialogs(page, `attempt ${attempt}`);
        await startScript(page, 'BrimhavenAgility');
        const entryDeadline = Date.now() + ENTRY_MS;
        let entered: Snap | null = null;
        while (Date.now() < entryDeadline) {
            const seen = await snap();
            if (landingPlatform(seen.tile) === 24 && !seen.logs.some(line => /crossing /.test(line))) {
                await pauseScript();
                entered = await snap();
                break;
            }
            if (seen.logs.some(line => /crossing /.test(line)) || (seen.tile && seen.tile.level < 3 && inArena(seen.tile.x, seen.tile.z))) {
                break;
            }
            await page.waitForTimeout(100);
        }
        if (!entered || landingPlatform(entered.tile) !== 24) {
            const missed = await snap();
            attempts.push({ attempt, outcome: 'missed-landing', tile: missed.tile, logs: missed.logs.slice(-8) });
            console.log(`ATTEMPT ${attempt} missed landing @ ${JSON.stringify(missed.tile)}`);
            continue;
        }

        // Why: the crossing worth judging has a plank-route pillar and an intact row that is NOT the middle one. The map ships with the middle row intact, and the clerk only rebuilds the rows when it assigns a new pillar, so any other intact row was built by a rebuild and is the case a fixed-row script falls on.
        // Why: AFTER_REBUILD=1 also requires a new ticket pillar to have appeared while the harness watched, which is a rebuild seen live rather than inferred.
        const started = Date.now();
        const samples: Sample[] = [];
        let armed = entered;
        let gated = false;
        let rebuilds = 0;
        let seenPillar = -1;
        while (Date.now() - started < GATE_WAIT_MS) {
            armed = await snap();
            if (landingPlatform(armed.tile) !== 24) {
                break;
            }
            const pillar = hintPillar(armed.hint);
            const layout = layoutOf(armed.planks);
            const intact = intactRows(armed.planks);
            const last = samples[samples.length - 1];
            if (!last || last.pillar !== pillar || last.layout !== layout) {
                samples.push({ atMs: Date.now() - started, pillar, layout, intact });
                console.log(`  pillar ${pillar} rows ${layout} intact ${JSON.stringify(intact)}`);
            }
            if (pillar >= 0 && pillar !== seenPillar) {
                rebuilds += seenPillar >= 0 ? 1 : 0;
                seenPillar = pillar;
            }
            if (PLANK_GOALS.has(pillar) && intact.length === 1 && intact[0] !== MIDDLE_ROW && (!afterRebuild || rebuilds >= 1)) {
                gated = true;
                break;
            }
            await page.waitForTimeout(1000);
        }
        const pillar = hintPillar(armed.hint);
        if (!gated || landingPlatform(armed.tile) !== 24) {
            attempts.push({ attempt, outcome: 'no-gate', pillar, layout: layoutOf(armed.planks), tile: armed.tile, rebuilds, samples });
            console.log(`ATTEMPT ${attempt} no discriminating plank crossing offered (pillar ${pillar})`);
            continue;
        }

        const startXp = armed.xp;
        const armedLayout = layoutOf(armed.planks);
        const armedIntact = intactRows(armed.planks);
        await resumeScript();
        let outcome = 'watching';
        let last = armed;
        let truthAtClick: Plank[] | null = null;
        let click: { x: number; z: number } | null = null;
        const watchDeadline = Date.now() + SETTLE_MS + 30_000;
        let settledBy = 0;
        let arrivedBy = 0;
        while (Date.now() < watchDeadline) {
            last = await snap();
            if (click === null) {
                click = plankClick(last.logs);
                if (click !== null) {
                    truthAtClick = last.planks;
                    settledBy = Date.now() + SETTLE_MS;
                }
            }
            if (click !== null) {
                const intactAtClick = intactRows(truthAtClick ?? []);
                const onIntact = intactAtClick.includes(click.z);
                if (fell(last.logs)) {
                    outcome = onIntact ? 'fell-on-intact-row' : 'fell-on-broken-row';
                    break;
                }
                if (landingPlatform(last.tile) === 23 && arrivedBy === 0) {
                    arrivedBy = Date.now() + 10_000;
                }
                // Why: the plank grants its XP on the last step, a moment after the client shows the tile on 23.
                if (last.xp > startXp || (arrivedBy > 0 && Date.now() > arrivedBy)) {
                    const crossed = intactAtClick[0] === MIDDLE_ROW ? 'safe-middle-row' : 'crossed-intact-row';
                    outcome = !onIntact ? 'crossed-broken-row' : last.xp > startXp ? crossed : 'crossed-no-xp';
                    break;
                }
                if (Date.now() > settledBy) {
                    outcome = 'unsettled';
                    break;
                }
            }
            await page.waitForTimeout(300);
        }
        const shot = `${proofDir}/${tag}-attempt-${attempt}.png`;
        await page.screenshot({ path: shot });
        const record = {
            attempt,
            outcome,
            pillar,
            armedLayout,
            armedIntactRows: armedIntact,
            layoutAtClick: truthAtClick ? layoutOf(truthAtClick) : null,
            intactRowsAtClick: truthAtClick ? intactRows(truthAtClick) : null,
            brokenRowsAtClick: truthAtClick ? brokenRows(truthAtClick) : null,
            clickedPlank: click,
            fell: fell(last.logs),
            startXp,
            rebuildsSeen: rebuilds,
            endXp: last.xp,
            tile: last.tile,
            coins: last.coins,
            level: last.level,
            samples,
            logs: last.logs,
            screenshot: shot
        };
        attempts.push(record);
        console.log(`ATTEMPT ${attempt} ${outcome} pillar=${pillar} click=${JSON.stringify(click)} layout=${record.layoutAtClick} intact=${JSON.stringify(record.intactRowsAtClick)} xp ${startXp}->${last.xp} fell=${record.fell}`);
        if (before) {
            // Why: a before run that crossed means the middle row was not broken at that click, so it only retries.
            verdict = outcome === 'fell-on-broken-row' ? 'reproduced' : verdict;
        } else if (outcome === 'crossed-intact-row') {
            verdict = 'pass';
        } else if (outcome !== 'safe-middle-row' && outcome !== 'watching') {
            verdict = outcome;
        }
    }

    const proof = {
        classification: verdict,
        tag,
        user,
        base,
        before,
        afterRebuild,
        fixture:
            'Agility 75, Hitpoints 40, 1000 coins plus 1000 more before each attempt, 10 lobsters, teleported to the arena entrance. Real Cap\'n Izzy payment, real Climb-Down, real pillar rotation and plank rebuilds. The run waits at the landing for a plank-route pillar with an intact row other than the middle one, then lets the script cross. No spawned obstacles.',
        attempts
    };
    writeFileSync(`${proofDir}/${tag}.json`, JSON.stringify(proof, null, 2));
    await page.screenshot({ path: `${proofDir}/${tag}.png` });
    if (before) {
        assert.equal(verdict, 'reproduced', `defect not reproduced (${verdict})`);
        console.log('REPRODUCED fall on the middle plank row while another row was intact');
    } else {
        assert.equal(verdict, 'pass', `landing plank crossing did not pass (${verdict})`);
        console.log('PASS landing plank crossed on the intact row with no fall');
    }
} catch (error) {
    const result = await snap().catch(() => null);
    writeFileSync(
        `${proofDir}/${tag}.json`,
        JSON.stringify({ classification: 'unconfirmed', tag, user, before, error: String(error), attempts, result }, null, 2)
    );
    await page.screenshot({ path: `${proofDir}/${tag}-failure.png` }).catch(() => undefined);
    throw error;
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
    const paths = [`${engine}/public/bot/${tag}`, `${engine}/public/bot-${tag}.html`];
    assert(paths.every(path => !existsSync(path)), 'isolated deployment cleanup failed');
    console.log(`CLEANUP ${JSON.stringify(paths)}`);
}
