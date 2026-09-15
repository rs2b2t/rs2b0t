/** Live proof for JiveEnchanter: wield the staff the bank holds, withdraw jewels and runes, enchant the load one cast every three ticks, bank the products and go again.
 *  Why: the spell button text, the cast pacing and the id-keyed withdrawal all drive a live client, so this run is the only proof the loop closes. */

// Usage: HEADED=1 bun e2e/jiveenchanter-live.ts [--base url] [--jewel 'Sapphire ring'] [--no-staff] [--minutes n] [--no-deploy]
import { jewelByName } from '#/bot/scripts/JiveEnchanter/logic.js';
import { deployIsolatedClient, fail, launchBrowser, requireSim, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

interface Args {
    base: string;
    user: string;
    minutes: number;
    jewel: string;
    staff: boolean;
    deploy: boolean;
}

function parse(argv: readonly string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `je${Date.now().toString(36).slice(-6)}`,
        minutes: 8,
        jewel: 'Sapphire ring',
        staff: true,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--no-staff') { out.staff = false; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--jewel') { out.jewel = value; }
    }
    if (!Number.isFinite(out.minutes) || out.minutes <= 0) { fail(`--minutes takes a positive number, got '${out.minutes}'`); }
    return out;
}

const args = parse(process.argv.slice(2));
const jewel = jewelByName(args.jewel);
if (!jewel) { fail(`--jewel '${args.jewel}' is not a jewel the enchant spells convert`); }

interface Point { x: number; z: number; level: number }

const VARROCK_WEST_BANK: Point = { x: 3185, z: 3440, level: 0 };
/** Two full loads and a short third, so the loop has to close twice. */
const SEED_JEWELS = 60;
const SEED_CASTS = 80;
const FULL_LOAD = 28 - 1 - (args.staff ? Math.max(0, jewel.spell.elements.length - 1) : jewel.spell.elements.length);
const POLL_MS = 2000;
const SCREENSHOT = 'docs/e2e/jiveenchanter-live.png';

const TRIP = /^\[enchanter\] banked (\d+) (.+?), took /;

/** Engine debug names for the seed: rings and necklaces by gem, amulets strung. */
function debugName(j: { label: string }): string {
    const [gem, kind] = j.label.toLowerCase().split(' ');
    return kind === 'amulet' ? `strung_${gem}_amulet` : `${gem}_${kind}`;
}

interface Snapshot {
    pos: Point | null;
    jewels: number;
    products: number;
    xp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

const fmt = (p: Point | null): string => (p ? `(${p.x},${p.z},${p.level})` : '(?)');

await requireSim(args.base);
const client = args.deploy ? deployIsolatedClient(`je${Date.now().toString(36).slice(-6)}`) : null;
const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, args.base, args.user, client?.page);
    console.log(`mainland-ready as '${args.user}'`);

    await cheatQuiet(page, 'setstat magic 70', 1200);
    await clearChatDialogs(page, 'magic level-ups');
    const firstElement = jewel.spell.elements[0]!.rune.split(' ')[0]!.toLowerCase();
    await seedItemsToBank(
        page,
        [
            { debugName: debugName(jewel), displayName: jewel.name, qty: SEED_JEWELS },
            { debugName: 'cosmicrune', displayName: 'Cosmic rune', qty: SEED_CASTS },
            ...jewel.spell.elements.map(e => ({ debugName: `${e.rune.split(' ')[0]!.toLowerCase()}rune`, displayName: e.rune, qty: SEED_CASTS * e.count })),
            ...(args.staff ? [{ debugName: `staff_of_${firstElement}`, displayName: `Staff of ${firstElement}`, qty: 1 }] : [])
        ],
        VARROCK_WEST_BANK
    );
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    await setSettings(page, 'JiveEnchanter', { jewel: jewel.label });

    const read = (): Promise<Snapshot> =>
        page.evaluate(([id, product]): Snapshot => {
            const g = globalThis as never as {
                __rs2b0t: { Inventory: { count(name: string): number; countById(id: number): number }; Skills: { xp(name: string): number } };
                rs2b0t: {
                    runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } };
                    reader: { worldTile(): Point | null };
                };
            };
            const inv = g.__rs2b0t.Inventory;
            return {
                pos: g.rs2b0t.reader.worldTile(),
                jewels: inv.countById(id as number),
                products: inv.count(product as string),
                xp: g.__rs2b0t.Skills.xp('magic'),
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-80)
            };
        }, [jewel.id, jewel.product] as const);

    const first = await read();
    console.log(`seeded pos=${fmt(first.pos)} ${jewel.label}=${first.jewels} ${jewel.product}=${first.products}`);

    await startScript(page, 'JiveEnchanter');
    console.log(`started JiveEnchanter on ${jewel.label}${args.staff ? ' with a staff banked' : ' on runes alone'}, watching`);

    const t0 = Date.now();
    const deadline = t0 + args.minutes * 60_000;
    let last = first;
    let lastLogTime = 0;
    let trips = 0;
    let banked = 0;
    let fullLoads = 0;
    let staffWorn = false;
    let xpAfterTrip = 0;
    let shotTaken = false;

    while (Date.now() < deadline) {
        await page.waitForTimeout(POLL_MS);
        last = await read();
        const fresh = last.logs.filter(l => l.time > lastLogTime);
        for (const line of fresh) {
            console.log(`      · [${line.level}] ${line.msg}`);
            if (/^\[enchanter\] wielding the /.test(line.msg)) { staffWorn = true; }
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
        console.log(`  t=${Math.round((Date.now() - t0) / 1000)}s pos=${fmt(last.pos)} ${jewel.label}=${last.jewels} ${jewel.product}=${last.products} xp=+${last.xp - first.xp} runner=${last.runner}`);

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
    console.log(`final: pos=${fmt(last.pos)} trips=${trips} banked=${banked} fullLoads=${fullLoads} staffWorn=${staffWorn} xp=+${xpGained}`);

    const tail = (): string => last.logs.slice(-6).map(l => l.msg).join(' | ');
    if (args.staff && !staffWorn) {
        fail(`the banked staff was never wielded: ${tail()}`);
    }
    if (xpGained <= 0) {
        fail(`no magic xp, so no enchant ever landed: ${tail()}`);
    }
    if (fullLoads < 1) {
        fail(`no full load of ${FULL_LOAD} ${jewel.product} came back to the bank (banked ${banked} over ${trips} trips): ${tail()}`);
    }
    if (trips < 2) {
        fail(`only ${trips} bank trip(s), so the loop never closed: ${tail()}`);
    }
    if (last.xp <= xpAfterTrip) {
        fail(`the casting did not resume after the last trip: ${tail()}`);
    }
    console.log(`PASS, ${trips} bank trips banked ${banked} ${jewel.product} (${fullLoads} full load${fullLoads === 1 ? '' : 's'})${staffWorn ? ', staff wielded' : ', runes only'}, magic xp +${xpGained}`);
} finally {
    client?.cleanup();
    await browser.close();
}
