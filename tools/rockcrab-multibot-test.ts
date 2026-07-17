// Two-bot live test for RockCrab's crab-ownership etiquette: bot A establishes
// a pile at the field, bot B teleports into the SAME spot and starts crabbing
// beside it. Every sample we cross-check what each bot is ENGAGING (its
// localPlayer.faceEntity → an npc scene slot) against who that crab is locked
// onto (npc faceEntity → player slot + 32768): a crab that faces the OTHER
// bot while we fight it is a stolen-stack violation. Pass = zero persistent
// violations AND both bots still get kills (the filter must share, not starve).
//
// Usage: bun tools/rockcrab-multibot-test.ts [minutes] [base-url]

import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, fail, launchBrowser, login, parseArgs, startFromLibrary, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 7 });
const stamp = Date.now().toString(36).slice(-6);
const USERS = [`craba${stamp}`, `crabb${stamp}`];
const TELE = '::tele 0,42,58,22,8'; // ~(2710,3720), inside the crab field

interface Sample {
    slot: number;
    engaging: number; // npc scene slot the local player faces, -1/none
    crabs: { index: number; face: number; hp: number }[];
    kills: number;
    state: string;
    log: string[];
}

async function bringUp(page: Page, user: string): Promise<void> {
    page.on('pageerror', (err: Error) => console.log(`[${user}] pageerror: ${err}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) fail(`${user}: first login failed`);
    await bringUpOffIsland(page, { user });
    for (const s of ['attack', 'strength', 'defence', 'hitpoints']) {
        await type(page, `::setstat ${s} 40`, 1200);
    }
    await type(page, TELE, 1500);
    const atField = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.npcs().some(n => n.name === 'Rocks' || n.name === 'Rock Crab'));
    if (!atField) fail(`${user}: no crabs in scene after teleport`);
    await startFromLibrary(page, 'Combat', 'RockCrab');
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`[${user}] RockCrab started`);
}

function sample(page: Page): Promise<Sample> {
    return page.evaluate(() => {
        const g = (globalThis as never as Rs2b0t).rs2b0t;
        const c = g.client as unknown as { localPlayer: { faceEntity: number } | null };
        const reader = g.reader as unknown as {
            selfSlot(): number;
            npcs(): { name: string | null; index: number; faceEntity: number; health: number }[];
        };
        const runner = g.runner as unknown as { state: string; ctx: { log: { msg: string }[] } | null };
        const log = (runner.ctx?.log ?? []).map(l => l.msg);
        return {
            slot: reader.selfSlot(),
            engaging: c.localPlayer?.faceEntity ?? -1,
            crabs: reader.npcs().filter(n => n.name === 'Rock Crab').map(n => ({ index: n.index, face: n.faceEntity, hp: n.health })),
            kills: log.filter(l => /rock crab down/.test(l)).length,
            state: runner.state,
            log
        };
    });
}

const browser = await launchBrowser();
try {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    console.log('bringing up bot A...');
    await bringUp(pageA, USERS[0]);
    console.log('letting A establish its pile (60s)...');
    await pageA.waitForTimeout(60_000);

    console.log('bringing up bot B at the same spot...');
    await bringUp(pageB, USERS[1]);

    console.log(`observing both bots for ${minutes}min...`);
    const deadline = Date.now() + minutes * 60_000;
    // violation must persist 2 consecutive samples to count (a crab's face
    // lock takes a tick to register on fresh wakes)
    const pending = new Map<string, number>();
    const confirmed: string[] = [];
    let healthyA = 0;
    let healthyB = 0;
    const lastLogged = [0, 0];

    while (Date.now() < deadline) {
        await pageA.waitForTimeout(2500);
        const [a, b] = await Promise.all([sample(pageA), sample(pageB)]);

        for (const [tag, me, other, page] of [['A', a, b, 0], ['B', b, a, 1]] as const) {
            for (const line of me.log.slice(lastLogged[page])) {
                console.log(`  [${tag}] ${line}`);
            }
            lastLogged[page] = me.log.length;
            if (me.state === 'crashed') fail(`bot ${tag} crashed`);

            if (me.engaging >= 0 && me.engaging < 32768) {
                const crab = me.crabs.find(cr => cr.index === me.engaging);
                if (crab && crab.face >= 32768) {
                    const owner = crab.face - 32768;
                    if (owner === other.slot) {
                        const key = `${tag}:${me.engaging}`;
                        const seen = (pending.get(key) ?? 0) + 1;
                        pending.set(key, seen);
                        if (seen === 2) {
                            confirmed.push(`bot ${tag} fought crab slot ${me.engaging} locked onto the other bot`);
                            console.log(`  VIOLATION: ${confirmed[confirmed.length - 1]}`);
                        }
                    } else if (owner === me.slot) {
                        pending.delete(`${tag}:${me.engaging}`);
                        if (tag === 'A') healthyA++;
                        else healthyB++;
                    }
                }
            }
        }
    }

    const [a, b] = await Promise.all([sample(pageA), sample(pageB)]);
    await pageA.screenshot({ path: 'out/rockcrab-multibot-A.png' });
    await pageB.screenshot({ path: 'out/rockcrab-multibot-B.png' });
    for (const [p] of [[pageA], [pageB]] as const) {
        await p.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    }

    console.log(`\nresult: A kills=${a.kills} ownFightSamples=${healthyA} | B kills=${b.kills} ownFightSamples=${healthyB} | violations=${confirmed.length}`);
    if (confirmed.length > 0) fail(`stolen-stack violations:\n  ${confirmed.join('\n  ')}`);
    if (a.kills === 0 || b.kills === 0) fail('a bot got zero kills — the ownership filter is starving it');
    if (healthyA === 0 || healthyB === 0) fail('a bot never fought its own crab — no signal');
    console.log('PASS: both bots farmed side by side without touching each other\'s crabs');
} finally {
    await browser.close();
}
