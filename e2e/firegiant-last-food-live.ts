import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript, type Rs2b0t } from './lib/harness.js';
import { targetChanges } from './lib/firegiantTargetChanges.js';
import { clearChatDialogs, getServerVarQuiet, mainlandAccount, relog, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2));
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'local engine required');
const tag = `fglf${Date.now().toString(36).slice(-6)}`;
const proofDir = process.env.PROOF_DIR ?? 'out/firegiant-last-food';
const before = process.env.EXPECT_MODE === 'before';
mkdirSync(proofDir, { recursive: true });
const engine = process.env.ENGINE_DIR;
assert(engine, 'ENGINE_DIR required');
const pagePath = process.env.CLIENT_PAGE;
const deploy = !process.argv.includes('--no-deploy');
if (!deploy) assert(pagePath && /^\/bot-[\w-]+\.html$/.test(pagePath), '--no-deploy requires an isolated CLIENT_PAGE');
const client = deploy ? deployIsolatedClient(tag, engine) : { page: pagePath!, cleanup: () => undefined };
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();

type Api = Rs2b0t & {
    __rs2b0t: {
        Inventory: {
            count(name: string): number;
            used(): number;
        };
        Equipment: { contains(name: string): boolean; equip(name: string): Promise<boolean> };
        Skills: { xp(name: string): number; level(name: string): number; effective(name: string): number };
        Quests: { status(name: string): string };
        reader: { chat(n: number): { text: string }[] };
    };
};

const SEERS_BANK = { x: 2725, z: 3491, level: 0 };
const ANCHOR = { x: 2575, z: 9893, level: 0 };
const AMULET = "Glarial's amulet";
const HP_LEVEL = 40;
const PANIC_FRAC = 0.25;

interface Snap {
    state: string;
    tile: { x: number; z: number; level: number } | null;
    xp: number;
    hp: number;
    hpMax: number;
    food: number;
    logs: string[];
    chat: string[];
}

interface Event {
    t: number;
    food: number;
    hp: number;
    xp: number;
    inDungeon: boolean;
    msg: string;
}

const snapshot = (): Promise<Snap> => page.evaluate(() => {
    const g = globalThis as never as Api;
    return {
        state: g.rs2b0t.runner.state,
        tile: g.rs2b0t.reader.worldTile(),
        xp: ['attack', 'strength', 'defence', 'hitpoints'].reduce((n, s) => n + g.__rs2b0t.Skills.xp(s), 0),
        hp: g.__rs2b0t.Skills.effective('hitpoints'),
        hpMax: g.__rs2b0t.Skills.level('hitpoints'),
        food: g.__rs2b0t.Inventory.count('Lobster'),
        logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
        chat: g.__rs2b0t.reader.chat(100).map(l => l.text).filter(t => t.length > 0)
    };
});
const held = (name: string) => page.evaluate(n => (globalThis as never as Api).__rs2b0t.Inventory.count(n), name);

async function giveHeld(cmd: string, name: string, want: number): Promise<void> {
    // One send, then a long wait for it to land: a fast retry under load can
    // stack a second give on top of the first and raise the seeded count.
    for (let i = 0; i < 3 && (await held(name)) < want; i++) {
        assert(await cheatQuiet(page, cmd), `cheat not sent: ${cmd}`);
        await page.waitForFunction(([n, w]) => (globalThis as never as Api).__rs2b0t.Inventory.count(n) >= w, [name, want] as const, { timeout: 15_000 }).catch(() => undefined);
    }
    assert((await held(name)) >= want, `could not seed ${want} x ${name}`);
}

async function ensureWorn(cmd: string, name: string): Promise<void> {
    const worn = () => page.evaluate(n => (globalThis as never as Api).__rs2b0t.Equipment.contains(n), name);
    if (await worn()) return;
    if ((await held(name)) < 1) await giveHeld(cmd, name, 1);
    assert(await page.evaluate(n => (globalThis as never as Api).__rs2b0t.Equipment.equip(n), name), `equip refused: ${name}`);
    assert(await worn(), `not worn after equip: ${name}`);
}

// Three lobsters, the entry kit and Camelot runes held, weapon and amulet worn.
async function seedPack(): Promise<void> {
    assert(await cheatQuiet(page, '~clearinv'), 'clearinv not sent');
    await page.waitForTimeout(800);
    await giveHeld('give lobster 3', 'Lobster', 3);
    await giveHeld('give rope 1', 'Rope', 1);
    await giveHeld('give airrune 15', 'Air rune', 15);
    await giveHeld('give lawrune 3', 'Law rune', 3);
    await ensureWorn('give glarials_amulet_waterfall_quest 1', AMULET);
    await ensureWorn('give adamant_scimitar 1', 'Adamant scimitar');
    // The pack must read the same twice before the run may start, or a seed
    // step that lands late raises the count after the first read.
    const first = await snapshot();
    await page.waitForTimeout(3000);
    const s = await snapshot();
    assert.equal(first.food, 3, `seeded food ${first.food}, want 3`);
    assert.equal(s.food, 3, `seeded food drifted to ${s.food}, want a stable 3`);
    assert.equal(s.hp, HP_LEVEL, `seeded hp ${s.hp}, want full ${HP_LEVEL}`);
}

const inDungeon = (s: Snap): boolean => s.tile !== null && s.tile.z > 9000;
const bankLine = (m: string): boolean => m.includes('banking (food') || m.includes('panic at');

let result: Record<string, unknown> | null = null;

try {
    await mainlandAccount(page, base, tag, client.page);

    assert(await cheatQuiet(page, 'setvar waterfall_quest 10'), 'setvar waterfall_quest was not sent');
    await page.waitForTimeout(1500);
    assert.equal(await getServerVarQuiet(page, 'waterfall_quest'), 10, 'waterfall_quest is not 10 server-side');
    await relog(page, tag);
    await page.waitForTimeout(2000);
    const qs = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Quests.status('Waterfall Quest'));
    assert.notEqual(qs, 'notStarted', 'quest journal still reports notStarted after setvar + relog');

    await seedItemsToBank(page, [
        { debugName: 'lobster', displayName: 'Lobster', qty: 200 },
        { debugName: 'airrune', displayName: 'Air rune', qty: 100 },
        { debugName: 'lawrune', displayName: 'Law rune', qty: 20 }
    ], SEERS_BANK);

    // Nightly-scale stats: the fight lasts, hits land, and the 25% panic line is 10 hp,
    // inside one fire giant max hit. Defence stays at the fresh-account level.
    for (const [stat, level] of [['attack', 40], ['strength', 40], ['hitpoints', HP_LEVEL], ['magic', 50]] as const) {
        assert(await cheatQuiet(page, `setstat ${stat} ${level}`, 800), `setstat ${stat} not sent`);
    }
    await page.waitForTimeout(1500);
    await clearChatDialogs(page, 'level-up dialog(s)');
    const seeded = await snapshot();
    assert.equal(seeded.hpMax, HP_LEVEL, `hitpoints level ${seeded.hpMax}, want ${HP_LEVEL}`);
    console.log(`prepared account ${tag}: Waterfall done, atk/str/hp 40, magic 50, bank stocked`);

    // Loot stays at Big bones only: fire giants also drop lobsters, and a public
    // drop pile in the shared room would refill the pack this run means to empty.
    await setSettings(page, 'FireGiant', { combatStyle: 'melee', meleeStyle: 'strength', escapeTele: 'Camelot', foodWithdraw: 20, buryBones: false, bankCommonJunk: false, loot: 'Big bones' });
    await seedPack();
    assert(await teleTo(page, ANCHOR, 2), 'tele to the melee anchor failed');
    const startSnap = await snapshot();
    const xp0 = startSnap.xp;
    const t0 = Date.now();
    await startScript(page, 'FireGiant');
    console.log('started FireGiant at the melee anchor with three lobsters');

    const events: Event[] = [];
    const refusedAttacks: { t: number; text: string }[] = [];
    const busyOpponents: { t: number; text: string }[] = [];
    // Why: chat from account setup predates the script, so the refusal counts start from the start snapshot and only lines the script earns are counted.
    let refusalsSeen = startSnap.chat.filter(m => m.includes("I'm already under attack")).length;
    let busySeen = startSnap.chat.filter(m => m.includes('already fighting your opponent')).length;
    let seenLogs = 0;
    let foodZeroAt: number | null = null;
    let foodZeroHp = -1;
    let foodZeroXp = -1;
    let bankAt: number | null = null;
    let bankHp = -1;
    let bankMsg = '';
    let outAt: number | null = null;
    let diedAt: number | null = null;
    let restockedAt: number | null = null;
    let maxFood = 0;
    let restockedXp = -1;
    let returnXpAt: number | null = null;
    let last = await snapshot();
    const watchMs = before ? 420_000 : 900_000;
    while (Date.now() - t0 < watchMs) {
        await page.waitForTimeout(2000);
        last = await snapshot();
        if (outAt === null) {
            maxFood = Math.max(maxFood, last.food);
        }
        const t = Math.round((Date.now() - t0) / 1000);
        for (let i = seenLogs; i < last.logs.length; i++) {
            const msg = last.logs[i];
            events.push({ t, food: last.food, hp: last.hp, xp: last.xp, inDungeon: inDungeon(last), msg });
            if (bankAt === null && bankLine(msg)) {
                bankAt = t;
                bankHp = last.hp;
                bankMsg = msg;
            }
            if (diedAt === null && msg.includes('PARKED: died')) {
                diedAt = t;
            }
        }
        seenLogs = last.logs.length;
        // Why: the engine announces a refused attack in chat, so a click on a giant other than the one hitting the bot cannot pass silently.
        const refusals = last.chat.filter(m => m.includes("I'm already under attack"));
        for (let i = refusalsSeen; i < refusals.length; i++) {
            refusedAttacks.push({ t, text: refusals[i] });
        }
        refusalsSeen = Math.max(refusalsSeen, refusals.length);
        const busy = last.chat.filter(m => m.includes('already fighting your opponent'));
        for (let i = busySeen; i < busy.length; i++) {
            busyOpponents.push({ t, text: busy[i] });
        }
        busySeen = Math.max(busySeen, busy.length);
        if (foodZeroAt === null && last.food === 0) {
            foodZeroAt = t;
            foodZeroHp = last.hp;
            foodZeroXp = last.xp;
            console.log(`[${t}s] last food eaten (hp ${last.hp}/${last.hpMax})`);
        }
        if (foodZeroAt !== null && outAt === null && last.tile !== null && !inDungeon(last)) {
            outAt = t;
            console.log(`[${t}s] out of the dungeon at ${last.tile.x},${last.tile.z} (hp ${last.hp})`);
        }
        if (outAt !== null && restockedAt === null && last.food >= 20) {
            restockedAt = t;
            restockedXp = last.xp;
            console.log(`[${t}s] restocked to ${last.food} food`);
        }
        if (restockedAt !== null && returnXpAt === null && inDungeon(last) && last.xp > restockedXp) {
            returnXpAt = t;
            console.log(`[${t}s] back in the dungeon with new combat xp`);
        }
        if (before && (outAt !== null || diedAt !== null)) {
            break;
        }
        if (!before && returnXpAt !== null) {
            break;
        }
        if (!before && diedAt !== null) {
            break;
        }
    }

    const changes = targetChanges(events);
    const unexplained = changes.filter(c => c.why === 'unexplained');
    const unrecovered = refusedAttacks.filter(r => !changes.some(c => c.t > r.t && c.t - r.t <= 8) && !(bankAt !== null && bankAt > r.t && bankAt - r.t <= 8));
    result = {
        foodZeroAtS: foodZeroAt,
        startXp: xp0,
        foodZeroHp,
        hpLevel: HP_LEVEL,
        bankAtS: bankAt,
        bankHp,
        bankMsg,
        outAtS: outAt,
        diedAtS: diedAt,
        restockedAtS: restockedAt,
        maxFoodBeforeBank: maxFood,
        returnXpAtS: returnXpAt,
        foodlessSecondsBeforeBank: foodZeroAt !== null && bankAt !== null ? bankAt - foodZeroAt : null,
        foodlessXpGain: foodZeroXp >= 0 ? last.xp - foodZeroXp : null,
        targetChanges: changes,
        unexplainedTargetChanges: unexplained,
        refusedAttacks,
        unrecoveredRefusals: unrecovered,
        busyOpponents,
        events,
        final: last
    };

    assert(foodZeroAt !== null, 'the bot never ate its last lobster within the watch window');
    if (before) {
        const foughtOn = bankAt !== null && bankAt - foodZeroAt > 20;
        const bankedAtPanic = bankMsg.includes('panic at') || (bankAt !== null && bankHp >= 0 && bankHp < HP_LEVEL * (PANIC_FRAC + 0.05));
        const reproduced = diedAt !== null || foughtOn || bankedAtPanic;
        assert(reproduced, `expected the foodless fight to run on past 20s, to bank only at panic hp, or to die; foodZero=${foodZeroAt}s bank=${bankAt}s ("${bankMsg}", hp ${bankHp}) died=${diedAt}s`);
        console.log(`REPRODUCED last-food fight loop: food hit 0 at ${foodZeroAt}s (hp ${foodZeroHp}), bank at ${bankAt}s ("${bankMsg}", hp ${bankHp}), died=${diedAt}, target changes=${changes.length}, unexplained=${unexplained.length}, refused attacks=${refusedAttacks.length}`);
    } else {
        assert.equal(diedAt, null, `the bot died at ${diedAt}s`);
        assert(bankAt !== null, 'the bot never logged a bank line after the last food');
        assert(bankAt - foodZeroAt <= 20, `banking came ${bankAt - foodZeroAt}s after the last food, want <= 20s`);
        assert(!bankMsg.includes('panic at'), `the first bank line is the panic path: "${bankMsg}"`);
        assert(!events.some(e => e.msg.includes('panic at')), 'a panic line fired during the trip');
        assert(bankHp > HP_LEVEL * PANIC_FRAC, `hp at banking was ${bankHp}, at or below the panic line ${HP_LEVEL * PANIC_FRAC}`);
        assert(outAt !== null, 'the bot never left the dungeon');
        assert(restockedAt !== null, 'the bot never restocked to 20 food');
        assert(returnXpAt !== null, 'the bot never gained combat xp back in the dungeon after the restock');
        assert(maxFood <= 3, `held food rose to ${maxFood} during the fight, want the seeded 3 or fewer`);
        assert.equal(unexplained.length, 0, `unexplained target changes: ${unexplained.map(c => `[${c.t}s] ${c.from} -> ${c.to} via ${c.via} (gap ${c.gapS}s) ${c.msg}`).join(' | ')}`);
        // Why: facing cannot always name the giant that hit last when several face the bot at once, so one refused click is a transient. The defect was refusals with no correction, so each refusal must meet an accounted re-pick or the bank yield within 8s (the 4s stall plus poll slack), and the run may hold at most two.
        assert(refusedAttacks.length <= 2, `the engine refused ${refusedAttacks.length} attacks, want at most 2: ${refusedAttacks.map(r => `[${r.t}s] ${r.text}`).join(' | ')}`);
        assert.equal(unrecovered.length, 0, `refused attacks with no re-pick or bank within 8s: ${unrecovered.map(r => `[${r.t}s] ${r.text}`).join(' | ')}`);
        console.log(`PASS last-food bank exit: food hit 0 at ${foodZeroAt}s (hp ${foodZeroHp}), banked at ${bankAt}s (hp ${bankHp}), out at ${outAt}s, restocked at ${restockedAt}s, new xp in the dungeon at ${returnXpAt}s, ${changes.length} target changes all accounted for, ${refusedAttacks.length} refused attacks each corrected within 8s`);
    }
    await page.screenshot({ path: `${proofDir}/${tag}.png` });
    await stopScript(page);

    writeFileSync(`${proofDir}/${tag}.json`, JSON.stringify({ classification: before ? 'reproduced' : 'pass', tag, base, before, fixture: 'one account, Waterfall complete, attack/strength/hitpoints 40, defence fresh-account, magic 50, adamant scimitar worn, three lobsters held, Camelot runes held, stocked Seers bank, start teleported to the melee anchor 2575,9893; no NPCs spawned', result }, null, 2));
    console.log(`${before ? 'REPRODUCED' : 'PASS'} fire giant last-food check`);
} catch (error) {
    const snap = await snapshot().catch(() => null);
    writeFileSync(`${proofDir}/${tag}.json`, JSON.stringify({ classification: 'unconfirmed', tag, error: String(error), result, snap }, null, 2));
    await page.screenshot({ path: `${proofDir}/${tag}-failure.png` }).catch(() => undefined);
    throw error;
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
    const paths = [`${engine}/public/bot/${tag}`, `${engine}/public/bot-${tag}.html`];
    assert(paths.every(path => !existsSync(path)), 'isolated deployment cleanup failed');
    console.log(`CLEANUP ${JSON.stringify(paths)}`);
}
