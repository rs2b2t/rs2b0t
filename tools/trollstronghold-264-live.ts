// Live proof #264 — Troll Stronghold staged setvar skeleton.
// Do not run against production. Seeds quest stages for local Server harness.
//
//   bun tools/trollstronghold-264-live.ts [http://localhost:8890]
//
// Stages (troll_quest varp):
//   0 not started, 10 started, 20 defeated dad, 30 entered prison, 40 freed godric, 50 complete
//
// Typical staged proofs (manual tele + setvar between runs):
//   1. Death Plateau complete + troll_quest=0  → Denulth start
//   2. troll_quest=10 + lobster food → buy boots if needed → Dad forfeit
//   3. troll_quest=20 @ stronghold top → Troll General + Prison key
//   4. troll_quest=30 @ prison → free Godric (keys looted in-quest)
//   5. troll_quest=40 @ Dunstan → Law talisman / complete
import { type Page } from 'playwright-core';
import { launchBrowser } from './lib/harness.js';
import { cheatQuiet, getServerVarQuiet, mainlandAccount, relog, startScript } from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';
const user = process.argv[3] ?? `troll${Date.now().toString(36).slice(-6)}`;

/** Which stage to seed. Override with TROLL_STAGE env (0|10|20|30|40). */
const SEED_STAGE = Number(process.env.TROLL_STAGE ?? '10');

async function invCount(page: Page, name: string): Promise<number> {
    return page.evaluate(n => {
        const items = (globalThis as never as { __rs2b0t: { Inventory: { items(): { count: number; name: string | null }[] } } })
            .__rs2b0t.Inventory.items();
        return items.filter(i => i.name === n).reduce((s, i) => s + i.count, 0);
    }, name);
}

async function logs(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const g = globalThis as never as { rs2b0t: { runner: { ctx: { log: { msg: string }[] } | null } } };
        return (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg);
    });
}

function seedCheats(stage: number): string[] {
    // Combat food is required (Dad / generals). Climbing boots come from Tenzing
    // (or leftover from Death Plateau). Keys are looted in-quest — do not pre-give them.
    const common = [
        '~clearinv inv',
        'setstat agility 15',
        'setstat attack 70',
        'setstat strength 70',
        'setstat defence 70',
        'setstat hitpoints 70',
        'setstat prayer 43',
        'setstat thieving 30',
        // Death Plateau complete gate (varp only — no quest reward items)
        'setvar death_equiproom 80',
        `setvar troll_quest ${stage}`,
        'give lobster 20',
        'give coins 500'
    ];
    if (stage === 0 || stage === 10) {
        common.push('tele 0,45,55,16,8'); // Denulth / Burthorpe camp
    } else if (stage === 20) {
        common.push('tele 0,45,56,32,29'); // Dad arena approach
    } else if (stage === 30) {
        common.push('tele 0,44,157,15,30'); // prison floor
    } else if (stage === 40) {
        common.push('tele 0,45,55,43,54'); // Dunstan
    }
    return common;
}

const browser = await launchBrowser();
const page = await browser.newPage();
try {
    await mainlandAccount(page, base, user);

    for (const line of seedCheats(SEED_STAGE)) {
        await cheatQuiet(page, line);
    }
    await relog(page, user);

    // Re-apply after relog (setstat / varp may need refresh depending on server).
    for (const line of seedCheats(SEED_STAGE)) {
        if (line.startsWith('setstat') || line.startsWith('setvar') || line.startsWith('give') || line.startsWith('tele')) {
            await cheatQuiet(page, line);
        }
    }
    await cheatQuiet(page, 'speed 300');

    const stage = await getServerVarQuiet(page, 'troll_quest');
    console.log(`seeded Troll Stronghold: troll_quest=${stage} (wanted ${SEED_STAGE}) food=${await invCount(page, 'Lobster')}`);

    await page.evaluate(() => {
        sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'troll');
        sessionStorage.setItem('rs2b0t:set:AIOQuester:food', 'Lobster');
        sessionStorage.setItem('rs2b0t:set:AIOQuester:eatAtHp', '50');
    });
    await startScript(page, 'AIOQuester');

    // Skeleton: watch logs for a few minutes; expand assertions per stage when live Server is up.
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
        await page.waitForTimeout(2000);
        const varp = await getServerVarQuiet(page, 'troll_quest');
        const recent = (await logs(page)).slice(-8);
        if (recent.length) {
            console.log(`[troll_quest=${varp}] ${recent[recent.length - 1]}`);
        }
        if (varp !== null && Number(varp) > SEED_STAGE) {
            console.log(`stage advanced: ${SEED_STAGE} → ${varp}`);
            break;
        }
        if (varp === 50) {
            console.log('Troll Stronghold complete');
            break;
        }
    }

    console.log('final troll_quest=', await getServerVarQuiet(page, 'troll_quest'));
    console.log('tail logs:', (await logs(page)).slice(-20));
} finally {
    await browser.close();
}
