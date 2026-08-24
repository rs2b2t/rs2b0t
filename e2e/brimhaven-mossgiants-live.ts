/** Live proof, BrimhavenMossGiants restocks at Ardougne, sails to Brimhaven and fights on the island.
 *  Why: the script is a phase machine whose hardest leg is the boat, and only a live run shows the
 *  bank trip, the Captain Barnaby hop and the first kill happening in that order. */

//   bun e2e/brimhaven-mossgiants-live.ts [http://localhost:8890]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `bmg${Date.now().toString(36).slice(-5)}`;

const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };
const FIELD = { x: 2698, z: 3206, level: 0 };
const FIELD_RADIUS = 10;
const RUN_MS = 900_000;

const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints'] as const;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ name: string | null; count: number }> };
        Skills: { xp(name: string): number };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
}

function cheb(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

const client = deployIsolatedClient(`bmg${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    for (const stat of COMBAT_SKILLS) {
        await cheatQuiet(page, `setstat ${stat} 70`, 700);
    }
    // Why: the field is behind the Brimhaven north ropeswing, an Agility 10 shortcut, so a combat-only account has no route and the nav graph reports the field unreachable.
    await cheatQuiet(page, 'setstat agility 30', 700);
    await clearChatDialogs(page, 'combat level-ups');
    await seedItemsToBank(
        page,
        [
            { debugName: 'lobster', displayName: 'Lobster', qty: 40 },
            { debugName: 'coins', displayName: 'Coins', qty: 5000 },
            { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 }
        ],
        ARDOUGNE_BANK
    );
    await cheatQuiet(page, 'give rune_scimitar 1', 1200);
    if (!(await teleTo(page, ARDOUGNE_BANK, 6, 30_000))) {
        fail(`could not reach the Ardougne south bank stand (${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z})`);
    }

    await setSettings(page, 'BrimhavenMossGiants', {
        combatStyle: 'melee',
        meleeStyle: 'strength',
        food: 'Lobster',
        foodWithdraw: 10,
        panicHp: 25,
        buryBones: false,
        bankCommonJunk: true
    });

    const xpBefore = await page.evaluate(skills =>
        skills.reduce((n, s) => n + (globalThis as never as Api).__rs2b0t.Skills.xp(s), 0),
    [...COMBAT_SKILLS]);
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('BrimhavenMossGiants');
        if (!meta) {
            throw new Error('BrimhavenMossGiants not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log('BrimhavenMossGiants started at the Ardougne bank, watching for the sail and the first kill');

    const deadline = Date.now() + RUN_MS;
    let reachedField = false;
    let xpAtField = 0;
    let xpOnIsland = 0;
    let closestField = Infinity;
    let logs: string[] = [];
    while (Date.now() < deadline) {
        const snap = await page.evaluate(skills => {
            const g = globalThis as never as Api;
            return {
                tile: g.rs2b0t.reader.worldTile(),
                state: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                food: g.__rs2b0t.Inventory.items().filter(i => (i.name ?? '').toLowerCase() === 'lobster').length,
                xp: skills.reduce((n, s) => n + g.__rs2b0t.Skills.xp(s), 0)
            };
        }, [...COMBAT_SKILLS]);
        logs = snap.logs;
        if (snap.tile) {
            closestField = Math.min(closestField, cheb(snap.tile, FIELD));
        }
        if (!reachedField && closestField <= FIELD_RADIUS) {
            reachedField = true;
            xpAtField = snap.xp;
            console.log(`landed on the island with ${snap.food} lobster, waiting for a kill`);
        }
        if (reachedField) {
            xpOnIsland = Math.max(xpOnIsland, snap.xp - xpAtField);
        }
        if (snap.state !== 'running') {
            fail(`script stopped early: ${logs.slice(-8).join(' | ')}`);
        }
        if (reachedField && xpOnIsland > 0) {
            break;
        }
        await page.waitForTimeout(2500);
    }

    console.log('--- recent logs ---');
    for (const m of logs.slice(-24)) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: 'docs/e2e/brimhaven-mossgiants-live.png' });
    const totalXp = await page.evaluate(skills =>
        skills.reduce((n, s) => n + (globalThis as never as Api).__rs2b0t.Skills.xp(s), 0),
    [...COMBAT_SKILLS]);
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));

    if (!logs.some(m => /phase start: bank/i.test(m))) {
        fail('the empty pack never drove the bank phase');
    }
    if (!reachedField) {
        fail(`never reached the Brimhaven field in ${RUN_MS / 1000}s, closest ${closestField} tiles`);
    }
    if (xpOnIsland <= 0) {
        fail('landed on the island but never fought a moss giant');
    }
    console.log(`PASS, banked at Ardougne, sailed to Brimhaven (closest ${closestField} tiles) and fought: combat xp +${xpOnIsland} on the island, +${totalXp - xpBefore} total`);
} finally {
    client.cleanup();
    await browser.close();
}
