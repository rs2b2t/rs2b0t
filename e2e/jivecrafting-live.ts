/** Live proof for JiveCrafting: bank at Al Kharid for the mould, the bars and the gems, make the jewel at the furnace, bank the load and go again.
 *  Why: the furnace panel, the use-on and the booth walk all drive a live client, so this run is the only proof the panel slot names match the table and the loop closes. */

// Usage: HEADED=1 bun e2e/jivecrafting-live.ts [--base url] [--product 'Sapphire ring'] [--level 99] [--minutes n] [--no-deploy]
import { jewelByName } from '#/bot/scripts/JiveCrafting/logic.js';
import { deployIsolatedClient, fail, launchBrowser, requireSim, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

interface Args {
    base: string;
    user: string;
    minutes: number;
    product: string;
    level: number;
    deploy: boolean;
}

function parse(argv: readonly string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `jc${Date.now().toString(36).slice(-6)}`,
        minutes: 10,
        product: 'Sapphire ring',
        level: 99,
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
        else if (flag === '--product') { out.product = value; }
        else if (flag === '--level') { out.level = Number(value); }
    }
    if (!Number.isFinite(out.minutes) || out.minutes <= 0) { fail(`--minutes takes a positive number, got '${out.minutes}'`); }
    if (!Number.isInteger(out.level) || out.level < 1 || out.level > 99) { fail(`--level takes 1 to 99, got '${out.level}'`); }
    return out;
}

const args = parse(process.argv.slice(2));
const jewel = jewelByName(args.product);
if (!jewel) { fail(`--product '${args.product}' is not a gold jewel the script knows`); }
if (args.level < jewel.level) { fail(`${jewel.label} needs Crafting ${jewel.level}, --level gave ${args.level}`); }

interface Point { x: number; z: number; level: number }

const BANK_STAND: Point = { x: 3269, z: 3167, level: 0 };
/** Two full gem loads and a short third, so the loop has to close twice. */
const SEED_SETS = 30;
const FULL_LOAD = jewel.gem ? 13 : 27;
const POLL_MS = 2000;
const SCREENSHOT = 'docs/e2e/jivecrafting-live.png';

const TRIP = /^\[crafting\] banked (\d+) (.+?), took /;

interface Snapshot {
    pos: Point | null;
    bars: number;
    gems: number;
    product: number;
    xp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

const fmt = (p: Point | null): string => (p ? `(${p.x},${p.z},${p.level})` : '(?)');

await requireSim(args.base);
const client = args.deploy ? deployIsolatedClient(`jc${Date.now().toString(36).slice(-6)}`) : null;
const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, args.base, args.user, client?.page);
    console.log(`mainland-ready as '${args.user}'`);

    await cheatQuiet(page, `setstat crafting ${args.level}`, 1200);
    await clearChatDialogs(page, 'crafting level-ups');
    await seedItemsToBank(
        page,
        [
            { debugName: `${jewel.kind}_mould`, displayName: jewel.mould, qty: 1 },
            { debugName: 'gold_bar', displayName: 'Gold bar', qty: SEED_SETS },
            ...(jewel.gem ? [{ debugName: jewel.gem.toLowerCase(), displayName: jewel.gem, qty: SEED_SETS }] : [])
        ],
        BANK_STAND
    );
    if (!(await teleTo(page, BANK_STAND, 6, 25_000))) {
        fail(`could not reach the Al Kharid bank stand (${BANK_STAND.x},${BANK_STAND.z})`);
    }

    await setSettings(page, 'JiveCrafting', { product: jewel.label });

    const read = (): Promise<Snapshot> =>
        page.evaluate(([gem, item]): Snapshot => {
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
                bars: inv.count('Gold bar'),
                gems: gem ? inv.count(gem) : 0,
                product: inv.count(item),
                xp: g.__rs2b0t.Skills.xp('crafting'),
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-80)
            };
        }, [jewel.gem ?? '', jewel.item] as const);

    const first = await read();
    console.log(`seeded pos=${fmt(first.pos)} bars=${first.bars} gems=${first.gems} ${jewel.item}=${first.product}`);

    await startScript(page, 'JiveCrafting');
    console.log(`started JiveCrafting on ${jewel.label}, watching`);

    const t0 = Date.now();
    const deadline = t0 + args.minutes * 60_000;
    let last = first;
    let lastLogTime = 0;
    let trips = 0;
    let banked = 0;
    let fullLoads = 0;
    let xpAfterTrip = 0;
    let shotTaken = false;

    while (Date.now() < deadline) {
        await page.waitForTimeout(POLL_MS);
        last = await read();
        const fresh = last.logs.filter(l => l.time > lastLogTime);
        for (const line of fresh) {
            console.log(`      · [${line.level}] ${line.msg}`);
            const trip = TRIP.exec(line.msg);
            if (trip) {
                trips++;
                const n = Number(trip[1]);
                banked += n;
                if (n >= FULL_LOAD) { fullLoads++; }
                xpAfterTrip = last.xp;
            }
        }
        if (fresh.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...fresh.map(l => l.time));
        }
        console.log(`  t=${Math.round((Date.now() - t0) / 1000)}s pos=${fmt(last.pos)} bars=${last.bars} gems=${last.gems} ${jewel.item}=${last.product} xp=+${last.xp - first.xp} runner=${last.runner}`);

        // Why: the overlay only paints while the script runs, and its rate and eta need half a minute, so the proof frame is taken once the first load is banked.
        if (!shotTaken && fullLoads >= 1) {
            await page.screenshot({ path: SCREENSHOT });
            shotTaken = true;
        }
        if (last.runner === 'stopped') {
            console.log('  runner stopped');
            break;
        }
        if (fullLoads >= 1 && trips >= 2 && last.xp > xpAfterTrip) {
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
    console.log(`final: pos=${fmt(last.pos)} bars=${last.bars} gems=${last.gems} trips=${trips} banked=${banked} fullLoads=${fullLoads} xp=+${xpGained}`);

    const tail = (): string => last.logs.slice(-6).map(l => l.msg).join(' | ');
    if (xpGained <= 0) {
        fail(`no crafting xp, so no bar ever went into the furnace: ${tail()}`);
    }
    if (fullLoads < 1) {
        fail(`no full load of ${FULL_LOAD} ${jewel.item} came back to the bank (banked ${banked} over ${trips} trips): ${tail()}`);
    }
    if (trips < 2) {
        fail(`only ${trips} bank trip(s), so the loop never closed: ${tail()}`);
    }
    if (last.xp <= xpAfterTrip) {
        fail(`the crafting did not resume after the last trip: ${tail()}`);
    }
    console.log(`PASS, ${trips} bank trips banked ${banked} ${jewel.item} (${fullLoads} full load${fullLoads === 1 ? '' : 's'}), crafting xp +${xpGained}`);
} finally {
    client?.cleanup();
    await browser.close();
}
