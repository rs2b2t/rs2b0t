/** Live proof for the Fernahei preset of ShopBuyout: bank at Shilo's teller, walk to the fishing hut, buy feathers.
 *  Why: the preset is two tiles and a banker name, and only a live walk proves the stand is on the customer side of the counter and the teller opens the bank without a booth. */

// Usage: HEADED=1 bun e2e/shopbuyout-fernahei-live.ts [--base url] [--minutes n] [--no-deploy]
import { deployIsolatedClient, fail, launchBrowser, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, getServerVarQuiet, mainlandAccount, relog, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

interface Args {
    base: string;
    user: string;
    minutes: number;
    deploy: boolean;
}

function parse(argv: readonly string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `sb${Date.now().toString(36).slice(-6)}`,
        minutes: 8,
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

const PRESET = "Fernahei's fishing — Shilo Village (Shilo bank)";
const VARROCK_WEST_BANK: Point = { x: 3185, z: 3440, level: 0 };
const SHILO_BANK: Point = { x: 2852, z: 2954, level: 0 };
const HUT_STAND: Point = { x: 2870, z: 2971, level: 0 };
const SHILO_VILLAGE_COMPLETE = 15;
const BUDGET_GP = 1000;
const POLL_MS = 2000;
const SCREENSHOT = 'docs/e2e/shopbuyout-fernahei-live.png';

interface Snapshot {
    pos: Point | null;
    coins: number;
    feathers: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

const fmt = (p: Point | null): string => (p ? `(${p.x},${p.z},${p.level})` : '(?)');
const cheb = (a: Point, b: Point): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

const client = args.deploy ? deployIsolatedClient(`sb${Date.now().toString(36).slice(-6)}`) : null;
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
    await seedItemsToBank(page, [{ debugName: 'coins', displayName: 'Coins', qty: BUDGET_GP }], VARROCK_WEST_BANK);
    if (!(await teleTo(page, SHILO_BANK, 6, 25_000))) {
        fail('could not reach the Shilo bank stand');
    }
    // Why: a headless ::tele leaves the scene unbuilt and the login payload rebuilds it.
    await relog(page, args.user);

    await setSettings(page, 'ShopBuyout', {
        shop: PRESET,
        budgetGp: BUDGET_GP,
        perTripGp: BUDGET_GP,
        stopFloorGp: 0,
        buyItems: 'Feather',
        recheckSeconds: 30
    });

    const read = (): Promise<Snapshot> =>
        page.evaluate((): Snapshot => {
            const g = globalThis as never as {
                __rs2b0t: { Inventory: { count(name: string): number } };
                rs2b0t: {
                    runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } };
                    reader: { worldTile(): Point | null };
                };
            };
            return {
                pos: g.rs2b0t.reader.worldTile(),
                coins: g.__rs2b0t.Inventory.count('Coins'),
                feathers: g.__rs2b0t.Inventory.count('Feather'),
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-80)
            };
        });

    const first = await read();
    console.log(`seeded pos=${fmt(first.pos)} coins=${first.coins} feathers=${first.feathers}`);

    await startScript(page, 'ShopBuyout');
    console.log(`started ShopBuyout on '${PRESET}', watching`);

    const t0 = Date.now();
    const deadline = t0 + args.minutes * 60_000;
    let last = first;
    let lastLogTime = 0;
    let coinsMax = 0;
    let feathersMax = 0;
    let bought = 0;
    let reachedHut = false;
    let shotTaken = false;
    let stopReason = '';

    while (Date.now() < deadline) {
        await page.waitForTimeout(POLL_MS);
        last = await read();
        coinsMax = Math.max(coinsMax, last.coins);
        feathersMax = Math.max(feathersMax, last.feathers);
        if (last.pos && cheb(last.pos, HUT_STAND) <= 2) { reachedHut = true; }
        const fresh = last.logs.filter(l => l.time > lastLogTime);
        for (const line of fresh) {
            console.log(`      · [${line.level}] ${line.msg}`);
            const buy = /^\[buyout\] buy feather n=(\d+)/.exec(line.msg);
            if (buy) { bought += Number(buy[1]); }
            const stopped = /^\[buyout\] (budget spent.*|bank coins.*)$/.exec(line.msg);
            if (stopped) { stopReason = stopped[1]; }
        }
        if (fresh.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...fresh.map(l => l.time));
        }
        console.log(`  t=${Math.round((Date.now() - t0) / 1000)}s pos=${fmt(last.pos)} coins=${last.coins} feathers=${last.feathers} runner=${last.runner}`);

        // Why: the overlay only paints while the script runs, so the proof frame is taken on the first buy rather than after the stop.
        if (!shotTaken && (bought > 0 || last.feathers > 0)) {
            await page.screenshot({ path: SCREENSHOT });
            shotTaken = true;
        }
        if (last.runner === 'stopped') {
            console.log('  runner stopped');
            break;
        }
        if (bought > 0 && last.feathers > 0) {
            break;
        }
    }

    if (!shotTaken) {
        await page.screenshot({ path: SCREENSHOT });
    }
    if (last.runner !== 'stopped') {
        await stopScript(page);
    }
    const spent = coinsMax - last.coins;
    console.log(`final: pos=${fmt(last.pos)} coinsMax=${coinsMax} feathersMax=${feathersMax} bought=${bought} spent=${spent} reachedHut=${reachedHut} stop='${stopReason}'`);

    if (coinsMax < BUDGET_GP) {
        fail(`the Shilo teller never handed over the ${BUDGET_GP}gp (most held ${coinsMax}): ${last.logs.slice(-6).map(l => l.msg).join(' | ')}`);
    }
    if (!reachedHut) {
        fail(`never stood at Fernahei's counter ${fmt(HUT_STAND)}, last seen ${fmt(last.pos)}`);
    }
    if (bought === 0 || feathersMax === 0) {
        fail(`no feathers bought (log ${bought}, pack ${feathersMax}): ${last.logs.slice(-6).map(l => l.msg).join(' | ')}`);
    }
    console.log(`PASS, banked ${BUDGET_GP}gp at Shilo's teller, walked to Fernahei's hut and bought ${bought} feathers for ${spent}gp`);
} finally {
    client?.cleanup();
    await browser.close();
}
