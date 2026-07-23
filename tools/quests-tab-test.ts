import { launchBrowser } from './lib/harness.js';
import { type Page } from 'playwright-core';
import { bootAndLogin, cheat, getServerVar, relog } from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const user = 'qtab' + Date.now().toString(36).slice(-6);
const CHICKEN_PEN = '0,50,51,32,34';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type QuestStatus = 'notStarted' | 'inProgress' | 'complete' | 'unknown';
type Abi = {
    __rs2b0t: {
        reader: { questStatuses(): { name: string; colour: number }[] };
        Quests: {
            all(): { name: string; status: QuestStatus }[];
            status(name: string): QuestStatus;
        };
    };
};
const read = (page: Page) => page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.questStatuses());

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await bootAndLogin(page, base, user);

    await cheat(page, `tele ${CHICKEN_PEN}`);
    await page.waitForTimeout(1500);
    await cheat(page, 'setvar tutorial 1000');
    await page.waitForTimeout(1000);
    const tut = await getServerVar(page, 'tutorial');
    if (tut !== 1000) {
        fail(`setvar tutorial 1000 did not stick (getvar=${tut}) -- still on-island?`);
    }
    await relog(page, user);

    const before = await read(page);
    const cookBefore = before.find(q => /cook/i.test(q.name));
    const sheepBefore = before.find(q => /sheep shearer/i.test(q.name));
    if (!cookBefore || !sheepBefore) {
        fail(`quest lines not found: ${JSON.stringify(before.slice(0, 5))}`);
    }

    await cheat(page, 'setvar cookquest 2');
    await cheat(page, 'setvar sheep 1');
    await relog(page, user);

    const after = await read(page);
    const cookAfter = after.find(q => /cook/i.test(q.name));
    const sheepAfter = after.find(q => /sheep shearer/i.test(q.name));
    if (!cookAfter || !sheepAfter) {
        fail(`quest lines not found after relog: ${JSON.stringify(after.slice(0, 5))}`);
    }

    console.log({ cookBefore: cookBefore.colour, cookAfter: cookAfter.colour, sheepBefore: sheepBefore.colour, sheepAfter: sheepAfter.colour });
    const colourPass = cookAfter.colour !== cookBefore.colour && sheepAfter.colour !== sheepBefore.colour && cookAfter.colour !== sheepAfter.colour;

    const apiResult = await page.evaluate(() => {
        const Quests = (globalThis as never as Abi).__rs2b0t.Quests;
        const allQuests = Quests.all();

        const cookQuest = allQuests.find((q: { name: string; status: QuestStatus }) => /cook/i.test(q.name));
        const sheepQuest = allQuests.find((q: { name: string; status: QuestStatus }) => /sheep shearer/i.test(q.name));
        const impQuest = allQuests.find((q: { name: string; status: QuestStatus }) => /imp catcher/i.test(q.name));

        if (!cookQuest || !sheepQuest || !impQuest) {
            return {
                found: false,
                apiStatusesFound: { cook: cookQuest?.name, sheep: sheepQuest?.name, imp: impQuest?.name }
            };
        }

        const apiAssertions = {
            cookStatus: cookQuest.status,
            sheepStatus: sheepQuest.status,
            impStatus: impQuest.status,
            cookByNameLookup: Quests.status(cookQuest.name)
        };

        const apiPass =
            cookQuest.status === 'complete' &&
            sheepQuest.status === 'inProgress' &&
            impQuest.status === 'notStarted' &&
            Quests.status(cookQuest.name) === 'complete';

        return {
            found: true,
            apiAssertions,
            apiPass,
            questNames: { cook: cookQuest.name, sheep: sheepQuest.name, imp: impQuest.name }
        };
    });

    if (!apiResult.found) {
        fail(`API layer: required quest names not found: ${JSON.stringify(apiResult.apiStatusesFound)}`);
    }

    console.log(apiResult.apiAssertions);
    console.log(colourPass && apiResult.apiPass ? 'PASS' : 'FAIL');
    if (!colourPass || !apiResult.apiPass) {
        console.log({ colourPass, apiPass: apiResult.apiPass, questNames: apiResult.questNames });
        process.exitCode = 1;
    }
} finally {
    await browser.close();
}
