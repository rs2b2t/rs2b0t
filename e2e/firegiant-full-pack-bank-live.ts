import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript, type Rs2b0t } from './lib/harness.js';
import { clearChatDialogs, getServerVarQuiet, mainlandAccount, relog, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2));
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'local engine required');
const tag = `fgpk${Date.now().toString(36).slice(-6)}`;
const proofDir = process.env.PROOF_DIR ?? 'out/firegiant-full-pack-bank';
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
            first(name: string): { interact(op: string): Promise<boolean> } | null;
        };
        Equipment: { contains(name: string): boolean; equip(name: string): Promise<boolean> };
        Skills: { xp(name: string): number; level(name: string): number; hpFraction(): number };
        Quests: { status(name: string): string };
        GroundItems: { query(): { results(): { name: string | null }[] } };
    };
};

const SEERS_BANK = { x: 2725, z: 3491, level: 0 };
const ANCHOR = { x: 2575, z: 9893, level: 0 };
const AMULET = "Glarial's amulet";
const results: unknown[] = [];

interface Snap {
    state: string;
    tile: { x: number; z: number; level: number } | null;
    xp: number;
    used: number;
    food: number;
    inventory: string[];
    logs: string[];
}

const snapshot = (): Promise<Snap> => page.evaluate(() => {
    const g = globalThis as never as Api;
    return {
        state: g.rs2b0t.runner.state,
        tile: g.rs2b0t.reader.worldTile(),
        xp: ['attack', 'strength', 'defence', 'hitpoints'].reduce((n, s) => n + g.__rs2b0t.Skills.xp(s), 0),
        used: g.__rs2b0t.Inventory.used(),
        food: g.__rs2b0t.Inventory.count('Lobster'),
        inventory: g.rs2b0t.reader.inventory().map(i => `${i.name} x${i.count}`),
        logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg)
    };
});
const held = (name: string) => page.evaluate(n => (globalThis as never as Api).__rs2b0t.Inventory.count(n), name);

async function giveHeld(cmd: string, name: string, want: number): Promise<void> {
    for (let i = 0; i < 5 && (await held(name)) < want; i++) {
        assert(await cheatQuiet(page, cmd), `cheat not sent: ${cmd}`);
        await page.waitForTimeout(800);
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

// Shared kit for both scenarios: entry items and Camelot runes held, weapon and amulet worn.
async function seedPack(food: number): Promise<void> {
    assert(await cheatQuiet(page, '~clearinv'), 'clearinv not sent');
    await page.waitForTimeout(800);
    if (food > 0) await giveHeld(`give lobster ${food}`, 'Lobster', food);
    await giveHeld('give rope 1', 'Rope', 1);
    await giveHeld('give airrune 15', 'Air rune', 15);
    await giveHeld('give lawrune 3', 'Law rune', 3);
    await ensureWorn('give glarials_amulet_waterfall_quest 1', AMULET);
    await ensureWorn('give rune_scimitar 1', 'Rune scimitar');
    const s = await snapshot();
    assert.equal(s.food, food, `seeded food ${s.food}, want ${food}`);
    assert.equal(s.used, food + 3, `seeded pack uses ${s.used} slots, want ${food + 3} (food + rope + 2 rune stacks)`);
}

// Why: scenario 2 needs the pickup to fill the pack before any eating, so the fixture starts at full hp where a smart-eat cannot fire first; the eaten food is given back to the same slot count.
async function healToFull(food: number): Promise<void> {
    const hp = () => page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.hpFraction());
    for (let i = 0; i < 24 && (await hp()) < 1; i++) {
        assert(await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.first('Lobster')?.interact('Eat')), 'Eat Lobster refused while healing the fixture');
        await page.waitForTimeout(1200);
    }
    assert.equal(await hp(), 1, 'fixture account is not at full hp');
    const missing = food - (await held('Lobster'));
    if (missing > 0) {
        await giveHeld(`give lobster ${missing}`, 'Lobster', food);
    }
}

async function watch(seconds: number, done: (s: Snap) => boolean): Promise<Snap> {
    const deadline = Date.now() + seconds * 1000;
    let last = await snapshot();
    while (Date.now() < deadline && !done(last)) {
        await page.waitForTimeout(5000);
        last = await snapshot();
    }
    return last;
}

const bankingLines = (s: Snap, food: number) => s.logs.filter(m => m.includes(`banking (food ${food}`)).length;

interface TraceSample {
    used: number;
    food: number;
    bones: number;
    xp: number;
}

// Why: the 5-second watch polls cannot order the pickup against eating or the first combat xp, so scenario 2 samples the pack in-page every 100 ms.
async function startPackTrace(): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as Api & { __fgPackTrace?: TraceSample[]; __fgPackTimer?: number };
        g.__fgPackTrace = [];
        g.__fgPackTimer = window.setInterval(() => {
            try {
                g.__fgPackTrace!.push({
                    used: g.__rs2b0t.Inventory.used(),
                    food: g.__rs2b0t.Inventory.count('Lobster'),
                    bones: g.__rs2b0t.Inventory.count('Big bones'),
                    xp: ['attack', 'strength', 'defence', 'hitpoints'].reduce((n, s) => n + g.__rs2b0t.Skills.xp(s), 0)
                });
            } catch {
                // A sample missed during a frame reload is a gap in the trace, not a state.
            }
        }, 100);
    });
}

async function stopPackTrace(): Promise<TraceSample[]> {
    return page.evaluate(() => {
        const g = globalThis as never as { __fgPackTrace?: TraceSample[]; __fgPackTimer?: number };
        window.clearInterval(g.__fgPackTimer);
        return g.__fgPackTrace ?? [];
    });
}

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

    assert(await cheatQuiet(page, '~maxme'), 'maxme not sent');
    await page.waitForFunction(() => (globalThis as never as Api).__rs2b0t.Skills.level('magic') >= 99, undefined, { timeout: 30_000 });
    await clearChatDialogs(page, 'level-up dialog(s)');
    console.log(`prepared account ${tag}: Waterfall done, stats maxed, bank stocked`);

    // Scenario 1: a restock of 25 fills all 28 slots (25 food + rope + air + law, amulet worn).
    // A full pack must not send the bot straight back to the bank before it has fought at all.
    await setSettings(page, 'FireGiant', { combatStyle: 'melee', meleeStyle: 'strength', escapeTele: 'Camelot', foodWithdraw: 25, buryBones: false });
    await seedPack(0);
    assert(await teleTo(page, SEERS_BANK, 3), 'tele to Seers bank failed');
    const xpA0 = (await snapshot()).xp;
    await startScript(page, 'FireGiant');
    let a: Snap;
    if (before) {
        a = await watch(300, s => bankingLines(s, 25) >= 2);
        assert(bankingLines(a, 25) >= 2, `expected repeated "banking (food 25)" lines, logs: ${a.logs.slice(-12).join(' | ')}`);
        assert(a.tile === null || a.tile.z < 9000, 'bot reached the dungeon instead of looping at the bank');
        console.log('REPRODUCED restock-fills-pack: the bot re-banked at full food without leaving for the dungeon');
    } else {
        a = await watch(720, s => s.tile !== null && s.tile.z > 9000 && s.xp > xpA0);
        assert.equal(bankingLines(a, 25), 0, `bot re-banked at full food, logs: ${a.logs.slice(-12).join(' | ')}`);
        assert(a.tile !== null && a.tile.z > 9000, 'bot never reached the dungeon after restocking to a full pack');
        assert(a.xp > xpA0, 'bot reached the dungeon but gained no combat xp');
        console.log('PASS restock-fills-pack: one restock, then the dungeon and combat xp');
    }
    results.push({ scenario: 'restock-fills-pack', snapshot: a });
    await page.screenshot({ path: `${proofDir}/${tag}-restock-fills-pack.png` });
    await stopScript(page);

    // Scenario 2: a restock of 24 leaves one free slot. One Big bones on the dungeon floor
    // fills it. The full pack must not send the bot to the bank before its first fight.
    await setSettings(page, 'FireGiant', { combatStyle: 'melee', meleeStyle: 'strength', escapeTele: 'Camelot', foodWithdraw: 24, buryBones: false });
    await seedPack(24);
    assert(await teleTo(page, ANCHOR, 2), 'tele to the melee anchor failed');
    await page.waitForTimeout(1000);
    await healToFull(24);
    // Fill the last free slot with bones, drop them at the anchor, and start at once: the pack is
    // back at 27 slots with the drop on the floor, as after a restock and return.
    await giveHeld('give big_bones 1', 'Big bones', 1);
    assert(await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.first('Big bones')?.interact('Drop')), 'Drop Big bones refused');
    await page.waitForTimeout(1500);
    assert.equal(await held('Big bones'), 0, 'bones still held after Drop');
    const ground = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.GroundItems.query().results().map(g => g.name));
    assert(ground.includes('Big bones'), `dropped bones not visible on the ground (saw: ${ground.join(', ') || 'nothing'})`);
    const preB = await snapshot();
    assert.equal(preB.used, 27, `pre-start pack uses ${preB.used} slots, want 27`);
    assert.equal(preB.food, 24, `pre-start pack holds ${preB.food} food, want 24`);
    const xpB0 = preB.xp;
    await startPackTrace();
    await startScript(page, 'FireGiant');
    let b: Snap;
    if (before) {
        b = await watch(240, s => bankingLines(s, 24) >= 1 && (s.tile === null || s.tile.z < 9000));
        assert(bankingLines(b, 24) >= 1, `expected "banking (food 24)", logs: ${b.logs.slice(-12).join(' | ')}`);
        assert(b.tile !== null && b.tile.z < 9000, `bot is still in the dungeon at ${JSON.stringify(b.tile)}`);
        assert(b.inventory.some(i => i.startsWith('Big bones')), 'the looted bones that filled the pack are not held');
        console.log(`REPRODUCED stray-drop-after-restock: banked at food 24 with ${b.xp - xpB0} combat xp gained`);
    } else {
        b = await watch(300, s => s.logs.some(m => m.includes('fire giant down')));
        assert.equal(bankingLines(b, 24), 0, `bot banked at full food, logs: ${b.logs.slice(-12).join(' | ')}`);
        assert(b.tile !== null && b.tile.z > 9000, `bot left the dungeon: ${JSON.stringify(b.tile)}`);
        assert(b.logs.some(m => m.includes('fire giant down')), 'no kill logged within the watch window');
        assert(b.xp > xpB0, 'no combat xp gained');
        console.log('PASS stray-drop-after-restock: looted the bones, stayed, and killed a giant');
    }
    // The scenario only proves the trigger if the pack reached 28 slots at full food
    // with the bones held, before any combat xp landed and before the bot ate. Anything else
    // (another bot took the bones, or eating came first) is a failed setup, never a pass.
    const trace = await stopPackTrace();
    const fullIdx = trace.findIndex(s => s.used === 28 && s.food === 24 && s.bones >= 1);
    assert(fullIdx >= 0, `full-pack state not reached: no 100 ms sample holds 28 used slots, 24 food and Big bones (${trace.length} samples, max used ${Math.max(0, ...trace.map(s => s.used))}, bones held in ${trace.filter(s => s.bones >= 1).length} samples)`);
    assert.equal(trace[fullIdx].xp, xpB0, `full-pack state not reached before the first swing: combat xp had already gained ${trace[fullIdx].xp - xpB0} at sample ${fullIdx}`);
    assert(trace.slice(0, fullIdx + 1).every(s => s.food === 24), 'full-pack state not reached without eating first: food dropped below 24 before the pickup filled the pack');
    const swingIdx = trace.findIndex(s => s.xp > xpB0);
    const fullPackState = { usedSlots: 28, food: 24, fillerItem: 'Big bones', bonesHeld: trace[fullIdx].bones, combatXpGainedAtState: trace[fullIdx].xp - xpB0, sampleIndex: fullIdx, firstCombatXpSampleIndex: swingIdx, samples: trace.length, sampleMs: 100 };
    console.log(`FULL-PACK STATE sample ${fullIdx}/${trace.length}: used 28, food 24, filler Big bones x${trace[fullIdx].bones}, combat xp gained 0 (first combat xp at sample ${swingIdx})`);
    results.push({ scenario: 'stray-drop-after-restock', fullPackState, snapshot: b });
    await page.screenshot({ path: `${proofDir}/${tag}-stray-drop-after-restock.png` });
    await stopScript(page);

    writeFileSync(`${proofDir}/${tag}.json`, JSON.stringify({ classification: before ? 'reproduced' : 'pass', tag, base, before, fixture: 'one maxed account with Waterfall complete and a stocked Seers bank; scenario 1 restocks 25 food so the pack is full on departure; scenario 2 starts at the melee anchor at 27 slots with one dropped Big bones on the floor; real API results unchanged', results }, null, 2));
    console.log(`${before ? 'REPRODUCED' : 'PASS'} fire giant full-pack bank checks`);
} catch (error) {
    const result = await snapshot().catch(() => null);
    writeFileSync(`${proofDir}/${tag}.json`, JSON.stringify({ classification: 'unconfirmed', tag, error: String(error), results, result }, null, 2));
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
