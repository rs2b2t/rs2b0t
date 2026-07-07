// Task 2 integration test: the spec's load-bearing spike. The server never
// transmits quest-progress varps to the client (ADR-0007), but it DOES
// recolour each line of the quest journal side-tab red/yellow/green
// server-side (~update_questlist -> send_quest_progress_colour, content/
// scripts/general/scripts/quests.rs2) via IF_SETCOLOUR packets that mutate
// the live IfType component tree. If the client's component model exposes
// those colours, that's coarse per-quest state (notStarted/inProgress/
// complete) for every quest with zero server changes.
//
// Recipe: fresh account -> mainland-ready -> read questlist colours via
// reader.questStatuses() -> ::setvar sheep 1 (in progress; ^sheep_complete =
// 22) + ::setvar cookquest 2 (complete; ^cook_complete = 2) -> relog (the
// login script re-runs ~update_questlist unconditionally, content/scripts/
// login_logout/login.rs2 `initalltabs`) -> colours for those two lines
// CHANGED, and differ from each other.
//
// Mainland-ready is NOT just `::setvar tutorial 1000` + relog: the side tabs
// (quest included) only attach once `initalltabs` runs, and login.rs2 gates
// that behind `~in_tutorial_island(coord) = false` OR tutorial complete --
// but an on-island watchdog reverts `%tutorial` every tick regardless, so
// setting it while still on Tutorial Island silently reverts before the
// relog completes (same gotcha the retired farm template-save tool hit). Fix:
// teleport off-island FIRST, then setvar, then relog. Confirmed empirically
// (Task 2): skipping the teleport left reader.questStatuses() permanently
// empty (client.sideIcon all -1 except logout/options) even after the
// tutorial relog, both immediately and 3s later.
//
// Usage: bun tools/quests-tab-test.ts [base-url]

import { chromium, type Page } from 'playwright-core';
import { bootAndLogin, cheat, getServerVar, relog } from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const user = 'qtab' + Date.now().toString(36).slice(-6);
const CHICKEN_PEN = '0,50,51,32,34'; // Lumbridge east chicken pen, world (3232,3298) -- off Tutorial Island

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type QuestStatus = 'notStarted' | 'inProgress' | 'complete' | 'unknown';
type Abi = {
    __lcbuddy: {
        reader: { questStatuses(): { name: string; colour: number }[] };
        Quests: {
            all(): { name: string; status: QuestStatus }[];
            status(name: string): QuestStatus;
        };
    };
};
const read = (page: Page) => page.evaluate(() => (globalThis as never as Abi).__lcbuddy.reader.questStatuses());

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await bootAndLogin(page, base, user);

    // Mainland-ready: teleport off-island BEFORE setvar (watchdog gotcha above).
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

    await cheat(page, 'setvar cookquest 2'); // complete constant (^cook_complete = 2)
    await cheat(page, 'setvar sheep 1'); // mid-progress (complete is 22)
    await relog(page, user);

    const after = await read(page);
    const cookAfter = after.find(q => /cook/i.test(q.name));
    const sheepAfter = after.find(q => /sheep shearer/i.test(q.name));
    if (!cookAfter || !sheepAfter) {
        fail(`quest lines not found after relog: ${JSON.stringify(after.slice(0, 5))}`);
    }

    console.log({ cookBefore: cookBefore.colour, cookAfter: cookAfter.colour, sheepBefore: sheepBefore.colour, sheepAfter: sheepAfter.colour });
    const colourPass = cookAfter.colour !== cookBefore.colour && sheepAfter.colour !== sheepBefore.colour && cookAfter.colour !== sheepAfter.colour;

    // API layer assertions: exercise Quests.all() and Quests.status() mapping
    // Call within page.evaluate since object methods don't serialize across boundary
    const apiResult = await page.evaluate(() => {
        const Quests = (globalThis as never as Abi).__lcbuddy.Quests;
        const allQuests = Quests.all();

        // Find exact quest names robustly from the API
        const cookQuest = allQuests.find((q: { name: string; status: QuestStatus }) => /cook/i.test(q.name));
        const sheepQuest = allQuests.find((q: { name: string; status: QuestStatus }) => /sheep shearer/i.test(q.name));
        const impQuest = allQuests.find((q: { name: string; status: QuestStatus }) => /imp catcher/i.test(q.name));

        if (!cookQuest || !sheepQuest || !impQuest) {
            return {
                found: false,
                apiStatusesFound: { cook: cookQuest?.name, sheep: sheepQuest?.name, imp: impQuest?.name }
            };
        }

        // Assert API statuses match expected values based on the varps we set
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
