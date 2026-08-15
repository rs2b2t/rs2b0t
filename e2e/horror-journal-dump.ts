/** Dump the Horror from the Deep journal at each stage, verbatim: --stages 0,1,2,4,5.
 *  Why: `~quest_journal` word-wraps the page through `split_init(…, 400, 49, q8_full)` across twenty-odd components, so a needle that reads fine in `horror_journal.rs2` can arrive split down the middle and a colour tag can land on a different line from the words it colours. */

//   bun e2e/horror-journal-dump.ts --stages 0,1,2,4,5
import type { Page } from 'playwright-core';

import { launchBrowser } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, maxmeAndClearDialogs, relog } from './tutorial/harness.js';

const base = process.env.BASE ?? 'http://localhost:8890';
const user = `hj${Date.now().toString(36).slice(-7)}`;
const stagesArg = process.argv.indexOf('--stages');
const stages = stagesArg === -1
    ? [0, 1, 2, 4, 5]
    : process.argv[stagesArg + 1].split(',').map(Number);

/** Set alongside the stage, so each page renders the state the quest reaches. */
const BITS: Record<number, string[]> = {
    0: [],
    1: ['horrorbridgeleft', 'horrorbridgeright', 'horroragilitykey'],
    2: ['horrorbridgeleft', 'horrorbridgeright', 'horroragilitykey', 'horrorlighthouseentrance', 'horrortar'],
    4: ['horrorbridgeleft', 'horrorbridgeright', 'horroragilitykey', 'horrorlighthouseentrance',
        'horrortar', 'horrorglass', 'horrorlight'],
    5: ['horrorbridgeleft', 'horrorbridgeright', 'horroragilitykey', 'horrorlighthouseentrance',
        'horrortar', 'horrorglass', 'horrorlight']
};

async function journal(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
        const g = globalThis as never as { __rs2b0t: { Quests: { journal(n: string): Promise<string[]> } } };
        return g.__rs2b0t.Quests.journal('Horror from the Deep');
    });
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);

    for (const stage of stages) {
        for (const bit of BITS[stage] ?? []) {
            await cheatQuiet(page, `setvar ${bit} 1`);
        }
        await cheatQuiet(page, `setvar horrorquest ${stage}`);
        await relog(page, user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
        const lines = await journal(page);
        console.log(`\n===== horrorquest=${stage} (${lines.length} components) =====`);
        lines.forEach((l, i) => console.log(`  [${i}] ${JSON.stringify(l)}`));
    }
} finally {
    await browser.close();
}
