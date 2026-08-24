/** Live proof, LeatherCrafter banks where the player already is instead of hiking to Al Kharid.
 *  Why: the bank leg used one pinned tile, so a crafter standing in Varrock walked the length of the
 *  map for a needle. The run starts at Varrock West and fails if the walk heads for the Al Kharid booth. */

//   bun e2e/leathercrafter-nearest-bank-live.ts [http://localhost:8890]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `lc${Date.now().toString(36).slice(-5)}`;

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
const AL_KHARID_BANK = { x: 3269, z: 3167, level: 0 };
const BANKED_LEATHER = 40;
const NEAR_RADIUS = 6;
const AL_KHARID_TRIPWIRE = 20;
const RUN_MS = 420_000;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ id: number; name: string | null; count: number }> };
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

const client = deployIsolatedClient(`lc${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setstat crafting 50', 1200);
    await clearChatDialogs(page, 'crafting level-ups');
    await seedItemsToBank(
        page,
        [
            { debugName: 'leather', displayName: 'Leather', qty: BANKED_LEATHER },
            { debugName: 'needle', displayName: 'Needle', qty: 1 },
            { debugName: 'thread', displayName: 'Thread', qty: 200 }
        ],
        VARROCK_WEST_BANK
    );
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    await setSettings(page, 'LeatherCrafter', { leatherType: 'Leather', threadPerTrip: 100 });

    const xpBefore = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('crafting'));
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('LeatherCrafter');
        if (!meta) {
            throw new Error('LeatherCrafter not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log('LeatherCrafter started at Varrock West, watching for a craft without the Al Kharid hike');

    const deadline = Date.now() + RUN_MS;
    let closestAlKharid = Infinity;
    let farthestFromVarrock = 0;
    let withdrew = false;
    let xpGained = 0;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const inv = g.__rs2b0t.Inventory.items();
            return {
                tile: g.rs2b0t.reader.worldTile(),
                state: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                xp: g.__rs2b0t.Skills.xp('crafting'),
                leather: inv.filter(i => i.id === 1741).reduce((n, i) => n + i.count, 0),
                needle: inv.filter(i => i.id === 1733).length
            };
        });
        if (snap.tile) {
            closestAlKharid = Math.min(closestAlKharid, cheb(snap.tile, AL_KHARID_BANK));
            farthestFromVarrock = Math.max(farthestFromVarrock, cheb(snap.tile, VARROCK_WEST_BANK));
        }
        withdrew = withdrew || (snap.needle > 0 && snap.leather > 0);
        xpGained = snap.xp - xpBefore;
        if (snap.state !== 'running') {
            fail(`script stopped early: ${snap.logs.slice(-6).join(' | ')}`);
        }
        if (closestAlKharid <= AL_KHARID_TRIPWIRE) {
            fail(`headed for the Al Kharid booth (${closestAlKharid} tiles) instead of the bank it was standing at`);
        }
        if (withdrew && xpGained > 0) {
            break;
        }
        await page.waitForTimeout(2000);
    }

    const logs = await page.evaluate(() =>
        ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-20).map(l => l.msg)
    );
    console.log('--- recent logs ---');
    for (const m of logs) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: 'docs/e2e/leathercrafter-nearest-bank-live.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));

    if (!withdrew) {
        fail(`never withdrew a needle and leather in ${RUN_MS / 1000}s (farthest from Varrock West ${farthestFromVarrock} tiles)`);
    }
    if (xpGained <= 0) {
        fail('withdrew the kit but gained no crafting XP');
    }
    if (farthestFromVarrock > NEAR_RADIUS * 8) {
        fail(`wandered ${farthestFromVarrock} tiles from Varrock West — that is not the nearest bank`);
    }
    console.log(`PASS, crafting xp +${xpGained} banking at Varrock West (farthest ${farthestFromVarrock} tiles; Al Kharid never closer than ${closestAlKharid})`);
} finally {
    client.cleanup();
    await browser.close();
}
