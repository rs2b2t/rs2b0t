import { fail, launchBrowser } from './lib/harness.js';
import { cheat, cheatQuiet, mainlandAccount, relog, startScript } from './tutorial/harness.js';

// The record's mustHave items are drop-only, so every solo leg would otherwise be
// blocked by provisioning before decide() ever runs.
const PREREQ_ITEMS = 'dragon_bones:1,guam_leaf:1,bat_bones:1,gold_bar:1,tuna:10';

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string): boolean => argv.includes(name);

const base = opt('--base') ?? 'http://localhost:8888';
const user = opt('--user') ?? `wt${Date.now().toString(36).slice(-7)}`;
const stage = opt('--stage');
const bits = opt('--bits');
const give = opt('--give') ?? '';
const minutes = Number(opt('--minutes') ?? 20);

interface SoloSnapshot {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

// SwiftShader renderers crash the page after a handful of launches on this box.
const browser = await launchBrowser();
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

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    await cheat(page, 'speed 300');
    if (!(await cheatQuiet(page, '~maxme'))) {
        fail('could not max stats');
    }
    if (stage !== undefined && !(await cheatQuiet(page, `setvar itwatchtower ${stage}`))) {
        fail('could not set itwatchtower');
    }
    if (bits !== undefined && !(await cheatQuiet(page, `setvar itwatchtower_bits ${bits}`))) {
        fail('could not set itwatchtower_bits');
    }
    if (stage !== undefined || bits !== undefined) {
        // The quest-tab colour is pushed by if_setcolour, not derived from the varp.
        // Only the login script's ~update_questlist re-derives it after a setvar.
        await relog(page, user);
        console.log(`jumped to stage ${stage ?? '(unset)'}${bits !== undefined ? ` bits ${bits}` : ''} and relogged`);
    }

    // After the relog, so nothing is lost in the logout/login cycle.
    const wanted = flag('--no-prereqs') ? give : [PREREQ_ITEMS, give].filter(Boolean).join(',');
    for (const pair of wanted.split(',').map(s => s.trim()).filter(Boolean)) {
        const [obj, n] = pair.split(':');
        if (!(await cheatQuiet(page, `give ${obj} ${Number(n) || 1}`))) {
            fail(`could not give ${pair}`);
        }
        console.log(`gave ${pair}`);
    }

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'itwatchtower'));
    await startScript(page, 'AIOQuester');
    console.log('started AIOQuester — watching');


    const deadline = Date.now() + minutes * 60_000;
    let lastLogTime = 0;
    let last: SoloSnapshot | null = null;
    while (Date.now() < deadline) {
        last = await page.evaluate((): SoloSnapshot => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: { worldTile(): { x: number; z: number; level: number } | null };
                    Quests: { status(n: string): string; points(): number };
                };
                rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
            };
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                status: g.__rs2b0t.Quests.status('Watch Tower'),
                qp: g.__rs2b0t.Quests.points(),
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-60)
            };
        });
        const t = Math.round((Date.now() - t0) / 1000);
        const pos = last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?';
        console.log(`  t=${t}s pos=${pos} status=${last.status} qp=${last.qp} runner=${last.runner}`);
        for (const line of last.logs) {
            if (line.time > lastLogTime) {
                console.log(`      · [${line.level}] ${line.msg}`);
            }
        }
        if (last.logs.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time));
        }
        if (last.status === 'complete' || last.runner !== 'running') {
            break;
        }
        await page.waitForTimeout(10_000);
    }

    if (!last) {
        fail('no snapshot');
    }
    console.log(`END status=${last.status} qp=${last.qp} runner=${last.runner}`);
} finally {
    await browser.close();
}
