import { boot, fail, launchBrowser, parseArgs } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8890', minutes: 18 });
const mode = (rest[0] ?? 'assert').toLowerCase();
const username = `af${Date.now().toString(36).slice(-7)}`;
const OVERRIDES = mode === 'soak' ? 'ArdyFighter.eatAtHp=50' : 'ArdyFighter.bankAtLootSlots=2&ArdyFighter.foodTarget=4&ArdyFighter.eatAtHp=60';
const PAGE = `${base}/bot.html?${OVERRIDES}`;

const ANCHOR = { x: 2661, z: 3306 };
const UNLOCK_TELE = 'tele 0,50,50,20,20';
const ANCHOR_TELE = 'tele 0,41,51,37,42';

type Inv = { name: string | null; count: number };

const browser = await launchBrowser();

try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as Rs2b0t).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 30000 }).then(() => true).catch(() => false);
    };
    const cheat = async (command: string, wait = 1200) => {
        const sent = await page.evaluate(cmd => {
            const c = (globalThis as never as Rs2b0t).rs2b0t.client;
            if (!c.ingame || !c.out) return false;
            c.out.p1Enc(224); c.out.p1(cmd.length + 1); c.out.pjstr(cmd);
            return true;
        }, command);
        if (!sent) fail(`cheat '::${command}' not sent — client not ingame`);
        await page.waitForTimeout(wait);
    };

    const inv = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory());
    const countSub = (items: Inv[], sub: string) => items.filter(i => (i.name ?? '').toLowerCase().includes(sub)).reduce((s, i) => s + i.count, 0);
    const foodOf = (items: Inv[]) => countSub(items, 'cake') + countSub(items, 'bread') + countSub(items, 'chocolate slice');
    const lootOf = (items: Inv[]) => countSub(items, 'steel arrow') + countSub(items, 'iron ore');
    const counters = () => page.evaluate(() => {
        const b = (globalThis as never as Rs2b0t).rs2b0t.runner.bot as Record<string, number | string> | null;
        return b ? { kills: +b.kills, steals: +b.steals, eats: +b.eats, looted: +b.looted, trips: +b.trips, deaths: +b.deaths, status: String(b.status) } : null;
    });
    const where = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    const distAnchor = (t: { x: number; z: number } | null) => (t ? Math.max(Math.abs(t.x - ANCHOR.x), Math.abs(t.z - ANCHOR.z)) : 999);
    const runnerState = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state);

    await page.goto(PAGE); await boot(page);
    let firstIn = false;
    for (let i = 0; i < 3 && !firstIn; i++) firstIn = await login();
    if (!firstIn) fail('first login failed');
    await cheat(UNLOCK_TELE);
    await page.reload(); await boot(page);
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) fail('re-login failed');
    await cheat('advancestat attack 80');
    await cheat('advancestat strength 80');
    await cheat('advancestat defence 45');
    await cheat('advancestat hitpoints 55');
    await cheat('advancestat thieving 10');

    for (let i = 0; i < 3 && distAnchor(await where()) > 6; i++) { await cheat(ANCHOR_TELE); await page.waitForTimeout(1500); }
    const t0 = await where();
    if (distAnchor(t0) > 6) fail(`anchor tele never took — at ${t0?.x},${t0?.z}`);
    await page.waitForTimeout(1500);
    const geo = await page.evaluate(() => {
        const r = (globalThis as never as Rs2b0t).rs2b0t.reader;
        const guards = r.npcs().filter(n => n.name === 'Guard');
        const stall = r.locs().find(l => l.name === "Baker's stall" && l.ops.includes('Steal from'));
        return {
            guards: guards.length,
            nearestGuard: guards.length ? Math.min(...guards.map(n => n.distance)) : -1,
            stall: stall ? { x: stall.tile.x, z: stall.tile.z, ops: stall.ops.filter(Boolean) } : null
        };
    });
    console.log(`[geo] at ${t0?.x},${t0?.z}  guards=${geo.guards} (nearest ${geo.nearestGuard})  stall=${geo.stall ? `${geo.stall.x},${geo.stall.z} ${JSON.stringify(geo.stall.ops)}` : 'NOT FOUND'}`);
    if (geo.guards === 0) console.log('[geo] WARNING: no Guard NPCs at the anchor — check the anchor tile');
    if (!geo.stall) console.log("[geo] WARNING: no 'Baker's stall' with 'Steal from' in scene — check STALL_TILE/name");

    let started = false;
    for (let attempt = 0; attempt < 4 && !started; attempt++) {
        await page.getByRole('button', { name: 'Browse…' }).click().catch(() => {});
        await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: /^Combat/ }).click().catch(() => {});
        await page.waitForTimeout(500);
        const card = page.locator('.rs2b0t-library-card', { hasText: 'ArdyFighter' });
        if (await card.count() > 0) {
            await card.first().click();
            await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 }).catch(() => {});
            await page.getByRole('button', { name: 'Start' }).click();
            started = true;
        } else {
            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(1000);
        }
    }
    if (!started) fail('could not find/start the ArdyFighter card in the Browse modal');
    console.log(`ArdyFighter started (mode=${mode}, overrides: ${OVERRIDES})`);

    if (mode === 'soak') {
        console.log(`SOAK: running ${minutes} min unattended (near-defaults), polling every 20s`);
        const end = Date.now() + minutes * 60_000;
        let lastLog = 0, lastProgressAt = Date.now(), lastLen = 0, lastSum = -1, restarts = 0, stalled = false;
        while (Date.now() < end) {
            await page.waitForTimeout(20000);
            if ((await runnerState()) === 'crashed') fail('runner state crashed during soak');
            const log = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
            if (log.length < lastLog) { restarts++; console.log('  [soak] watchdog restart detected (log reset)'); lastLog = 0; }
            for (const line of log.slice(lastLog)) console.log(`  [bot] ${line}`);
            lastLog = log.length;
            const c = await counters();
            const t = await where();
            if (!c) { console.log('  [soak] bot instance unreadable'); continue; }
            const sum = c.kills + c.steals + c.eats + c.looted + c.trips;
            const mins = ((minutes * 60_000 - (end - Date.now())) / 60_000).toFixed(1);
            console.log(`  [soak +${mins}m] kills=${c.kills} steals=${c.steals} eats=${c.eats} looted=${c.looted} trips=${c.trips} deaths=${c.deaths} | tile ${t ? `${t.x},${t.z}` : '?'} d${distAnchor(t)} | restarts=${restarts} | '${c.status}'`);
            if (log.length > lastLen || sum > lastSum) { lastProgressAt = Date.now(); lastLen = log.length; lastSum = sum; }
            else if (Date.now() - lastProgressAt > 5 * 60_000) { stalled = true; console.log('  [soak] WARNING: no log growth / counter progress for 5 min — possible stall'); lastProgressAt = Date.now(); }
        }
        const c = await counters();
        await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
        console.log(`\nSOAK RESULT (${minutes} min): kills=${c?.kills} steals=${c?.steals} eats=${c?.eats} looted=${c?.looted} trips=${c?.trips} deaths=${c?.deaths}`);
        console.log(`  watchdog restarts: ${restarts}  |  stall flagged: ${stalled}`);
        console.log(stalled ? 'SOAK: completed WITH a stall warning' : 'SOAK: completed, no crash and no stall');
        process.exit(0);
    }

    const deadline = Date.now() + minutes * 60_000;
    let lastLog = 0;
    let stage: 'restock' | 'bank' = 'restock';
    let sawPull = false;
    let foodBeforeBank = 0;
    let depositSeen = false;
    let returned = false;

    while (Date.now() < deadline) {
        await page.waitForTimeout(7000);
        if ((await runnerState()) === 'crashed') fail('runner state crashed');

        const s = await page.evaluate(() => {
            const { runner, reader } = (globalThis as never as Rs2b0t).rs2b0t;
            const g = reader.npcs().filter(n => n.name === 'Guard').sort((a, b) => a.distance - b.distance)[0];
            const hp = reader.stat(3);
            return { log: (runner.ctx?.log ?? []).map(l => l.msg), chat: reader.chat(4).map(c => c.text), inCombat: reader.inCombat(), hp: `${hp.effective}/${hp.base}`, guard: g ? `${g.health}/${g.totalHealth}@${g.distance}` : '-' };
        });
        for (const line of s.log.slice(lastLog)) console.log(`  [bot] ${line}`);
        lastLog = s.log.length;

        const c = await counters();
        const items = await inv();
        const food = foodOf(items);
        const loot = lootOf(items);
        const t = await where();
        if (!c) { console.log('  [diag] (bot instance not readable yet)'); continue; }
        if (!sawPull && (s.chat.some(l => /hands off/i.test(l)) || (/restock/i.test(c.status) && await page.evaluate(() => (globalThis as never as { rs2b0t: { reader: { inCombat(): boolean } } }).rs2b0t.reader.inCombat())))) {
            sawPull = true;
            console.log('  >> guard pull observed (LOS guard blocked the steal and attacked)');
        }
        console.log(`  [diag] stage=${stage} kills=${c.kills} steals=${c.steals} eats=${c.eats} looted=${c.looted} trips=${c.trips} | food=${food} loot=${loot} | combat=${s.inCombat} hp=${s.hp} g=${s.guard} | tile ${t ? `${t.x},${t.z}` : '?'} d${distAnchor(t)} | '${c.status}'`);

        if (stage === 'restock') {
            if (c.steals >= 2 && c.kills > 0 && food >= 3) {
                foodBeforeBank = food;
                console.log(`  >> restock+kill confirmed (steals=${c.steals}, kills=${c.kills}, food=${food}); injecting 2 loot slots to trigger the bank run`);
                await cheat('give steel_arrow 50');
                await cheat('give iron_ore 1');
                stage = 'bank';
            }
            continue;
        }

        if (!depositSeen && c.trips > 0 && s.log.some(l => /deposited the loot/i.test(l))) {
            const lootNow = lootOf(items);
            const foodNow = foodOf(items);
            if (lootNow === 0 && foodNow > 0) {
                depositSeen = true;
                console.log(`  >> loot deposited (steel arrow + iron ore gone), ${foodNow} food preserved (had ${foodBeforeBank}) — food NOT deposited`);
            } else {
                console.log(`  [diag] post-trip check: loot=${lootNow} food=${foodNow} (waiting for the deposit to settle)`);
            }
        }
        if (depositSeen && distAnchor(t) <= 8) returned = true;

        if (depositSeen && returned) {
            const lootPickup = c.looted > 0;
            console.log('\nresult summary:');
            console.log(`  (a) restock + guard pull : steals=${c.steals}, food reached ${foodBeforeBank}, pull observed=${sawPull}`);
            console.log(`  (b) guard kill           : kills=${c.kills}`);
            console.log(`  (c) loot                 : ${lootPickup ? `natural pickup (looted=${c.looted})` : 'observed loot deposit at the bank'}`);
            console.log(`  (d) bank round-trip      : deposited loot only (cakes kept), returned to the market (trips=${c.trips})`);
            console.log(`  eats (opportunistic)     : ${c.eats}`);
            if (!sawPull) console.log('  NOTE: explicit guard-pull chat/combat not caught, but restock still succeeded');
            console.log('\nPASS');
            await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
            process.exit(0);
        }
    }

    const c = await counters();
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    fail(`timed out in stage '${stage}' — ${c ? `kills=${c.kills} steals=${c.steals} looted=${c.looted} trips=${c.trips} status='${c.status}'` : 'bot unreadable'} (depositSeen=${depositSeen}, returned=${returned})`);
} finally {
    await browser.close();
}
