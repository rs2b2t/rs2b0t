/** Live proof that Dragon Slayer resumed past the Oracle's door shops for no map piece: [--stage N] [--until N].
 *  Stages (dragonquest): 3 ship bought, 7 hull patched, 8 map with Ned, 9 landed on Crandor, 10 complete. */

//   bun e2e/dragon-slayer-resume-live.ts --stage 8 --until 9 --minutes 15
//   bun e2e/dragon-slayer-resume-live.ts --stage 3 --until 7 --minutes 45
import type { Page } from 'playwright-core';

import { deployIsolatedClient, fail, launchBrowser } from './lib/harness.js';
import { cheatQuiet, getServerVarQuiet, mainlandAccount, maxmeAndClearDialogs, relog, startScript } from './tutorial/harness.js';

const argv = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const base = opt('--base', 'http://localhost:8890');
const stage = Number(opt('--stage', '8'));
const until = Number(opt('--until', '9'));
const minutes = Number(opt('--minutes', '15'));
const user = opt('--user', `dsr${Date.now().toString(36).slice(-6)}`);

/** Nine completed quests worth 36 points, so the Champions' Guild door and the record's 32-point gate both open. */
const EARNED_QP: readonly [string, number][] = [
    ['arthur', 7], ['goblinquest', 6], ['rjquest', 100], ['haunted', 3], ['druidquest', 4],
    ['princequest', 110], ['demonstart', 30], ['vampire', 3], ['spy', 4]
];

// Why: the charms are gone at every stage this harness seeds, the door ate them, and the hull supplies are gone from stage 7.
const CHARM_SHOPPING = /buy \d+× (Lobster pot|Silk)|mind bomb|unfired bowl/i;
const HULL_SHOPPING = /buy \d+× Hammer|fetch \d+ planks|smith \d+ nails/i;
const forbidden = (line: string): boolean => CHARM_SHOPPING.test(line) || (stage >= 7 && HULL_SHOPPING.test(line));

interface Snap {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    runner: string;
    written: number;
    log: string[];
}

async function seed(page: Page): Promise<void> {
    const vars = [
        ...EARNED_QP.map(([varp, value]) => `setvar ${varp} ${value}`),
        `setvar dragonquest ${stage}`,
        // Why: the deck ladder reads the patched-hole count, and with it at 0 every stage lands in the hold.
        ...(stage >= 7 ? ['setvar dragonquestvar 3'] : []),
        // Why: the journal prints Oziach's briefing line until all three "knows about" varps are set, and decide() walks to Edgeville on it.
        'setvar dragon_oracle 3',
        'setvar dragon_shield 1',
        'setvar dragon_goblin 1',
        ...(stage >= 8 ? ['setvar dragon_ned_hired 1'] : [])
    ];
    for (const c of ['speed 300', ...vars, 'tele 0,47,50,39,4']) {
        if (!(await cheatQuiet(page, c))) fail(`seed: ${c} was not sent`);
    }
    // Why: the quest tab recolours only from the login payload, and a tele leaves the scene unbuilt until one.
    await relog(page, user);
    // Why: three lobsters is the quest's own food float, and the nails leg keeps fish while it mines eighteen slots of ore, so a fuller larder fills the pack mid-seam.
    const gives = [
        'give coins 20000', 'give lobster 3', 'give antidragonbreathshield 1',
        ...(stage < 8 ? ['give dragonmap 1'] : [])
    ];
    for (const c of gives) {
        if (!(await cheatQuiet(page, c))) fail(`seed: ${c} was not sent`);
    }
    await maxmeAndClearDialogs(page);
    const seeded = await getServerVarQuiet(page, 'dragonquest');
    if (seeded !== stage) fail(`seed: dragonquest reads ${seeded}, wanted ${stage}`);
    console.log(`seeded dragonquest=${seeded} qp=${await getServerVarQuiet(page, 'qp')} at the Port Sarim dock`);
}

const client = deployIsolatedClient(user);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    await mainlandAccount(page, base, user, client.page);
    await seed(page);

    await page.evaluate(() => {
        sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'dragon');
        sessionStorage.setItem('rs2b0t:set:AIOQuester:food', 'Lobster');
    });
    await startScript(page, 'AIOQuester');
    const t0 = Date.now();
    const stamp = (): string => `[${Math.round((Date.now() - t0) / 1000)}s]`;

    const deadline = Date.now() + minutes * 60_000;
    const steps: string[] = [];
    let printed = 0;
    let verdict = '';
    while (Date.now() < deadline && verdict === '') {
        await page.waitForTimeout(2500);
        const snap = await page.evaluate((): Snap => {
            const g = globalThis as never as {
                __rs2b0t: { reader: { worldTile(): { x: number; z: number; level: number } | null }; Quests: { status(n: string): string } };
                rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } };
            };
            const log = g.rs2b0t.runner.ctx?.log ?? [];
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                status: g.__rs2b0t.Quests.status('Dragon Slayer'),
                runner: g.rs2b0t.runner.state,
                written: log.length,
                log: log.slice(-40).map(l => l.msg)
            };
        });
        const varp = await getServerVarQuiet(page, 'dragonquest');
        const fresh = snap.log.slice(Math.max(0, snap.log.length - (snap.written - printed)));
        printed = snap.written;
        for (const line of fresh) {
            const step = /Dragon Slayer: (.+?)(?: — attempt \d+.*)? · stage/.exec(line)?.[1];
            if (step && steps.at(-1) !== step) steps.push(step);
            if (forbidden(line)) verdict = `FAIL: shopped for a spent supply — ${line}`;
        }
        if (fresh.length > 0) {
            console.log(`${stamp()} [dq=${varp} ${snap.status} L${snap.pos?.level} ${snap.pos?.x},${snap.pos?.z}] ${fresh.join(' | ')}`);
        }
        if (verdict === '' && (snap.status === 'complete' || (varp !== null && varp >= until))) {
            verdict = `PASS: dragonquest=${varp} status=${snap.status} in ${stamp()}`;
        } else if (verdict === '' && snap.runner !== 'running') {
            verdict = `FAIL: runner ${snap.runner} at dragonquest=${varp}`;
        }
    }
    if (verdict === '') verdict = `FAIL: ${minutes} min budget spent at dragonquest=${await getServerVarQuiet(page, 'dragonquest')}`;
    console.log(`steps: ${steps.join(' -> ')}`);
    console.log(verdict);
    if (verdict.startsWith('FAIL')) process.exitCode = 1;
} finally {
    await browser.close();
    client.cleanup();
}
