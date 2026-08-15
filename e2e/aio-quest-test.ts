// Live AIOQuester harness: [base] [user] [questsCsv] [minutes] [giveCsv] [statsCsv] [food] [cheatsCsv] [tele].
// Why: giveCsv takes engine debug names (bronze_pickaxe) through give/givebank — content `~item` no-ops silently behind the busy guard.

// Usage:
//   HEADED=1 bun e2e/aio-quest-test.ts \
//     [base] [user] [questsCsv] [minutes] [giveCsv] [statsCsv] [food] [cheatsCsv] [tele]

// Ideal (inventory pre-loaded, max stats) — mid-quest smoke only (proven PASS):
//   HEADED=1 bun e2e/aio-quest-test.ts http://localhost:8890 ew1 elemental_workshop 15 \
//     'knife:1,hammer:1,bronze_pickaxe:1,thread:1,leather:1,needle:1,coal:4,lobster:15,steel_scimitar:1' \
//     max Lobster 'speed 300' '2716,3481'

// Realistic (empty pack, bank tools, min skill gates). Proven combat floor 50/50/40/50;
// 40/40/25/40 died on Water elemental (see EW_PROVEN_COMBAT_FLOOR / TESTING.md):
//   HEADED=1 bun e2e/aio-quest-test.ts http://localhost:8890 ew2 elemental_workshop 25 \
//     'bank:knife:1,bank:hammer:1,bank:bronze_pickaxe:1,bank:thread:2,bank:leather:1,bank:needle:1,bank:coal:8,bank:lobster:20,bank:steel_scimitar:1,bank:coins:50000' \
//     'mining:20,smithing:20,crafting:20,attack:50,strength:50,defence:40,hitpoints:50' \
//     Lobster 'speed 300' '2725,3491'
import type { Page } from 'playwright-core';
import { launchBrowser, positionalArgs } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    mainlandAccount,
    maxmeAndClearDialogs,
    seedItemsToBank,
    startScript,
    teleCheat,
    teleTo,
    type BankSeedItem
} from './tutorial/harness.js';
import { QUESTS } from '../src/bot/api/ai/quests/data/quests.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const username = args[1] || `aq${Date.now().toString(36).slice(-7)}`;
const questsCsv = (args[2] || 'runemysteries').trim();
const budgetMin = Number(args[3]) || 25;
const giveCsv = (args[4] || '').trim();
const statsCsv = (args[5] || '').trim();
const foodSetting = (args[6] || '').trim();
/** Raw debugprocs (not ~maxme — use statsCsv=max). e.g. `speed 300`. */
const cheatsCsv = (args[7] || '').trim();
/** World `x,z[,level]` or engine `level,mx,mz,lx,lz`. */
const teleArg = (args[8] || '').trim();
const BUDGET_MS = budgetMin * 60_000;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

const NAME_BY_ID = new Map(QUESTS.map(q => [q.id, q.name]));

/** Map engine debug names to inventory display names for bank verification. */
const DISPLAY_NAME: Record<string, string> = {
    knife: 'Knife',
    hammer: 'Hammer',
    bronze_pickaxe: 'Bronze pickaxe',
    iron_pickaxe: 'Iron pickaxe',
    steel_pickaxe: 'Steel pickaxe',
    mithril_pickaxe: 'Mithril pickaxe',
    adamant_pickaxe: 'Adamant pickaxe',
    rune_pickaxe: 'Rune pickaxe',
    thread: 'Thread',
    leather: 'Leather',
    needle: 'Needle',
    coal: 'Coal',
    lobster: 'Lobster',
    swordfish: 'Swordfish',
    coins: 'Coins',
    bronze_scimitar: 'Bronze scimitar',
    iron_scimitar: 'Iron scimitar',
    steel_scimitar: 'Steel scimitar',
    mithril_scimitar: 'Mithril scimitar',
    adamant_scimitar: 'Adamant scimitar',
    rune_scimitar: 'Rune scimitar'
};

const picked = questsCsv.split(',').map(s => s.trim()).filter(s => s.length > 0);
if (picked.length === 0) { fail('no quest ids given'); }
const queue = picked.map(id => {
    const name = NAME_BY_ID.get(id);
    if (!name) { console.log(`WARN: quest id '${id}' is not in QUESTS — polling by id, it will not complete`); }
    return { id, name: name ?? id };
});

type Snapshot = {
    pos: { x: number; z: number; level: number } | null;
    statuses: Record<string, string>;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
};

/** Parse tele arg into a world tile (for wait) + engine cheat string. */
function parseTele(arg: string): { tile: { x: number; z: number; level: number }; cheat: string } | null {
    if (!arg) {
        return null;
    }
    const parts = arg.split(',').map(s => Number(s.trim()));
    if (parts.some(n => !Number.isFinite(n))) {
        return null;
    }
    if (parts.length === 2 || parts.length === 3) {
        const tile = { x: parts[0]!, z: parts[1]!, level: parts[2] ?? 0 };
        return { tile, cheat: teleCheat(tile) };
    }
    if (parts.length === 5) {
        const [level, mx, mz, lx, lz] = parts as [number, number, number, number, number];
        const tile = { x: mx * 64 + lx, z: mz * 64 + lz, level };
        return { tile, cheat: `tele ${level},${mx},${mz},${lx},${lz}` };
    }
    return null;
}

function displayNameFor(debugName: string): string {
    return DISPLAY_NAME[debugName] ?? debugName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Split giveCsv into inventory gives and bank seeds.
 * `bank:obj:qty` → bank; `obj:qty` → inventory.
 */
function parseGiveCsv(csv: string): { inv: { debugName: string; qty: number }[]; bank: BankSeedItem[] } {
    const inv: { debugName: string; qty: number }[] = [];
    const bank: BankSeedItem[] = [];
    for (const pair of csv.split(',').map(s => s.trim()).filter(s => s.length > 0)) {
        const parts = pair.split(':').map(s => s.trim());
        if (parts[0]?.toLowerCase() === 'bank' && parts.length >= 2) {
            const debugName = parts[1]!;
            const qty = Number(parts[2]) || 1;
            bank.push({ debugName, displayName: displayNameFor(debugName), qty });
            continue;
        }
        const debugName = parts[0]!;
        const qty = Number(parts[1]) || 1;
        inv.push({ debugName, qty });
    }
    return { inv, bank };
}

async function seedInvGives(page: Page, items: { debugName: string; qty: number }[]): Promise<void> {
    for (const it of items) {
        const cmd = `give ${it.debugName} ${it.qty}`;
        if (!(await cheatQuiet(page, cmd))) {
            fail(`account prep '${cmd}' not sent (not ingame?)`);
        }
        console.log(`gave ${it.debugName}:${it.qty}`);
    }
}

async function seedStats(page: Page, csv: string): Promise<void> {
    if (!csv) {
        return;
    }
    if (csv.toLowerCase() === 'max') {
        console.log('maxme + clear level-up dialogs');
        await maxmeAndClearDialogs(page);
        return;
    }
    let advanced = false;
    for (const pair of csv.split(',').map(s => s.trim()).filter(s => s.length > 0)) {
        const [stat, lvl] = pair.split(':');
        if (!(await cheatQuiet(page, `advancestat ${stat} ${Number(lvl) || 1}`))) {
            fail(`account prep 'advancestat ${pair}' not sent (not ingame?)`);
        }
        console.log(`advanced ${pair}`);
        advanced = true;
    }
    if (advanced) {
        await clearChatDialogs(page, 'level-up dialog(s)');
        await page.waitForTimeout(1500);
        await clearChatDialogs(page, 'straggler dialog(s)');
    }
}

const tele = parseTele(teleArg);
if (teleArg && !tele) {
    fail(`bad tele '${teleArg}' — use x,z[,level] or level,mx,mz,lx,lz`);
}

const { inv: invGives, bank: bankGives } = parseGiveCsv(giveCsv);
// Default bank stand: tele arg if present, else Seers bank for bank seeds.
const bankStand = tele?.tile ?? { x: 2725, z: 3491, level: 0 };

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) {
            console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
        }
    });

    await mainlandAccount(page, base, username);
    console.log(`mainland-ready as '${username}'`);

    // Non-maxme cheats first (speed, clearinv, …). ~maxme goes through statsCsv=max.
    for (const command of cheatsCsv.split(',').map(s => s.trim()).filter(s => s.length > 0)) {
        if (command === '~maxme' || command === 'maxme') {
            console.log(`cheat: ${command} (deferred — use statsCsv=max for dialog drain)`);
            continue;
        }
        if (command.startsWith('tele ')) {
            console.log(`cheat: ${command} (deferred — use tele arg so it runs after dialogs)`);
            continue;
        }
        if (!(await cheatQuiet(page, command))) {
            fail(`account prep '${command}' not sent (not ingame?)`);
        }
        console.log(`cheat: ${command}`);
    }

    // Stats before bank seed: level-up dialogs must be gone before booth clicks.
    await seedStats(page, statsCsv);

    if (/(^|,)\s*~?maxme\s*(,|$)/i.test(cheatsCsv) && statsCsv.toLowerCase() !== 'max') {
        console.log('maxme from cheatsCsv — clearing dialogs');
        await cheatQuiet(page, '~maxme');
        await clearChatDialogs(page, 'level-up dialog(s)');
        await page.waitForTimeout(1500);
        await clearChatDialogs(page, 'straggler dialog(s)');
    }

    if (bankGives.length > 0) {
        console.log(`seeding ${bankGives.length} item type(s) into the bank at (${bankStand.x},${bankStand.z})`);
        try {
            await seedItemsToBank(page, bankGives, bankStand);
        } catch (e) {
            fail(String(e));
        }
    }

    await seedInvGives(page, invGives);

    if (tele) {
        console.log(`tele → ${tele.tile.x},${tele.tile.z},${tele.tile.level}`);
        if (!(await teleTo(page, tele.tile, 10, 25_000))) {
            await clearChatDialogs(page, 'pre-tele dialog(s)');
            if (!(await teleTo(page, tele.tile, 10, 25_000))) {
                fail(`tele to ${tele.tile.x},${tele.tile.z} did not arrive`);
            }
        }
        await page.waitForTimeout(1500);
    }

    await page.evaluate(csv => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', csv), questsCsv);
    if (foodSetting) {
        await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), foodSetting);
        console.log(`food setting: ${foodSetting}`);
    }
    console.log(`queued: ${queue.map(q => q.id).join(', ')}`);
    if (bankGives.length > 0) {
        console.log('mode: bank-seeded (expect scanBank/withdraw before quest actions)');
    }

    await startScript(page, 'AIOQuester');
    console.log('started AIOQuester — watching');

    const snap = (queueArg: { id: string; name: string }[]): Promise<Snapshot> =>
        page.evaluate(qq => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: { worldTile(): { x: number; z: number; level: number } | null };
                    Quests: { status(n: string): string; points(): number };
                };
                rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
            };
            const statuses: Record<string, string> = {};
            for (const q of qq) { statuses[q.id] = g.__rs2b0t.Quests.status(q.name); }
            const ring = g.rs2b0t.runner.ctx?.log ?? [];
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                statuses,
                qp: g.__rs2b0t.Quests.points(),
                runner: g.rs2b0t.runner.state,
                logs: ring.slice(-60).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
            };
        }, queueArg);

    const deadline = Date.now() + BUDGET_MS;
    let last: Snapshot | null = null;
    let lastLogTime = 0;
    while (Date.now() < deadline) {
        last = await snap(queue);
        const t = Math.round((BUDGET_MS - (deadline - Date.now())) / 1000);
        const jrn = queue.map(q => `${q.id}=${last!.statuses[q.id]}`).join(' ');
        console.log(`  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'} ${jrn} qp=${last.qp} runner=${last.runner}`);
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }
        const allDone = queue.every(q => last!.statuses[q.id] === 'complete');
        if (allDone && last.runner !== 'running') { break; }
        // Early fail if blocked forever with runner stopped
        if (last.runner === 'stopped' && !allDone) {
            const dump = queue.map(q => `${q.id}=${last!.statuses[q.id]}`).join(' ');
            fail(`script stopped with incomplete queue [${dump}] qp=${last.qp}`);
        }
        await page.waitForTimeout(10_000);
    }

    if (!last) { fail('no snapshot'); }
    const incomplete = queue.filter(q => last!.statuses[q.id] !== 'complete');
    if (incomplete.length > 0) {
        const dump = queue.map(q => `${q.id}=${last!.statuses[q.id]}`).join(' ');
        fail(`quests not complete within ${budgetMin}min [${dump}] qp=${last.qp} runner=${last.runner}`);
    }
    if (last.qp < 1) { fail(`quest points ${last.qp}, expected >= 1`); }
    if (last.runner === 'running') { fail('script did not stop itself after the queue drained'); }
    console.log(`PASS (${queue.map(q => q.id).join(' -> ')} all journal complete, QP=${last.qp}, clean stop)`);
} finally {
    await browser.close();
}
