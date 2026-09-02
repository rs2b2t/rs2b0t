/** Live proof, Alcher withdraws noted stock and turns it into coins with High Level Alchemy.
 *  Why: the cast is a TGT_HELD action on a noted stack and the payout only shows up in the coin
 *  count, so the run watches notes fall, coins rise and magic XP move together. */

//   bun e2e/alcher-nearest-bank-live.ts [http://localhost:8890]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `al${Date.now().toString(36).slice(-5)}`;

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
const AL_KHARID_BANK = { x: 3269, z: 3167, level: 0 };
/** Chainbody, not platebody: the house rule for every bank seed. */
const ALCH_ITEM = 'Rune chainbody';
const ALCH_KEY = 'rune_chainbody';
const ALCHS_PER_TRIP = 10;
const BANKED_STOCK = 30;
/** The poll can miss the peak by a cast or two, so require a stack rather than the exact trip size. */
const MIN_STACK = ALCHS_PER_TRIP - 3;
const RUN_MS = 600_000;

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number; items(): Array<{ name: string | null; count: number }> };
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

const client = deployIsolatedClient(`al${Date.now().toString(36).slice(-6)}`);
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
            { debugName: 'rune_chainbody', displayName: ALCH_ITEM, qty: BANKED_STOCK },
            { debugName: 'naturerune', displayName: 'Nature rune', qty: 200 },
            { debugName: 'staff_of_fire', displayName: 'Staff of fire', qty: 1 }
        ],
        VARROCK_WEST_BANK
    );
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    await setSettings(page, 'Alcher', { items: ALCH_KEY, alchs: ALCHS_PER_TRIP });

    const magicBefore = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('magic'));
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('Alcher');
        if (!meta) {
            throw new Error('Alcher not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log(`Alcher started at Varrock West on ${BANKED_STOCK} banked ${ALCH_ITEM}`);

    const deadline = Date.now() + RUN_MS;
    let notesPeak = 0;
    let notesNow = 0;
    let coinsPeak = 0;
    let magicXp = 0;
    let farthest = 0;
    let closestAlKharid = Infinity;
    let logs: string[] = [];
    while (Date.now() < deadline) {
        const snap = await page.evaluate(item => {
            const g = globalThis as never as Api;
            return {
                tile: g.rs2b0t.reader.worldTile(),
                state: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                notes: g.__rs2b0t.Inventory.count(item),
                coins: g.__rs2b0t.Inventory.count('Coins'),
                magic: g.__rs2b0t.Skills.xp('magic')
            };
        }, ALCH_ITEM);
        logs = snap.logs;
        notesPeak = Math.max(notesPeak, snap.notes);
        notesNow = snap.notes;
        coinsPeak = Math.max(coinsPeak, snap.coins);
        magicXp = snap.magic - magicBefore;
        if (snap.tile) {
            farthest = Math.max(farthest, cheb(snap.tile, VARROCK_WEST_BANK));
            closestAlKharid = Math.min(closestAlKharid, cheb(snap.tile, AL_KHARID_BANK));
        }
        if (snap.state !== 'running') {
            fail(`script stopped early: ${logs.slice(-8).join(' | ')}`);
        }
        if (notesPeak > 0 && notesNow < notesPeak && coinsPeak > 0 && magicXp > 0) {
            break;
        }
        await page.waitForTimeout(2000);
    }

    console.log('--- recent logs ---');
    for (const m of logs.slice(-20)) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: 'docs/e2e/alcher-nearest-bank-live.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));

    // Why: the poll can miss the instant the full stack lands, since the first cast fires within a tick of the withdraw. A stack big enough to watch shrink is what matters.
    if (notesPeak < MIN_STACK) {
        fail(`never held a workable note stack, most seen ${notesPeak} of ${ALCHS_PER_TRIP}`);
    }
    if (magicXp <= 0) {
        fail(`no magic XP in ${RUN_MS / 1000}s, the alch never fired`);
    }
    if (coinsPeak <= 0 || notesNow >= notesPeak) {
        fail(`the note stack never turned into coins: notes ${notesNow}/${notesPeak}, coins ${coinsPeak}`);
    }
    if (farthest > 40) {
        fail(`walked ${farthest} tiles from the bank it started at (Al Kharid closest ${closestAlKharid})`);
    }
    console.log(`PASS, ${notesPeak - notesNow} of ${notesPeak} noted ${ALCH_ITEM} alched into ${coinsPeak} coins at the nearest bank: magic +${magicXp}`);
} finally {
    client.cleanup();
    await browser.close();
}
