// Live proof #393 — the Tree Spirit fight does not burn a full load of food: [base].
// Seeds the spoken-to-Shamus stage plus axe and 20 lobsters at the Dramen tree, runs AIO through the kill, asserts most food remains (eat only under 50% HP).

//   bun e2e/lostcity-spirit-eat-393-live.ts [http://localhost:8890]
import { type Page } from 'playwright-core';
import { launchBrowser, positionalArgs } from './lib/harness.js';
import { cheatQuiet, getServerVarQuiet, mainlandAccount, relog, startScript } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `lcs${Date.now().toString(36).slice(-6)}`;
const FOOD_START = 20;
// With eatBelow 0.5 and one spirit fight, burning more than half the load is a fail.
const FOOD_MIN_LEFT = 10;

type Item = { count: number; name: string | null };

async function invCount(page: Page, name: string): Promise<number> {
    return page.evaluate(n => {
        const items = (globalThis as never as { __rs2b0t: { Inventory: { items(): Item[] } } }).__rs2b0t.Inventory.items();
        return items.filter(i => i.name === n).reduce((s, i) => s + i.count, 0);
    }, name);
}

async function logs(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const g = globalThis as never as { rs2b0t: { runner: { ctx: { log: { msg: string }[] } | null } } };
        return (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg);
    });
}

const browser = await launchBrowser();
const page = await browser.newPage();
try {
    await mainlandAccount(page, base, user);
    await cheatQuiet(page, '~clearinv inv');
    await cheatQuiet(page, 'setstat woodcutting 36');
    await cheatQuiet(page, 'setstat attack 70');
    await cheatQuiet(page, 'setstat strength 70');
    await cheatQuiet(page, 'setstat defence 70');
    await cheatQuiet(page, 'setstat hitpoints 70');
    await cheatQuiet(page, 'setstat prayer 43');
    // Spoken to Shamus, spirit not yet defeated.
    await cheatQuiet(page, 'setvar zanaris 2');
    await cheatQuiet(page, 'give iron_axe 1');
    await cheatQuiet(page, 'give lobster 20');
    // Dramen tree in Entrana dungeon
    await cheatQuiet(page, 'tele 0,44,152,44,6');
    await relog(page, user);
    // Stats after relog: re-apply quest reqs (engine may not persist cheat setstat).
    await cheatQuiet(page, 'setstat woodcutting 36');
    await cheatQuiet(page, 'setstat crafting 31');
    await cheatQuiet(page, 'setstat attack 70');
    await cheatQuiet(page, 'setstat strength 70');
    await cheatQuiet(page, 'setstat defence 70');
    await cheatQuiet(page, 'setstat hitpoints 70');
    await cheatQuiet(page, 'setstat prayer 43');
    await cheatQuiet(page, 'speed 300');

    const stage = await getServerVarQuiet(page, 'zanaris');
    if (stage !== 2) {
        throw new Error(`expected zanaris=2, got ${stage}`);
    }
    const beforeFood = await invCount(page, 'Lobster');
    if (beforeFood < FOOD_START) {
        throw new Error(`expected ${FOOD_START} Lobster, got ${beforeFood}`);
    }
    console.log(`seeded spirit fight: stage=${stage} lobsters=${beforeFood}`);

    await page.evaluate(() => {
        sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'zanaris');
        sessionStorage.setItem('rs2b0t:set:AIOQuester:food', 'Lobster');
        sessionStorage.setItem('rs2b0t:set:AIOQuester:eatAtHp', '40');
    });
    await startScript(page, 'AIOQuester');

    const deadline = Date.now() + 8 * 60_000;
    let spiritDone = false;
    while (Date.now() < deadline) {
        await page.waitForTimeout(1500);
        const zanaris = await getServerVarQuiet(page, 'zanaris');
        const food = await invCount(page, 'Lobster');
        const lines = await logs(page);
        for (const _m of lines.slice(-5)) {
            // quiet
        }
        if (zanaris !== null && zanaris >= 3) {
            spiritDone = true;
            console.log(`spirit defeated (zanaris=${zanaris}), lobsters left=${food}`);
            break;
        }
        // bail early if food evaporates mid-fight (the bug)
        if (food < FOOD_MIN_LEFT - 2) {
            console.log(`food dropping fast: ${food} left`);
        }
    }

    const afterFood = await invCount(page, 'Lobster');
    const zanaris = await getServerVarQuiet(page, 'zanaris');
    const recent = (await logs(page)).slice(-25);
    console.log('--- logs ---');
    for (const m of recent) {
        console.log(`  ${m}`);
    }
    console.log(JSON.stringify({ afterFood, beforeFood, zanaris, spiritDone }, null, 2));

    if (!spiritDone || (zanaris ?? 0) < 3) {
        throw new Error(`tree spirit not defeated (zanaris=${zanaris})`);
    }
    if (afterFood < FOOD_MIN_LEFT) {
        throw new Error(
            `ate too aggressively: started ${beforeFood} Lobster, left ${afterFood} (want ≥${FOOD_MIN_LEFT}) — #393`
        );
    }
    console.log(`PASS #393 — spirit dead, kept ${afterFood}/${beforeFood} Lobster (threshold ${FOOD_MIN_LEFT})`);
} finally {
    await browser.close();
}
