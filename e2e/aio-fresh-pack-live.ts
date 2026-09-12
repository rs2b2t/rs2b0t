/** Live check that quests clear an unrelated full pack before starting. */
// Why: `doric` owns its inventory and previously reached its ore withdrawal with no free slots.

//   HEADED=1 bun e2e/aio-fresh-pack-live.ts --quest doric --junk 28 --minutes 8
//   HEADED=1 bun e2e/aio-fresh-pack-live.ts --quest doric --junk 28 --resume doricquest=10 --minutes 8
import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, relog, startScript } from './tutorial/harness.js';

interface Args {
    base: string;
    user: string;
    quest: string;
    junk: number;
    junkObj: string;
    resume: string;
    minutes: number;
    tickMs: number;
    deploy: boolean;
}

function parseArgs(argv: string[]): Args {
    const out: Args = {
        base: 'http://127.0.0.1:8890',
        user: `fp${Date.now().toString(36).slice(-7)}`,
        quest: 'doric',
        junk: 28,
        junkObj: 'cow_hide',
        resume: '',
        minutes: 8,
        tickMs: 300,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        const value = argv[++i];
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--quest') { out.quest = value; }
        else if (flag === '--junk') { out.junk = Number(value); }
        else if (flag === '--junk-obj') { out.junkObj = value; }
        else if (flag === '--resume') { out.resume = value; }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
    }
    return out;
}

const args = parseArgs(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type LogLine = { time: number; level: string; msg: string };

interface Snap {
    runner: string;
    used: number;
    status: string | null;
    logs: LogLine[];
}

interface Abi {
    rs2b0t: {
        runner: { state: string; bot: { status?: string } | null; ctx?: { log?: LogLine[] } | null };
    };
    __rs2b0t: { Inventory: { used(): number } };
}

async function snapshot(page: Page): Promise<Snap> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        return {
            runner: g.rs2b0t.runner.state,
            used: g.__rs2b0t.Inventory.used(),
            status: g.rs2b0t.runner.bot?.status ?? null,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-200)
        };
    });
}

const client = args.deploy ? deployIsolatedClient(`freshpack-${args.user}`) : { page: '/bot.html', cleanup: () => undefined };

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, args.base, args.user, client.page);
    console.log(`mainland-ready as '${args.user}'`);
    await cheatQuiet(page, `speed ${args.tickMs}`);

    if (args.resume !== '') {
        // Why: update_questlist only recolours the journal at login, so the varp alone leaves the
        // status reading notStarted and the run proves the wrong branch.
        const [name, value] = args.resume.split('=');
        await cheatQuiet(page, `setvar ${name} ${value}`);
        await relog(page, args.user);
        console.log(`resumed: ${name}=${value}, the quest's journal now reads in progress`);
    }

    // Why: unstackable cowhide fills one slot per unit.
    await cheatQuiet(page, `~item ${args.junkObj} ${args.junk}`);
    const seeded = (await snapshot(page)).used;
    if (seeded < args.junk) {
        fail(`seed: pack holds ${seeded}/${args.junk} slots of ${args.junkObj}, is ~item packed on this content build?`);
    }
    console.log(`seeded ${seeded} junk slot(s) of ${args.junkObj}`);

    await page.evaluate(id => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', id), args.quest);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester queue=${args.quest}`);

    const t0 = Date.now();
    const budgetMs = args.minutes * 60_000;
    let lastLog = 0;
    let sawFreshenLog = false;
    let emptiedAt = 0;

    while (Date.now() - t0 < budgetMs) {
        const s = await snapshot(page);
        for (const line of s.logs) {
            if (line.time > lastLog) {
                console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${line.msg}`);
                lastLog = Math.max(lastLog, line.time);
            }
            if (/(not started|first quest of the session), banking \d+ carried slot\(s\)/i.test(line.msg)) {
                sawFreshenLog = true;
            }
        }
        if (sawFreshenLog && s.used === 0) {
            emptiedAt = Date.now();
            break;
        }
        if (s.runner === 'crashed') {
            fail(`script crashed: ${JSON.stringify(s.logs.slice(-20))}`);
        }
        if (s.runner === 'stopped') {
            fail(`runner stopped before the pack was emptied (used=${s.used})`);
        }
        await page.waitForTimeout(500);
    }

    if (!sawFreshenLog) {
        fail(`never saw the fresh-pack bank trip for '${args.quest}' within ${args.minutes} min`);
    }
    if (emptiedAt === 0) {
        fail(`pack still holds ${(await snapshot(page)).used} slot(s) after the fresh-pack bank trip`);
    }
    console.log(`PASS fresh pack: ${args.quest} emptied ${seeded} junk slot(s) in ${Math.round((emptiedAt - t0) / 1000)}s`);
} finally {
    await browser.close();
    client.cleanup();
}
