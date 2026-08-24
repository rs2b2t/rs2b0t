/** Live proof, Superheater turns banked ore into bars with Superheat Item instead of a furnace.
 *  Why: the cast is a TGT_HELD menu action on a pack item, a path no op-based step covers, so the only
 *  honest check is magic and smithing XP moving together while steel bars appear in the pack. */

//   bun e2e/superheater-smelt-live.ts [http://localhost:8890]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `sh${Date.now().toString(36).slice(-5)}`;

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
/** Steel is 1 iron + 2 coal, so a 27-slot trip is nine bars. */
const WANT_BARS = 3;
const RUN_MS = 480_000;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ id: number; name: string | null; count: number }> };
        Skills: { xp(name: string): number };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
    };
}

const client = deployIsolatedClient(`sh${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setstat magic 55', 900);
    await cheatQuiet(page, 'setstat smithing 40', 900);
    await clearChatDialogs(page, 'level-ups');
    await seedItemsToBank(
        page,
        [
            { debugName: 'iron_ore', displayName: 'Iron ore', qty: 40 },
            { debugName: 'coal', displayName: 'Coal', qty: 80 },
            { debugName: 'naturerune', displayName: 'Nature rune', qty: 200 },
            { debugName: 'staff_of_fire', displayName: 'Staff of fire', qty: 1 }
        ],
        VARROCK_WEST_BANK
    );
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    await setSettings(page, 'Superheater', { bar: 'Steel', natures: 50 });

    const before = await page.evaluate(() => {
        const s = (globalThis as never as Api).__rs2b0t.Skills;
        return { magic: s.xp('magic'), smithing: s.xp('smithing') };
    });
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('Superheater');
        if (!meta) {
            throw new Error('Superheater not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log('Superheater started on Steel with ore, coal, natures and a staff of fire banked');

    const deadline = Date.now() + RUN_MS;
    let bars = 0;
    let magicXp = 0;
    let smithXp = 0;
    let logs: string[] = [];
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const s = g.__rs2b0t.Skills;
            return {
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                state: g.rs2b0t.runner.state,
                bars: g.__rs2b0t.Inventory.items()
                    .filter(i => (i.name ?? '').toLowerCase() === 'steel bar')
                    .reduce((n, i) => n + Math.max(1, i.count), 0),
                magic: s.xp('magic'),
                smithing: s.xp('smithing')
            };
        });
        logs = snap.logs;
        bars = Math.max(bars, snap.bars);
        magicXp = snap.magic - before.magic;
        smithXp = snap.smithing - before.smithing;
        if (snap.state !== 'running') {
            fail(`script stopped early: ${logs.slice(-6).join(' | ')}`);
        }
        if (bars >= WANT_BARS && magicXp > 0 && smithXp > 0) {
            break;
        }
        await page.waitForTimeout(2000);
    }

    console.log('--- recent logs ---');
    for (const m of logs.slice(-20)) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: 'docs/e2e/superheater-smelt-live.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));

    if (magicXp <= 0) {
        fail(`no magic XP in ${RUN_MS / 1000}s — Superheat Item never went off`);
    }
    if (smithXp <= 0) {
        fail('magic XP without smithing XP — the cast landed on nothing smeltable');
    }
    if (bars < WANT_BARS) {
        fail(`only ${bars} steel bar(s) made`);
    }
    console.log(`PASS, ${bars} steel bars from banked ore: magic +${magicXp}, smithing +${smithXp}`);
} finally {
    client.cleanup();
    await browser.close();
}
