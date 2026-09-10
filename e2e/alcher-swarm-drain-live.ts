/** Live proof, Alcher drains its ticked items richest first and yields the loop to a random event.
 *  Why: the cast used to run inside a while loop that held every one of a trip's casts, so Supervisor.intercept
 *  never got a turn and a Swarm chewed through the bot while it alched on. One cast per call gives
 *  the intercept a point to break in, and the drain moves to the next item once the bank is out. */

//   bun e2e/alcher-swarm-drain-live.ts [http://localhost:8890]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `ad${Date.now().toString(36).slice(-5)}`;

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
/** Chainbody, not platebody: the house rule for every bank seed. Alchs for 30,000, so it drains first. */
const RICH = { key: 'rune_chainbody', debugName: 'rune_chainbody', name: 'Rune chainbody', stock: 20 };
/** 768 a cast, so the drain only reaches it after the bank runs out of the chainbodies. */
const POOR = { key: 'yew_longbow', debugName: 'yew_longbow', name: 'Yew longbow', stock: 8 };
const ALCHS_PER_TRIP = 20;
const RUN_MS = 420_000;

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number };
        Skills: { xp(name: string): number };
        reader: { npcs(): Array<{ name: string | null; id: number }> };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
    };
}

const client = deployIsolatedClient(`ad${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setstat magic 70', 1200);
    await clearChatDialogs(page, 'magic level-ups');
    await seedItemsToBank(
        page,
        [
            { debugName: RICH.debugName, displayName: RICH.name, qty: RICH.stock },
            { debugName: POOR.debugName, displayName: POOR.name, qty: POOR.stock },
            { debugName: 'naturerune', displayName: 'Nature rune', qty: 200 },
            { debugName: 'staff_of_fire', displayName: 'Staff of fire', qty: 1 }
        ],
        VARROCK_WEST_BANK
    );
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    await setSettings(page, 'Alcher', { items: `${RICH.key}, ${POOR.key}`, alchs: ALCHS_PER_TRIP });

    const magicBefore = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('magic'));
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('Alcher');
        if (!meta) {
            throw new Error('Alcher not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log(`Alcher started at Varrock West on ${RICH.stock} ${RICH.name} + ${POOR.stock} ${POOR.name}`);

    const deadline = Date.now() + RUN_MS;
    let spawnedSwarm = false;
    let sawEvent = false;
    let swarmGone = false;
    let richAlched = false;
    let movedOn = false;
    let poorAlched = false;
    let crashed = '';
    let stopReason = '';
    let logs: string[] = [];
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const npcs = g.__rs2b0t.reader.npcs();
            return {
                state: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                swarm: npcs.some(n => (n.name ?? '').toLowerCase() === 'swarm' || n.id === 411),
                coins: g.__rs2b0t.Inventory.count('Coins'),
                magic: g.__rs2b0t.Skills.xp('magic')
            };
        });
        logs = snap.logs;

        // Why: spawn once the first cast has landed, so the Swarm arrives mid-trip, which is where the old while loop refused to yield.
        richAlched ||= logs.some(m => new RegExp(`alching ${RICH.name}`, 'i').test(m)) || snap.magic > magicBefore;
        if (richAlched && !spawnedSwarm) {
            spawnedSwarm = true;
            await cheatQuiet(page, 'npcadd macro_swarm', 1500);
            const up = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.reader.npcs()
                .some(n => (n.name ?? '').toLowerCase() === 'swarm' || n.id === 411));
            if (!up) {
                await cheatQuiet(page, 'npcadd Swarm', 1500);
            }
            console.log('Swarm spawned mid-alch');
        }
        if (spawnedSwarm) {
            sawEvent ||= logs.some(m => /random event/i.test(m) && /swarm/i.test(m));
            swarmGone ||= sawEvent && !snap.swarm;
        }
        movedOn ||= logs.some(m => new RegExp(`out of ${RICH.name}`, 'i').test(m));
        poorAlched ||= logs.some(m => new RegExp(`withdrew \\d+ ${POOR.name}`, 'i').test(m));

        if (snap.state === 'crashed') {
            crashed = logs.slice(-8).join(' | ');
            break;
        }
        if (snap.state !== 'running') {
            stopReason = logs.slice(-4).join(' | ');
            break;
        }
        if (sawEvent && swarmGone && movedOn && poorAlched) {
            break;
        }
        await page.waitForTimeout(1500);
    }

    console.log('--- recent logs ---');
    for (const m of logs.slice(-24)) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: 'docs/e2e/alcher-swarm-drain-live.png' });
    const magicXp = await page.evaluate(before => (globalThis as never as Api).__rs2b0t.Skills.xp('magic') - before, magicBefore);
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));

    if (crashed) {
        fail(`the script crashed: ${crashed}`);
    }
    if (!spawnedSwarm) {
        fail('the first alch never landed, so the Swarm was never spawned');
    }
    if (!sawEvent) {
        fail('the Swarm never interrupted the alch loop — Supervisor got no turn between casts');
    }
    if (!swarmGone) {
        fail('the Swarm was still up after the random-event handling window');
    }
    if (!movedOn) {
        fail(`the drain never retired ${RICH.name} after the bank ran out of it`);
    }
    if (!poorAlched) {
        fail(`the drain never moved on to ${POOR.name}`);
    }
    if (magicXp <= 0) {
        fail('no magic XP, nothing was alched');
    }
    // Why: running or stopped on the honest empty-bank reason both count; anything else is a stop worth failing on.
    if (stopReason && !/out of every selected item/i.test(stopReason)) {
        fail(`the script stopped for the wrong reason: ${stopReason}`);
    }
    console.log(`PASS, Swarm interrupted the alch loop and was evaded, then the drain retired ${RICH.name} and moved on to ${POOR.name}: magic +${magicXp}`);
} finally {
    client.cleanup();
    await browser.close();
}
