/** Live proof for JiveChests: seven crystal keys out of Falador West, the walk to the Taverley chest, seven opens, the junk dropped, then home and banked.
 *  Why: the chest answers only `oplocu`, so the key going onto the loc, the reward landing a tick later and the junk leaving the pack all need a live client. */

// Usage: HEADED=1 bun e2e/jivechests-live.ts [--base url] [--keys n] [--walk] [--minutes n] [--no-deploy]
import { deployIsolatedClient, fail, launchBrowser, requireSim, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

interface Args {
    base: string;
    user: string;
    minutes: number;
    keys: number;
    teleport: boolean;
    deploy: boolean;
}

function parse(argv: readonly string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `jc${Date.now().toString(36).slice(-6)}`,
        minutes: 10,
        keys: 14,
        teleport: true,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--walk') { out.teleport = false; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--keys') { out.keys = Number(value); }
    }
    if (!Number.isFinite(out.minutes) || out.minutes <= 0) { fail(`--minutes takes a positive number, got '${out.minutes}'`); }
    if (!Number.isInteger(out.keys) || out.keys < 1) { fail(`--keys takes a positive whole number, got '${out.keys}'`); }
    return out;
}

const args = parse(process.argv.slice(2));

interface Point { x: number; z: number; level: number }

const BANK_STAND: Point = { x: 2946, z: 3369, level: 0 };
// Why: forceapproach is a block mask, so the chest's north side is the one it cannot be used from; the stand is the open tile west of it, and this copy has to track logic.ts.
const CHEST_STAND: Point = { x: 2913, z: 3452, level: 0 };
/** Always in the reward, so it counts the opens the log claims. */
const ALWAYS = 'Uncut dragonstone';
const JUNK = ['Raw swordfish', 'Body rune', 'Spinach roll'];
const KEYS_PER_TRIP = 7;
const POLL_MS = 2000;
const SCREENSHOT = 'docs/e2e/jivechests-live.png';

const OPENED = /\[chests\] opened the chest:/;
const BANKED = /\[chests\] banked the haul and took (\d+) Crystal keys/;

interface Snapshot {
    pos: Point | null;
    keys: number;
    stones: number;
    junk: number;
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

    // Why: the teleport needs Magic 37 and its runes, so a run proving the cast has to be able to make it.
    await cheatQuiet(page, 'setstat magic 55', 1200);
    await clearChatDialogs(page, 'magic level-ups');
    await seedItemsToBank(
        page,
        [
            { debugName: 'crystal_key', displayName: 'Crystal key', qty: args.keys },
            ...(args.teleport
                ? [
                    { debugName: 'lawrune', displayName: 'Law rune', qty: 50 },
                    { debugName: 'airrune', displayName: 'Air rune', qty: 150 },
                    { debugName: 'waterrune', displayName: 'Water rune', qty: 50 }
                ]
                : [])
        ],
        BANK_STAND
    );
    if (args.teleport) {
        await cheatQuiet(page, 'give lawrune 20', 900);
        await cheatQuiet(page, 'give airrune 60', 900);
        await cheatQuiet(page, 'give waterrune 20', 900);
    }
    if (!(await teleTo(page, BANK_STAND, 6, 25_000))) {
        fail(`could not reach the Falador West bank stand (${BANK_STAND.x},${BANK_STAND.z})`);
    }

    await setSettings(page, 'JiveChests', { teleportHome: args.teleport });

    const read = (): Promise<Snapshot> =>
        page.evaluate(([stone, junk]): Snapshot => {
            const g = globalThis as never as {
                __rs2b0t: { Inventory: { count(name: string): number } };
                rs2b0t: {
                    runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } };
                    reader: { worldTile(): Point | null };
                };
            };
            const inv = g.__rs2b0t.Inventory;
            return {
                pos: g.rs2b0t.reader.worldTile(),
                keys: inv.count('Crystal key'),
                stones: inv.count(stone as string),
                junk: (junk as string[]).reduce((n, name) => n + inv.count(name), 0),
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-80)
            };
        }, [ALWAYS, JUNK] as const);

    const first = await read();
    console.log(`seeded pos=${fmt(first.pos)} keys=${first.keys} ${ALWAYS}=${first.stones}`);

    await startScript(page, 'JiveChests');
    console.log(`started JiveChests with ${args.keys} keys banked, home by ${args.teleport ? 'teleport' : 'walk'}`);

    const t0 = Date.now();
    const deadline = t0 + args.minutes * 60_000;
    let last = first;
    let lastLogTime = 0;
    let opens = 0;
    let trips = 0;
    let tookOnTrip = 0;
    let junkSeen = false;
    let atChest = false;
    let shotTaken = false;

    while (Date.now() < deadline) {
        await page.waitForTimeout(POLL_MS);
        last = await read();
        if (last.pos && last.pos.x === CHEST_STAND.x && last.pos.z === CHEST_STAND.z) { atChest = true; }
        if (last.junk > 0) { junkSeen = true; }
        const fresh = last.logs.filter(l => l.time > lastLogTime);
        for (const line of fresh) {
            console.log(`      · [${line.level}] ${line.msg}`);
            if (OPENED.test(line.msg)) { opens++; }
            const banked = BANKED.exec(line.msg);
            if (banked) {
                trips++;
                tookOnTrip = Number(banked[1]);
            }
        }
        if (fresh.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...fresh.map(l => l.time));
        }
        console.log(`  t=${Math.round((Date.now() - t0) / 1000)}s pos=${fmt(last.pos)} keys=${last.keys} stones=${last.stones} junk=${last.junk} opens=${opens} trips=${trips} runner=${last.runner}`);

        // Why: the overlay only paints while the script runs, so the frame is taken once a full trip's worth of chests is open.
        if (!shotTaken && opens >= KEYS_PER_TRIP) {
            await page.screenshot({ path: SCREENSHOT });
            shotTaken = true;
        }
        if (last.runner === 'stopped') {
            console.log('  runner stopped');
            break;
        }
        if (trips >= 2 && opens >= KEYS_PER_TRIP) {
            break;
        }
    }

    if (!shotTaken) {
        await page.screenshot({ path: SCREENSHOT });
    }
    if (last.runner !== 'stopped') {
        await stopScript(page);
    }
    console.log(`final: opens=${opens} trips=${trips} tookOnTrip=${tookOnTrip} atChest=${atChest} junkSeen=${junkSeen} keys=${last.keys}`);

    const tail = (): string => last.logs.slice(-8).map(l => l.msg).join(' | ');
    if (!atChest) {
        fail(`never stood on the chest tile (${CHEST_STAND.x},${CHEST_STAND.z}): ${tail()}`);
    }
    if (opens < KEYS_PER_TRIP) {
        fail(`only ${opens} chest open(s), a trip is ${KEYS_PER_TRIP}: ${tail()}`);
    }
    if (trips < 1) {
        fail(`the haul never reached the bank: ${tail()}`);
    }
    if (tookOnTrip !== KEYS_PER_TRIP) {
        fail(`a bank trip took ${tookOnTrip} keys, the trip size is ${KEYS_PER_TRIP}: ${tail()}`);
    }
    if (last.junk > 0) {
        fail(`${last.junk} junk item(s) came home: ${tail()}`);
    }
    console.log(`PASS, ${opens} chest(s) opened over ${trips} trip(s), ${KEYS_PER_TRIP} keys a trip, junk ${junkSeen ? 'seen and dropped' : 'never rolled'}, none banked`);
} finally {
    client?.cleanup();
    await browser.close();
}
