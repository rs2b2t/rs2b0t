import { launchBrowser } from './lib/harness.js';
import { cheat, cheatQuiet, mainlandAccount } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const user = `lp${Date.now().toString(36).slice(-7)}`;
const BUDGET_MS = 4 * 60_000;
const EXPECTED_FINAL_USED = 26;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type Snap = { wornPick: boolean; wornHandle: boolean; invPick: boolean; invHandle: boolean; invHead: boolean; used: number };
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

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    await cheat(page, 'tele 0,50,50,15,15');
    await page.waitForTimeout(1200);
    await cheat(page, '~item rune_pickaxe 1');
    await cheat(page, '~item iron_ore 28');
    await cheat(page, 'setstat attack 45');
    await cheat(page, 'setstat mining 45');
    await page.waitForTimeout(1500);

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

    let logCount = 0;
    const allLogs: string[] = [];
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
        if (last.wornPick && !last.invHandle && !last.invHead) break;
        await page.waitForTimeout(5000);
    }

    for (const line of await logTail()) console.log(`     | ${line}`);
    if (!last) fail('no snapshot');
    if (!sawWornHandle) fail('event never put a Pickaxe handle in the worn slot — did ::~lost_pickaxe fire? (pack the cheat + restart the engine)');
    if (!last.wornPick) fail(`Rune pickaxe not re-wielded (worn handle=${last.wornHandle}, inv pick=${last.invPick})`);
    if (last.invHandle || last.invHead) fail('leftover handle/head in the pack — reattach incomplete');

    const drops = allLogs.filter(l => /dropping one .* to free a slot/i.test(l)).length;
    if (drops < 1) fail('freeSlot never dropped a sacrificial ore — the full-pack path was NOT exercised (seeding/cheat regression?); the end-state gates alone would still have passed');
    if (last.used !== EXPECTED_FINAL_USED) fail(`final used=${last.used}, expected ${EXPECTED_FINAL_USED} (27 iron ore post-wield − 1 sacrificial drop) — slot arithmetic regressed`);
    console.log(`PASS (lost-pickaxe: worn handle detected -> ${drops} ore dropped -> head taken${sawHeadInPack ? '' : ' (fast)'} -> reattached -> re-wielded; final used=${last.used})`);
} finally {
    await browser.close();
}
