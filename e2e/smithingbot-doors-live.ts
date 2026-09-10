/** Live proof, SmithingBot steps through Doric's hut door on the tick it swings open, entering and leaving.
 *  Why: the Falador east bank to Doric's anvil leg crosses one baked door, and the crossed line carries the tick
 *  ledger, so a step stamped on the open tick is the same-frame click and one stamped later is a tick in the doorway. */

//   bun e2e/smithingbot-doors-live.ts [http://localhost:8890]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings, stopScript } from './lib/harness.js';
import { clearChatDialogs, getServerVarQuiet, mainlandAccount, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `sd${Date.now().toString(36).slice(-5)}`;

/** Falador east bank, one tile north of the booth row. */
const BANK_STAND = { x: 2946, z: 3368, level: 0 };
/** Inside Doric's hut, east of his two anvils; the route in crosses the west door. */
const ANVIL_STAND = { x: 2951, z: 3451, level: 0 };
/** The shut door's tile; its open leaf swings onto the tile east of it. */
const DOOR = { x: 2949, z: 3450 };
const LEAF = { x: 2950, z: 3450 };
const BANKED_BARS = 54;
const DORIC_QUEST_COMPLETE = 100;
/** The client flushes a click on its next frame, so one in roughly twenty steps sent late in a tick decodes a tick later. */
const MAX_CROSS_TICKS = 2;
const PHASE_MS = 300_000;
const CLOSE_MS = 90_000;

const CROSSED = /crossed 'Door' at \((\d+),(\d+)\) \(Open sent tick (\d+), open \+(\d+), stepped \+(\d+), crossed \+(\d+)\)/;

interface LocQuery {
    name(...names: string[]): LocQuery;
    action(op: string): LocQuery;
    where(fn: (l: { tile(): { x: number; z: number } }) => boolean): LocQuery;
    nearest(): { interact(op: string): boolean | Promise<boolean> } | null;
}

interface Api {
    __rs2b0t: {
        Skills: { xp(name: string): number };
        Locs: { query(): LocQuery };
    };
    rs2b0t: {
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
    };
}

interface Crossing {
    sent: number;
    open: number;
    stepped: number;
    crossed: number;
}

interface Snap {
    logs: string[];
    state: string;
    xp: number;
}

const crossings = new Map<number, Crossing>();

/** Ledger lines survive a script restart and the 500-line log ring only here, keyed by the Open click's tick. */
function noteCrossings(logs: readonly string[]): void {
    for (const m of logs) {
        const hit = CROSSED.exec(m);
        if (!hit || Number(hit[1]) !== DOOR.x || Number(hit[2]) !== DOOR.z) {
            continue;
        }
        const sent = Number(hit[3]);
        if (crossings.has(sent)) {
            continue;
        }
        const c = { sent, open: Number(hit[4]), stepped: Number(hit[5]), crossed: Number(hit[6]) };
        crossings.set(sent, c);
        console.log(`door opened ${c.open} tick(s) after the click, step sent ${c.stepped - c.open} tick(s) after the open, crossed ${c.crossed - c.open} tick(s) after it`);
    }
}

const client = deployIsolatedClient(`sd${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();

async function snap(): Promise<Snap> {
    const s = await page.evaluate(() => {
        const g = globalThis as never as Api;
        return {
            logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
            state: g.rs2b0t.runner.state,
            xp: g.__rs2b0t.Skills.xp('smithing')
        };
    });
    noteCrossings(s.logs);
    return s;
}

/** True while the shut door stands at its tile. */
function doorShut(): Promise<boolean> {
    return page.evaluate(([x, z]) => {
        const g = globalThis as never as Api;
        return g.__rs2b0t.Locs.query().name('Door').action('Open').where(l => l.tile().x === x && l.tile().z === z).nearest() !== null;
    }, [DOOR.x, DOOR.z] as const);
}

/** Click Close on the open leaf; false when no leaf is in the scene. */
function closeDoor(): Promise<boolean> {
    return page.evaluate(async ([x, z]) => {
        const g = globalThis as never as Api;
        const leaf = g.__rs2b0t.Locs.query().name('Door').action('Close').where(l => l.tile().x === x && l.tile().z === z).nearest();
        return leaf ? leaf.interact('Close') : false;
    }, [LEAF.x, LEAF.z] as const);
}

async function runPhase(label: string, done: (s: Snap, withdrawals: number) => boolean): Promise<number> {
    const deadline = Date.now() + PHASE_MS;
    let withdrawals = 0;
    while (Date.now() < deadline) {
        const s = await snap();
        withdrawals = s.logs.filter(m => /withdrawing Bronze bar/i.test(m)).length;
        if (s.state !== 'running') {
            fail(`${label}: script stopped early: ${s.logs.slice(-6).join(' | ')}`);
        }
        if (done(s, withdrawals)) {
            return withdrawals;
        }
        await page.waitForTimeout(2000);
    }
    const s = await snap();
    fail(`${label}: not done in ${PHASE_MS / 1000}s (crossings ${crossings.size}, withdrawals ${withdrawals}) — last lines: ${s.logs.slice(-8).join(' | ')}`);
}

try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setstat smithing 99', 1200);
    await clearChatDialogs(page, 'smithing level-ups');
    await seedItemsToBank(page, [{ debugName: 'bronze_bar', displayName: 'Bronze bar', qty: BANKED_BARS }], BANK_STAND);
    await cheatQuiet(page, 'give hammer 1', 1200);
    // Why: smithing.rs2 refuses Doric's anvils with "You must complete Doric's Quest to use this anvil." below the complete stage.
    await cheatQuiet(page, `setvar doricquest ${DORIC_QUEST_COMPLETE}`, 800);
    if ((await getServerVarQuiet(page, 'doricquest')) !== DORIC_QUEST_COMPLETE) {
        fail('setvar doricquest did not stick, so Doric refuses his anvils');
    }
    if (!(await teleTo(page, BANK_STAND, 6, 25_000))) {
        fail(`could not reach the Falador east bank stand (${BANK_STAND.x},${BANK_STAND.z})`);
    }

    await setSettings(page, 'SmithingBot', {
        bar: 'Bronze',
        product: 'Platebody',
        anvilStand: `${ANVIL_STAND.x},${ANVIL_STAND.z}`,
        bankStand: `${BANK_STAND.x},${BANK_STAND.z}`,
        bankBooth: 'Bank booth',
        leashRadius: 6
    });

    const xpBefore = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('smithing'));
    await startScript(page, 'SmithingBot');
    console.log(`SmithingBot started at the Falador east bank, anvil inside Doric's hut, watching the door at ${DOOR.x},${DOOR.z}`);

    const entered = await runPhase('entering', (s, withdrawals) => crossings.size >= 1 && withdrawals >= 1 && s.xp > xpBefore);
    console.log(`entered the hut through the door and smithed (${entered} withdrawal(s)), shutting the door behind it`);

    await stopScript(page);
    const closeBy = Date.now() + CLOSE_MS;
    // Why: a Close sent while the make loop still delays the player is dropped by the server, so it is re-sent until the shut door is back.
    while (!(await doorShut())) {
        if (Date.now() > closeBy) {
            fail(`could not shut the door at ${DOOR.x},${DOOR.z} within ${CLOSE_MS / 1000}s`);
        }
        await closeDoor();
        await page.waitForTimeout(2500);
    }
    console.log('door shut, restarting the bot inside the hut');

    await startScript(page, 'SmithingBot');
    const left = await runPhase('leaving', (_s, withdrawals) => crossings.size >= 2 && withdrawals >= 1);
    const xpGained = (await snap()).xp - xpBefore;

    const logs = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    console.log('--- last 20 script lines ---');
    for (const m of logs.slice(-20)) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: 'docs/e2e/smithingbot-doors-live.png' });
    await stopScript(page);

    const all = [...crossings.values()].sort((a, b) => a.sent - b.sent);
    const late = all.filter(c => c.stepped !== c.open);
    if (late.length > 0) {
        fail(`${late.length} of ${all.length} steps left after the open tick: ${late.map(c => `+${c.stepped - c.open}`).join(', ')}`);
    }
    const slow = all.filter(c => c.crossed - c.open > MAX_CROSS_TICKS);
    if (slow.length > 0) {
        fail(`${slow.length} of ${all.length} crossings stood in the doorway: ${slow.map(c => `+${c.crossed - c.open}`).join(', ')}`);
    }
    const ticks = all.map(c => `+${c.crossed - c.open}`).join(', ');
    console.log(`PASS, ${all.length} door openings (in, then out) each stepped on the open tick and crossed ${ticks} tick(s) after it, ${entered + left} bank withdrawals, smithing xp +${xpGained}`);
} finally {
    client.cleanup();
    await browser.close();
}
