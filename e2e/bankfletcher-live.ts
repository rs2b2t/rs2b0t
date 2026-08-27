/** Live BankFletcher proof: knife stays across a bank trip, then stringing raises the strung id.
 *  Why: unstrung and strung share a display name, so the stringing leg counts by id. */

//   ENGINE_DIR=/path/to/engine bun e2e/bankfletcher-live.ts --base http://localhost:8888
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import type { Page } from 'playwright-core';
import { deployIsolatedClient, fail, launchBrowser, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8888' });
const user = process.env.USER_NAME || `bf${Date.now().toString(36).slice(-7)}`;
const ENGINE_DIR = process.env.ENGINE_DIR ?? `${homedir()}/Documents/engine`;
const WEST = { x: 3185, z: 3440, level: 0 };
const KNIFE_SHOT = 'docs/e2e/bankfletcher-knife.png';
const STRING_SHOT = 'docs/e2e/bankfletcher-string.png';
const BOW_STRING_ID = 1777;
const UNSTRUNG_WILLOW_LONG = 58;
const STRUNG_WILLOW_LONG = 847;

type Snap = {
    runner: string;
    logs: string[];
    knife: number;
    logsHeld: number;
    string: number;
    unstrung: number;
    strung: number;
    used: number;
};

type Abi = {
    __rs2b0t: {
        Inventory: {
            count(name: string): number;
            countById(id: number): number;
            used(): number;
        };
    };
    rs2b0t: {
        runner: { state: string; ctx?: { log?: { msg: string }[] } | null };
    };
};

async function snap(page: Page): Promise<Snap> {
    return page.evaluate(([stringId, unstrungId, strungId]) => {
        const g = globalThis as never as Abi;
        return {
            runner: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).map(line => line.msg),
            knife: g.__rs2b0t.Inventory.count('Knife'),
            logsHeld: g.__rs2b0t.Inventory.count('Willow logs'),
            string: g.__rs2b0t.Inventory.countById(stringId),
            unstrung: g.__rs2b0t.Inventory.countById(unstrungId),
            strung: g.__rs2b0t.Inventory.countById(strungId),
            used: g.__rs2b0t.Inventory.used()
        };
    }, [BOW_STRING_ID, UNSTRUNG_WILLOW_LONG, STRUNG_WILLOW_LONG] as const);
}

async function seedGive(page: Page, command: string, prove: () => Promise<boolean>): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
        if (await cheatQuiet(page, command) && (await prove())) {
            return;
        }
    }
    fail(`could not seed '${command}'`);
}

function tripsFrom(logs: string[]): number {
    return logs.filter(msg => /withdrawing/i.test(msg) || /deposit/i.test(msg)).length;
}

const client = deployIsolatedClient(`bf${Date.now().toString(36).slice(-6)}`, ENGINE_DIR);
const browser = await launchBrowser({ swiftshader: true });
mkdirSync('docs/e2e', { recursive: true });

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err.message}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setstat fletching 40', 1200);
    await clearChatDialogs(page, 'fletching level-ups');
    if (!(await teleTo(page, WEST, 4, 25_000))) {
        fail(`could not reach Varrock West (${WEST.x},${WEST.z})`);
    }

    await cheatQuiet(page, '~clearinv', 800);
    await seedGive(page, 'give knife 1', async () => (await snap(page)).knife === 1);
    await seedGive(page, 'give willow_logs 27', async () => (await snap(page)).logsHeld >= 27);

    await setSettings(page, 'BankFletcher', {
        material: 'Willow logs',
        product: 'Long bow'
    });
    await startScript(page, 'BankFletcher');
    console.log('BankFletcher started — knife / willow longbow');

    const knifeDeadline = Date.now() + 90_000;
    let emptyAt = 0;
    let knifeProof: Snap | null = null;
    while (Date.now() < knifeDeadline) {
        const now = await snap(page);
        if (now.knife !== 1 && now.logsHeld < 27) {
            fail(`knife left the pack mid-run (knife=${now.knife} logs=${now.logsHeld})`);
        }
        if (now.logsHeld === 0 && emptyAt === 0) {
            emptyAt = Date.now();
        }
        if (emptyAt > 0 && now.knife === 1 && Date.now() - emptyAt > 4000) {
            knifeProof = now;
            break;
        }
        if (now.runner !== 'running' && now.knife === 1 && now.logsHeld === 0) {
            knifeProof = now;
            break;
        }
        if (now.runner !== 'running') {
            fail(`knife leg stopped early: ${now.logs.slice(-8).join(' | ')}`);
        }
        await page.waitForTimeout(400);
    }
    if (!knifeProof) {
        fail('knife never stayed in the pack through a bank trip');
    }
    if (knifeProof.logs.some(msg => /withdrawing.*knife/i.test(msg))) {
        fail(`knife was withdrawn after deposit — keep failed: ${knifeProof.logs.filter(m => /knife/i.test(m)).join(' | ')}`);
    }
    await page.screenshot({ path: KNIFE_SHOT, fullPage: true });
    console.log(`PASS knife held through bank trip trips~${tripsFrom(knifeProof.logs)} screenshot=${KNIFE_SHOT}`);

    await stopScript(page);
    await cheatQuiet(page, '~clearinv', 800);
    await seedGive(page, 'give bow_string 14', async () => (await snap(page)).string >= 14);
    await seedGive(page, 'give unstrung_willow_longbow 14', async () => (await snap(page)).unstrung >= 14);

    await setSettings(page, 'BankFletcher', {
        material: 'Willow logs',
        product: 'String long bow'
    });
    await startScript(page, 'BankFletcher');
    console.log('BankFletcher started — string willow longbow');

    const stringDeadline = Date.now() + 45_000;
    let stringProof: Snap | null = null;
    while (Date.now() < stringDeadline) {
        const now = await snap(page);
        if (now.strung > 0 && now.string > 0) {
            stringProof = now;
            break;
        }
        if (now.runner !== 'running') {
            fail(`stringing stopped before a strung bow: ${now.logs.slice(-8).join(' | ')}`);
        }
        await page.waitForTimeout(250);
    }
    if (!stringProof) {
        fail('stringing made no strung willow longbows');
    }
    await page.screenshot({ path: STRING_SHOT, fullPage: true });
    console.log(
        `PASS stringing strung=${stringProof.strung} string=${stringProof.string} `
        + `unstrung=${stringProof.unstrung} screenshot=${STRING_SHOT}`
    );
} finally {
    client.cleanup();
    await browser.close();
}
