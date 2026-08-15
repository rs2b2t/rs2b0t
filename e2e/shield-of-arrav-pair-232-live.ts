/** Live Shield of Arrav pair harness (#232): two accounts, one per gang, trading their way to a completion.
 *  Why: the quest cannot be finished alone — the crossbows sit behind a door only Straven's key opens, joining Phoenix makes Katrine refuse you, and the curator wants both halves in one pack. This is the only run that turns the journal green.
 *  Why: one browser context per account, because settings live in sessionStorage keyed `rs2b0t:set:<Script>:<key>` and a shared context would cross-contaminate the two bots. */

//   HEADED=1 bun e2e/shield-of-arrav-pair-232-live.ts --certs 2 --tick 300 --minutes 90
//   HEADED=1 bun e2e/shield-of-arrav-pair-232-live.ts --certs 6 --tick 300 --minutes 150
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import type { Page } from 'playwright-core';

import { launchBrowser } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    getServerVarQuiet,
    mainlandAccount,
    seedItemsToBank,
    startScript,
    teleTo,
    type BankSeedItem
} from './tutorial/harness.js';

interface Args {
    base: string;
    phoenixUser: string;
    blackarmUser: string;
    certs: number;
    minutes: number;
    tickMs: number;
    stats: number;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const stamp = Date.now().toString(36).slice(-6);
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        phoenixUser: process.env.PHOENIX_NAME || `soap${stamp}`,
        blackarmUser: process.env.BLACKARM_NAME || `soab${stamp}`,
        certs: 2,
        minutes: 90,
        tickMs: 300,
        stats: 99,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--certs') { out.certs = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--stats') { out.stats = Number(value); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Shield of Arrav';
const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };

/** Coins and food only — every quest item has a source in the world. */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

const STATS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

async function setStats(page: Page, level: number): Promise<void> {
    for (const skill of STATS) {
        await cheatQuiet(page, `setstat ${skill} ${level}`);
    }
    await clearChatDialogs(page, 'level-up dialog(s)');
    await page.waitForTimeout(1500);
    await clearChatDialogs(page, 'straggler dialog(s)');
}

interface Snapshot {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(quest => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null };
                Quests: { status(n: string): string; points(): number };
            };
            rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
        };
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            status: g.__rs2b0t.Quests.status(quest),
            qp: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            logs: ring.slice(-40).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

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
    const files = DEPLOYED.map(f => `out/${f}`).join(' ');
    const copy = Bun.spawnSync(['sh', '-c', `cp ${files} "${botDir}/"`]);
    if (copy.exitCode !== 0) {
        fail(`deploy: could not copy the bundles into ${botDir}`);
    }
    console.log(`deploy: fresh ${DEPLOYED.join(', ')} -> ${botDir}`);
}

async function setArrav(page: Page, gang: string, partner: string, certs: number): Promise<void> {
    await page.evaluate(entries => {
        for (const [k, v] of Object.entries(entries)) {
            sessionStorage.setItem(`rs2b0t:set:AIOQuester:${k}`, v);
        }
    }, { quests: 'blackarmgang', arravGang: gang, arravPartner: partner, arravCerts: String(certs) });
}

async function bringUp(page: Page, user: string, gang: string, partner: string): Promise<void> {
    await mainlandAccount(page, args.base, user);
    console.log(`mainland-ready as '${user}' (${gang})`);
    await cheatQuiet(page, `speed ${args.tickMs}`);
    await setStats(page, args.stats);
    await seedItemsToBank(page, BANK_SEED, VARROCK_WEST_BANK);
    if (!(await teleTo(page, VARROCK_WEST_BANK, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, VARROCK_WEST_BANK, 10, 25_000))) {
            fail(`tele to the Varrock West bank failed for '${user}'`);
        }
    }
    await setArrav(page, gang, partner, args.certs);
}

if (args.deploy) {
    deployBundle();
}

console.log(
    `shield-of-arrav-pair base=${args.base} phoenix=${args.phoenixUser} blackarm=${args.blackarmUser}`
    + ` certs=${args.certs} budget=${args.minutes}min`
);

const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
try {
    const pageP = await (await browser.newContext()).newPage();
    const pageB = await (await browser.newContext()).newPage();
    for (const [tag, page] of [['P', pageP], ['B', pageB]] as const) {
        page.on('pageerror', e => console.log(`[${tag}] pageerror: ${e}`));
        page.on('console', m => {
            const txt = m.text();
            if (txt.startsWith('[bot]')) {
                console.log(`  [${tag} ${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
            }
        });
    }

    await bringUp(pageP, args.phoenixUser, 'phoenix', args.blackarmUser);
    await bringUp(pageB, args.blackarmUser, 'blackarm', args.phoenixUser);

    await startScript(pageP, 'AIOQuester');
    await startScript(pageB, 'AIOQuester');
    console.log('both AIOQuester scripts started — watching for two completions');

    const deadline = Date.now() + args.minutes * 60_000;
    const lastLogTime = { P: 0, B: 0 };
    while (Date.now() < deadline) {
        const [p, b, pPhoenix, pBlackarm, bPhoenix, bBlackarm] = await Promise.all([
            snapshot(pageP),
            snapshot(pageB),
            getServerVarQuiet(pageP, 'phoenixgang'),
            getServerVarQuiet(pageP, 'blackarmgang'),
            getServerVarQuiet(pageB, 'phoenixgang'),
            getServerVarQuiet(pageB, 'blackarmgang')
        ]);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s P[phoenix=${pPhoenix} blackarm=${pBlackarm} journal=${p.status} qp=${p.qp} ${p.runner}]`
            + ` B[phoenix=${bPhoenix} blackarm=${bBlackarm} journal=${b.status} qp=${b.qp} ${b.runner}]`
        );
        for (const [tag, snap] of [['P', p], ['B', b]] as const) {
            for (const l of snap.logs) {
                if (l.time > lastLogTime[tag]) { console.log(`      ${tag} . [${l.level}] ${l.msg}`); }
            }
            if (snap.logs.length > 0) {
                lastLogTime[tag] = Math.max(lastLogTime[tag], ...snap.logs.map(l => l.time));
            }
        }

        // Why: the varp and the journal recolour a tick apart, and the QP award a tick after that, so all three are asserted.
        const done = pPhoenix === 10 && bBlackarm === 4
            && p.status === 'complete' && b.status === 'complete';
        if (done) {
            console.log(
                `PASS (phoenix ${args.phoenixUser} phoenixgang=10 qp=${p.qp},`
                + ` blackarm ${args.blackarmUser} blackarmgang=4 qp=${b.qp}, ${Math.round(t / 60)}min)`
            );
            process.exit(0);
        }
        if (p.runner === 'stopped') { fail(`phoenix bot stopped (journal=${p.status}, phoenixgang=${pPhoenix})`); }
        if (b.runner === 'stopped') { fail(`black arm bot stopped (journal=${b.status}, blackarmgang=${bBlackarm})`); }
        await pageP.waitForTimeout(10_000);
    }
    fail(`neither pair completed within ${args.minutes}min`);
} finally {
    await browser.close();
}
