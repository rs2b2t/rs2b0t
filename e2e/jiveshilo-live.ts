/** Live proof for JiveShilo: fly fish the Shilo river, sell the catch to Fernahei, buy his feathers, cast again.
 *  Why: every function in JiveShilo.ts drives a live client, so this run is the only proof the spots are on the near bank, the hut buys the fish and the feathers come back to the river. */

// Usage: HEADED=1 bun e2e/jiveshilo-live.ts [--base url] [--minutes n] [--no-deploy]
import { deployIsolatedClient, fail, launchBrowser, requireSim, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, getServerVarQuiet, mainlandAccount, relog, startScript, teleTo } from './tutorial/harness.js';

interface Args {
    base: string;
    user: string;
    minutes: number;
    deploy: boolean;
}

function parse(argv: readonly string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `js${Date.now().toString(36).slice(-6)}`,
        minutes: 12,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--minutes') { out.minutes = Number(value); }
    }
    if (!Number.isFinite(out.minutes) || out.minutes <= 0) { fail(`--minutes takes a positive number, got '${out.minutes}'`); }
    return out;
}

const args = parse(process.argv.slice(2));

interface Point { x: number; z: number; level: number }

/** The first scan stand, beside the three spawn tiles. */
const RIVER_STAND: Point = { x: 2857, z: 2972, level: 0 };
const HUT_STAND: Point = { x: 2870, z: 2971, level: 0 };
const SHILO_VILLAGE_COMPLETE = 15;
/** A rod is 5gp and the first feathers a couple each, so this buys the kit and nothing more. */
const SEED_GP = 60;
const POLL_MS = 2000;
const SCREENSHOT = 'docs/e2e/jiveshilo-live.png';

const TRIP = /^\[shilo\] sold (.+?) for (\d+)gp, bought (\d+) feathers for (\d+)gp \(holding (\d+)\)/;

interface Snapshot {
    pos: Point | null;
    coins: number;
    feathers: number;
    rod: number;
    fish: number;
    xp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

const fmt = (p: Point | null): string => (p ? `(${p.x},${p.z},${p.level})` : '(?)');
const cheb = (a: Point, b: Point): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

await requireSim(args.base);
const client = args.deploy ? deployIsolatedClient(`js${Date.now().toString(36).slice(-6)}`) : null;
const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, args.base, args.user, client?.page);
    console.log(`mainland-ready as '${args.user}'`);

    if (!(await cheatQuiet(page, `setvar zombiequeen ${SHILO_VILLAGE_COMPLETE}`, 900))) {
        fail('could not mark Shilo Village complete');
    }
    const quest = await getServerVarQuiet(page, 'zombiequeen');
    if (quest !== SHILO_VILLAGE_COMPLETE) {
        fail(`setvar zombiequeen ${SHILO_VILLAGE_COMPLETE} did not take (read back ${quest})`);
    }
    await cheatQuiet(page, 'setstat fishing 99', 1200);
    await clearChatDialogs(page, 'fishing level-ups');
    await cheatQuiet(page, `give coins ${SEED_GP}`, 900);
    if (!(await teleTo(page, RIVER_STAND, 6, 25_000))) {
        fail('could not reach the Shilo river stand');
    }
    // Why: a headless ::tele leaves the scene unbuilt and the login payload rebuilds it.
    await relog(page, args.user);

    await setSettings(page, 'JiveShilo', {});

    const read = (): Promise<Snapshot> =>
        page.evaluate((): Snapshot => {
            const g = globalThis as never as {
                __rs2b0t: { Inventory: { count(name: string): number }; Skills: { xp(name: string): number } };
                rs2b0t: {
                    runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } };
                    reader: { worldTile(): Point | null };
                };
            };
            const inv = g.__rs2b0t.Inventory;
            return {
                pos: g.rs2b0t.reader.worldTile(),
                coins: inv.count('Coins'),
                feathers: inv.count('Feather'),
                rod: inv.count('Fly fishing rod'),
                fish: inv.count('Raw trout') + inv.count('Raw salmon'),
                xp: g.__rs2b0t.Skills.xp('fishing'),
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-80)
            };
        });

    const first = await read();
    if (first.coins < SEED_GP) {
        fail(`the coin seed did not land (holding ${first.coins}gp)`);
    }
    console.log(`seeded pos=${fmt(first.pos)} coins=${first.coins} rod=${first.rod} feathers=${first.feathers}`);

    await startScript(page, 'JiveShilo');
    console.log('started JiveShilo, watching');

    const t0 = Date.now();
    const deadline = t0 + args.minutes * 60_000;
    let last = first;
    let lastLogTime = 0;
    let rodBought = false;
    let trips = 0;
    let fishSold = 0;
    let feathersBought = 0;
    let xpAfterTrip = 0;
    let atHut = false;
    let shotTaken = false;

    while (Date.now() < deadline) {
        await page.waitForTimeout(POLL_MS);
        last = await read();
        if (last.pos && cheb(last.pos, HUT_STAND) <= 2) { atHut = true; }
        const fresh = last.logs.filter(l => l.time > lastLogTime);
        for (const line of fresh) {
            console.log(`      · [${line.level}] ${line.msg}`);
            if (/^\[shilo\] bought a Fly fishing rod/.test(line.msg)) { rodBought = true; }
            const trip = TRIP.exec(line.msg);
            if (trip) {
                trips++;
                if (trip[1] !== 'nothing') {
                    fishSold += trip[1]!.split(' + ').reduce((n, part) => n + Number(part.split(' ')[0]), 0);
                }
                feathersBought += Number(trip[3]);
                xpAfterTrip = last.xp;
            }
        }
        if (fresh.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...fresh.map(l => l.time));
        }
        console.log(`  t=${Math.round((Date.now() - t0) / 1000)}s pos=${fmt(last.pos)} coins=${last.coins} rod=${last.rod} feathers=${last.feathers} fish=${last.fish} xp=+${last.xp - first.xp} runner=${last.runner}`);

        // Why: the overlay only paints while the script runs, so the proof frame is taken at the first sale rather than after the stop.
        if (!shotTaken && fishSold > 0) {
            await page.screenshot({ path: SCREENSHOT });
            shotTaken = true;
        }
        if (last.runner === 'stopped') {
            console.log('  runner stopped');
            break;
        }
        if (rodBought && fishSold > 0 && feathersBought > 0 && xpAfterTrip > 0 && last.xp > xpAfterTrip) {
            break;
        }
    }

    if (!shotTaken) {
        await page.screenshot({ path: SCREENSHOT });
    }
    if (last.runner !== 'stopped') {
        await stopScript(page);
    }
    const xpGained = last.xp - first.xp;
    console.log(`final: pos=${fmt(last.pos)} coins=${last.coins} rod=${last.rod} feathers=${last.feathers} trips=${trips} fishSold=${fishSold} feathersBought=${feathersBought} xp=+${xpGained} atHut=${atHut}`);

    const tail = (): string => last.logs.slice(-6).map(l => l.msg).join(' | ');
    if (!rodBought) {
        fail(`never bought the fly fishing rod from Fernahei: ${tail()}`);
    }
    if (xpGained <= 0) {
        fail(`no fishing xp, so the rod never went into the river: ${tail()}`);
    }
    if (fishSold === 0 || feathersBought === 0) {
        fail(`no trip turned fish into feathers (sold ${fishSold}, bought ${feathersBought}): ${tail()}`);
    }
    if (last.xp <= xpAfterTrip) {
        fail(`the casting did not resume after the trip: ${tail()}`);
    }
    console.log(`PASS, bought the rod, caught fish, ${trips} trip(s) sold ${fishSold} fish and bought ${feathersBought} feathers, cast again after, fishing xp +${xpGained}`);
} finally {
    client?.cleanup();
    await browser.close();
}
