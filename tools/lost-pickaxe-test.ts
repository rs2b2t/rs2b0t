// Live smoke for the lost-pickaxe random: trigger the REAL event
// (::~lost_pickaxe, added to the content cheats) against the worst case — a
// WIELDED rune pickaxe and a FULL pack — and assert the supervisor recovers:
// handle unequipped, one sacrificial ore dropped, head taken before the
// 200-tick despawn, reattached, re-wielded. The slot arithmetic is HARD-ASSERTED
// (exactly one sacrificial drop logged + final used === 26) so a seeding or
// cheat-behavior regression that stops exercising the full-pack freeSlot path
// fails loudly instead of coasting on the end-state (worn pick / no leftovers)
// gates, which pass equally on a half-full pack.
//
// The wield + the idle loop the Supervisor polls randoms in are BOTH driven by
// one throwaway LoopingBot: Equipment.equip settles via Execution.delayUntil,
// which rejects ("Execution.* called with no script running", Scheduler.enqueue)
// unless a script is actually active — so the wield must run inside a started
// script's onStart, exactly as tools/equip-test.ts documents. Its empty loop()
// then keeps the run alive so Supervisor.intercept fires the lost-tool recovery
// once ::~lost_pickaxe drops the head. The recovery itself runs with NO cheats.
//
// Requires: engine on :8890 with the ::~lost_pickaxe cheat packed
// (cd ~/code/rs2b2t-engine && npm run build, restart quickstart) + local
// build deployed (deploy-local.sh).
// Usage: bun tools/lost-pickaxe-test.ts [base-url]

import { chromium } from 'playwright-core';
import { cheat, cheatQuiet, mainlandAccount } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const user = `lp${Date.now().toString(36).slice(-7)}`;
const BUDGET_MS = 4 * 60_000;
// Slot count after a clean worn-path recovery — full derivation in the assertion
// block at the end. Seeding fits 27 iron ore alongside the pick (28-slot pack,
// pick added first); the pick's wield frees its slot -> 27 ore survive. The
// full-pack head Take forces exactly ONE sacrificial drop -> 26 ore, nothing else.
const EXPECTED_FINAL_USED = 26;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type Snap = { wornPick: boolean; wornHandle: boolean; invPick: boolean; invHandle: boolean; invHead: boolean; used: number };
// Minimal structural shape of a LoopingBot instance — just enough to drive
// onStart/loop through the public ABI (same pattern as tools/equip-test.ts).
type BotInstance = { onStart?(): void | Promise<void>; loop?(): void | Promise<void> };
type ScriptMetaLike = { name: string; create(): BotInstance };
type G = {
    __rs2b0t: {
        Equipment: { contains(n: string): boolean; equip(n: string): Promise<boolean> };
        Inventory: { contains(n: string): boolean; used(): number };
        LoopingBot: new () => BotInstance;
        registerScript(manifest: ScriptMetaLike): ScriptMetaLike;
    };
    rs2b0t: { runner: { state: string; start(meta: ScriptMetaLike): void; ctx: { log: { level: string; msg: string }[] } | null } };
    __wielded?: boolean;
};

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    // Seed the worst case: a wielded rune pick + a pack full of iron ore.
    // setstat (direct level set), NOT ~maxme: maxme advances all 19 skills,
    // and that 19-skill * ~98-level "Congratulations" cascade keeps the player
    // `delayed` for ~30s+ — and OpObjHandler REJECTS a Take while delayed
    // (UnsetMapFlag), so the recovery could walk onto the head but never pick
    // it up, giving up after 4 attempts. Attack 40 clears the rune pick's wield
    // gate (levelrequire_attack); mining 41 lets ~pickaxe_checker pick the worn
    // rune pick so the event fires on it.
    await cheat(page, 'tele 0,50,50,15,15'); // open castle-side spot
    await page.waitForTimeout(1200);
    await cheat(page, '~item rune_pickaxe 1');
    await cheat(page, '~item iron_ore 28'); // fills the pack -> exercises freeSlot when the worn handle comes off + the head is taken
    await cheat(page, 'setstat attack 45');
    await cheat(page, 'setstat mining 45');
    await page.waitForTimeout(1500);

    // ONE throwaway LoopingBot: wields the pick in onStart (a valid script
    // context) and idles in loop() so the Supervisor polls randoms each
    // iteration. See the file header for why the wield can't be a bare evaluate.
    await page.evaluate(() => {
        const g = globalThis as never as G;
        const abi = g.__rs2b0t;
        const createBot = (): BotInstance => {
            const bot = new abi.LoopingBot();
            bot.onStart = async () => { g.__wielded = await abi.Equipment.equip('Rune pickaxe'); };
            bot.loop = () => {};
            return bot;
        };
        g.rs2b0t.runner.start(abi.registerScript({ name: 'LostPickaxeSmokeBot', create: createBot }));
    });
    try {
        await page.waitForFunction(() => (globalThis as never as G).__wielded !== undefined, undefined, { timeout: 15000 });
    } catch {
        const state = await page.evaluate(() => (globalThis as never as G).rs2b0t.runner.state);
        fail(`wield onStart never settled (runner state: ${state}) — the throwaway bot may have crashed`);
    }
    const wielded = await page.evaluate(() => (globalThis as never as G).__wielded === true);
    if (!wielded) fail('could not wield the Rune pickaxe');
    console.log('rune pickaxe wielded; pack full of iron ore; idle bot running');

    // Direct CLIENT_CHEAT packet (no canvas click / typed input) — the robust
    // path while a script is running (harness.cheatQuiet doc).
    if (!(await cheatQuiet(page, '~lost_pickaxe'))) fail('trigger not sent — client not ingame?');
    console.log('triggered ::~lost_pickaxe — watching the recovery');

    const snap = (): Promise<Snap> =>
        page.evaluate(() => {
            const g = (globalThis as never as G).__rs2b0t;
            return {
                wornPick: g.Equipment.contains('Rune pickaxe'),
                wornHandle: g.Equipment.contains('Pickaxe handle'),
                invPick: g.Inventory.contains('Rune pickaxe'),
                invHandle: g.Inventory.contains('Pickaxe handle'),
                invHead: g.Inventory.contains('Pickaxe head'),
                used: g.Inventory.used()
            };
        });

    // Tail the handler's own stage logs (it logs every step) so a stall is
    // diagnosable from this one run — see the brief's "diagnose from the
    // snapshots + the bot log".
    let logCount = 0;
    const allLogs: string[] = []; // full transcript so the drop can be counted at the end
    const logTail = async (): Promise<string[]> => {
        const lines = await page.evaluate(() => (globalThis as never as G).rs2b0t.runner.ctx?.log.map(l => `${l.level}: ${l.msg}`) ?? []);
        const fresh = lines.slice(logCount);
        logCount = lines.length;
        allLogs.push(...fresh);
        return fresh;
    };

    let sawWornHandle = false;
    let sawHeadInPack = false;
    const deadline = Date.now() + BUDGET_MS;
    let last: Snap | null = null;
    while (Date.now() < deadline) {
        last = await snap();
        sawWornHandle ||= last.wornHandle;
        sawHeadInPack ||= last.invHead;
        const t = Math.round((BUDGET_MS - (deadline - Date.now())) / 1000);
        console.log(`  t=${t}s worn[pick=${last.wornPick} handle=${last.wornHandle}] inv[pick=${last.invPick} handle=${last.invHandle} head=${last.invHead}] used=${last.used}`);
        for (const line of await logTail()) console.log(`     | ${line}`);
        if (last.wornPick && !last.invHandle && !last.invHead) break; // recovered + re-wielded
        await page.waitForTimeout(5000);
    }

    for (const line of await logTail()) console.log(`     | ${line}`); // catch any tail lines the loop's last pass missed
    if (!last) fail('no snapshot');
    if (!sawWornHandle) fail('event never put a Pickaxe handle in the worn slot — did ::~lost_pickaxe fire? (pack the cheat + restart the engine)');
    if (!last.wornPick) fail(`Rune pickaxe not re-wielded (worn handle=${last.wornHandle}, inv pick=${last.invPick})`);
    if (last.invHandle || last.invHead) fail('leftover handle/head in the pack — reattach incomplete');

    // Slot arithmetic — the whole point of the full-pack seeding. Without these,
    // the gates above pass on a half-full pack that never triggers freeSlot.
    // Derivation: ~item iron_ore 28 requests 28 but only 27 fit alongside the pick
    // (28-slot pack, pick seeded first) -> used=28 (full). Wielding the pick frees
    // its slot -> 27 iron ore, used=27. The event swaps the worn pick for a worn
    // handle (pack untouched -> still 27). Recovery: the head Take needs a slot but
    // the unequipped handle refills the pack to 28, so freeSlot drops exactly ONE
    // iron ore (27), Take the head (28), reattach head+handle -> pick (27), re-wield
    // the pick (26). Net: one sacrificial drop, final used=26. (One recovery pass or
    // two — the pre-unequip freeSlot is always a no-op at used=27 — same arithmetic.)
    const drops = allLogs.filter(l => /dropping one .* to free a slot/i.test(l)).length;
    if (drops < 1) fail('freeSlot never dropped a sacrificial ore — the full-pack path was NOT exercised (seeding/cheat regression?); the end-state gates alone would still have passed');
    if (last.used !== EXPECTED_FINAL_USED) fail(`final used=${last.used}, expected ${EXPECTED_FINAL_USED} (27 iron ore post-wield − 1 sacrificial drop) — slot arithmetic regressed`);
    console.log(`PASS (lost-pickaxe: worn handle detected -> ${drops} ore dropped -> head taken${sawHeadInPack ? '' : ' (fast)'} -> reattached -> re-wielded; final used=${last.used})`);
} finally {
    await browser.close();
}
