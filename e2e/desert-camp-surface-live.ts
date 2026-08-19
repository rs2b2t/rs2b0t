/** Live proof — Miner at Desert Mining Camp Surface mines coal without entering the underground mine.
 *
 *   ENGINE_DIR=.../engine sh tools/deploy-local.sh
 *   bun e2e/desert-camp-surface-live.ts [http://localhost:8888]
 */
import { cheatQuiet, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, clearMainModal, getServerVarQuiet, mainlandAccount, relog, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `dcs${Date.now().toString(36).slice(-6)}`;

const SHANTAY_BANK = { x: 3308, z: 3120, level: 0 } as const;
const SURFACE_SEED = { x: 3293, z: 3016, level: 0 } as const;
const FOOD_TARGET = 5;
const BUDGET_MS = Number(process.env.BUDGET_MS ?? 240_000);

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number; items(): { name: string | null }[] };
        Equipment: { contains(name: string): boolean; equip(name: string): Promise<boolean> };
        Skills: { xp(name: string): number; level(name: string): number };
        Quests: { status(name: string): string };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            locs(): Array<{ id: number; tile: { x: number; z: number; level: number } }>;
        };
    };
    rs2b0t: {
        runner: {
            state: string;
            start(meta: unknown): void;
            stop(reason: string): void;
            ctx: { log: { msg: string }[]; crashError?: Error | null } | null;
        };
        registry: { get(name: string): unknown };
    };
}

const UNDERGROUND_CROSSING =
    /Desert Mining Camp (?:mine door|guarded cave|mine cart|wrought gate) (?:in|out)/i;
const FATAL =
    /desert camp: could not reach|desert camp: unsupported|does not support|supports .*; selected|Miner crashed/i;

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
try {
    await mainlandAccount(page, base, user);
    console.log(`ingame as ${user}`);

    for (const cmd of [
        'speed 200',
        'setvar desertrescue 30',
        'setstat mining 41',
        'setstat attack 70',
        'setstat strength 70',
        'setstat defence 70',
        'setstat hitpoints 60'
    ]) {
        if (!(await cheatQuiet(page, cmd))) fail(`cheat ::${cmd} was not sent`);
    }
    await relog(page, user);
    await clearChatDialogs(page, 'fixture dialogs');
    await clearMainModal(page);
    if ((await getServerVarQuiet(page, 'desertrescue')) !== 30) fail('desertrescue varp did not persist as 30');

    const quest = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Quests.status('The Tourist Trap'));
    if (quest !== 'complete') fail(`Tourist Trap status '${quest}', expected complete`);

    if (!(await teleTo(page, SHANTAY_BANK, 2, 20_000))) fail('could not teleport to Shantay bank');

    for (const cmd of [
        'give desert_shirt 1',
        'give desert_robe 1',
        'give desert_boots 1',
        'give metal_key 1',
        'give shantay_pass 1',
        'give rune_pickaxe 1',
        `give lobster ${FOOD_TARGET + 3}`
    ]) {
        if (!(await cheatQuiet(page, cmd, 900))) fail(`cheat ::${cmd} was not sent`);
    }
    const equipped = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Equipment.equip('Rune pickaxe'));
    if (!equipped) fail('could not equip Rune pickaxe');
    await page.waitForTimeout(800);
    const worn = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Equipment.contains('Rune pickaxe'));
    if (!worn) fail('Rune pickaxe was not worn after equip');

    await setSettings(page, 'Miner', {
        rocks: 'Coal',
        location: 'Desert Mining Camp Surface',
        food: 'Lobster',
        foodWithdraw: FOOD_TARGET,
        tickManip: 'Off',
        muleMode: 'Off',
        toolAcquire: 'Off',
        forgetfulBank: false,
        purgePackOnStart: false,
        packJunk: 'Bank'
    });

    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('Miner');
        if (!meta) throw new Error('Miner not registered');
        g.rs2b0t.runner.start(meta);
    });
    console.log('Miner started — waiting for surface coal');

    const startXp = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('mining'));
    const deadline = Date.now() + BUDGET_MS;
    let mined = false;
    let reachedSurface = false;
    let lastLog = '';

    while (Date.now() < deadline) {
        await page.waitForTimeout(1500);
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const tile = g.__rs2b0t.reader.worldTile();
            const logs = (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg);
            const coalLocs = g.__rs2b0t.reader.locs().filter(l => l.id === 2096 || l.id === 2097);
            return {
                tile,
                coal: g.__rs2b0t.Inventory.count('Coal'),
                xp: g.__rs2b0t.Skills.xp('mining'),
                state: g.rs2b0t.runner.state,
                crash: g.rs2b0t.runner.ctx?.crashError?.message ?? null,
                logs,
                nearestCoal: coalLocs[0]
                    ? Math.min(
                        ...coalLocs.map(l =>
                            tile ? Math.max(Math.abs(l.tile.x - tile.x), Math.abs(l.tile.z - tile.z)) : 99
                        )
                    )
                    : 99
            };
        });

        const underground = snap.logs.filter(m => UNDERGROUND_CROSSING.test(m));
        if (underground.length > 0) {
            fail(`surface Miner used an underground crossing: ${underground.join(' | ')}`);
        }
        const fatal = snap.logs.find(m => FATAL.test(m));
        if (fatal) fail(`fatal Miner log: ${fatal}`);
        if (snap.state === 'crashed') fail(`Miner crashed: ${snap.crash ?? 'unknown'}`);
        if (snap.state === 'stopped' || snap.state === 'idle') {
            fail(`Miner stopped before mining coal; last=${snap.logs.at(-1) ?? 'none'}`);
        }
        if (snap.tile && snap.tile.z >= 6400) {
            fail(`surface Miner entered the underground mine at ${JSON.stringify(snap.tile)}`);
        }
        if (
            snap.tile
            && snap.tile.level === 0
            && snap.tile.x >= 3274
            && snap.tile.x <= 3306
            && snap.tile.z >= 3011
            && snap.tile.z <= 3043
        ) {
            reachedSurface = true;
        }
        if (snap.coal > 0 || snap.xp > startXp) {
            mined = true;
            console.log(
                `coal mined: inv=${snap.coal} xpΔ=${snap.xp - startXp} tile=${JSON.stringify(snap.tile)} nearestCoal=${snap.nearestCoal}`
            );
            if (snap.tile && Math.max(Math.abs(snap.tile.x - SURFACE_SEED.x), Math.abs(snap.tile.z - SURFACE_SEED.z)) > 20) {
                fail(`mined coal far from the surface seed: ${JSON.stringify(snap.tile)}`);
            }
            break;
        }
        const latest = snap.logs.at(-1) ?? '';
        if (latest !== lastLog) {
            lastLog = latest;
            console.log(`  ${latest} tile=${JSON.stringify(snap.tile)} coal=${snap.coal}`);
        }
    }

    const logs = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    console.log('--- logs ---');
    for (const line of logs.slice(-40)) console.log(`  ${line}`);

    if (!mined) fail(`did not mine surface coal within ${Math.round(BUDGET_MS / 1000)}s`);
    if (!reachedSurface) fail('never entered the surface camp');
    if (!logs.some(m => /dest=campSurface/.test(m))) fail('route never selected dest=campSurface');
    if (logs.some(m => /enterMine/.test(m) && !/exitMine/.test(m) && /dest=campSurface/.test(m))) {
        fail('surface route attempted enterMine');
    }
    if (logs.some(m => UNDERGROUND_CROSSING.test(m))) fail('surface route used an underground crossing');

    console.log('PASS: Desert Mining Camp Surface mined coal without entering the underground mine');
} finally {
    await browser.close();
}
