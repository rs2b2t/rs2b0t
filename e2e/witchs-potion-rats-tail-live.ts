/** Live proof, Witch's Potion treats the 289 name Rat's tail as the packed item (#796).
 *  Why: looking up 'Rats tail' never matches, so decide() keeps sending the bot to Rimmington rats. */

//   ENGINE_DIR=~/Documents/engine HEADED=1 bun e2e/witchs-potion-rats-tail-live.ts --base http://localhost:8888
import type { Page } from 'playwright-core';

import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, parseArgs } from './lib/harness.js';
import { mainlandAccount, relog, startScript, teleTo } from './tutorial/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8888', minutes: 8 });
const deploy = !process.argv.includes('--no-deploy');
const user = process.env.USER_NAME || `wpt${Date.now().toString(36).slice(-5)}`;

const TAIL = "Rat's tail";
const TAIL_ID = 300;
const ONION_FIELD = { x: 2950, z: 3251, level: 0 };
const SCREENSHOT = 'docs/e2e/witchs-potion-rats-tail.png';
const BUDGET_MS = minutes * 60_000;

interface Api {
    __rs2b0t: {
        Inventory: {
            contains(name: string): boolean;
            items(): Array<{ id: number; name: string | null }>;
        };
        Quests: { status(name: string): string };
    };
    rs2b0t: {
        runner: { state: string; ctx: { log: { time: number; msg: string }[] } | null };
    };
}

type Pack = { names: string[]; ids: number[]; live: boolean; stale: boolean; status: string };

const pack = (page: Page): Promise<Pack> =>
    page.evaluate(([liveName, staleName, quest]) => {
        const g = globalThis as never as Api;
        const items = g.__rs2b0t.Inventory.items();
        return {
            names: items.map(i => i.name ?? ''),
            ids: items.map(i => i.id),
            live: g.__rs2b0t.Inventory.contains(liveName),
            stale: g.__rs2b0t.Inventory.contains(staleName),
            status: g.__rs2b0t.Quests.status(quest)
        };
    }, [TAIL, 'Rats tail', "Witch's Potion"] as const);

async function seedTail(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
        await cheatQuiet(page, 'give rats_tail 1', 1500);
        const snap = await pack(page);
        if (snap.ids.includes(TAIL_ID)) {
            return;
        }
    }
    fail('could not seed rats_tail');
}

const client = deploy ? deployIsolatedClient(`wpt${Date.now().toString(36).slice(-6)}`) : { page: '/bot.html', cleanup: () => undefined };
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await seedTail(page);
    const named = await pack(page);
    console.log(`seeded: names=${JSON.stringify(named.names)} live=${named.live} stale=${named.stale}`);
    if (!named.names.includes(TAIL)) {
        fail(`live display name was ${JSON.stringify(named.names)}, not ${TAIL}`);
    }
    if (!named.live) {
        fail(`Inventory.contains(${JSON.stringify(TAIL)}) is false with the item in the pack`);
    }
    if (named.stale) {
        fail("Inventory.contains('Rats tail') must stay false; that spelling is not on rev 289");
    }

    await cheatQuiet(page, 'setvar hetty 1', 900);
    await relog(page, user);
    await seedTail(page);
    const started = await pack(page);
    if (started.status !== 'inProgress') {
        fail(`journal after setvar hetty 1 is '${started.status}', want inProgress`);
    }
    if (!started.live) {
        fail(`tail missing after relog, names=${JSON.stringify(started.names)}`);
    }
    if (!(await teleTo(page, ONION_FIELD, 8, 25_000))) {
        fail(`could not reach the onion field (${ONION_FIELD.x},${ONION_FIELD.z})`);
    }
    await cheatQuiet(page, 'speed 300', 700);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'hetty'));
    await startScript(page, 'AIOQuester');
    console.log('started AIOQuester queue=hetty with Rat\'s tail in the pack');

    const t0 = Date.now();
    let lastLog = 0;
    let sawOnion = false;
    while (Date.now() - t0 < BUDGET_MS) {
        const lines = await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []);
        for (const line of lines) {
            if (line.time > lastLog) {
                console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${line.msg}`);
                lastLog = Math.max(lastLog, line.time);
            }
            if (/attacking a Rat for its tail|walking to the Rimmington rats/i.test(line.msg)) {
                fail(`still looking up the pre-289 name: ${line.msg}`);
            }
            if (/Pick Onion/i.test(line.msg)) {
                sawOnion = true;
            }
        }
        const inv = await pack(page);
        if (inv.names.some(n => n.toLowerCase() === 'onion')) {
            sawOnion = true;
        }
        if (sawOnion) {
            break;
        }
        const runner = await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.state);
        if (runner === 'crashed' || runner === 'stopped') {
            fail(`runner ${runner} before an onion was picked: ${JSON.stringify(lines.slice(-12).map(l => l.msg))}`);
        }
        await page.waitForTimeout(500);
    }

    const end = await pack(page);
    if (!sawOnion) {
        fail(`never picked an onion within ${minutes} min; names=${JSON.stringify(end.names)}`);
    }
    if (!end.live) {
        fail(`dropped the tail while picking onion; names=${JSON.stringify(end.names)}`);
    }
    await page.screenshot({ path: SCREENSHOT });
    console.log(`PASS: ${TAIL} counted, onion gathered, no rat grind (${SCREENSHOT})`);
} finally {
    await browser.close();
    client.cleanup();
}
