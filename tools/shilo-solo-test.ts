// docs/TESTING.md#live-harnesses
import { fail, launchBrowser } from './lib/harness.js';
import { cheat, cheatQuiet, mainlandAccount, relog, startScript } from './tutorial/harness.js';

const QUESTS: Record<string, { name: string; varp: string; bits?: string }> = {
    shilo: { name: 'Shilo Village', varp: 'zombiequeen', bits: 'zq_map_mechanisms' },
    jungle: { name: 'Jungle Potion', varp: 'junglepotion' }
};

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string): boolean => argv.includes(name);

const which = opt('--quest') ?? 'shilo';
const quest = QUESTS[which];
if (!quest) {
    fail(`--quest must be one of ${Object.keys(QUESTS).join(', ')}`);
}

const base = opt('--base') ?? 'http://localhost:8888';
const user = opt('--user') ?? `sv${Date.now().toString(36).slice(-7)}`;
const stage = opt('--stage');
const bits = opt('--bits');
const give = opt('--give') ?? '';
const purse = opt('--purse') ?? '';
// "0,mx,mz,lx,lz" — drop the account next to the leg under test instead of
// walking it from Lumbridge every run.
const tele = opt('--tele');
const gear = which === 'shilo' && !flag('--no-gear');
const GEAR: readonly (readonly [string, string])[] = [
    ['rune_scimitar', 'Rune scimitar'],
    ['rune_platebody', 'Rune platebody'],
    ['rune_platelegs', 'Rune platelegs'],
    ['rune_full_helm', 'Rune full helm'],
    ['rune_kiteshield', 'Rune kiteshield']
];
const minutes = Number(opt('--minutes') ?? 30);
// The issue asks for 2x ticks; 300ms is half of the engine's 600.
const speed = opt('--speed') ?? '300';
// Shilo is gated on Jungle Potion, which is gated on Druidic Ritual. A solo Shilo
// run cheats past both rather than replaying forty minutes of prerequisite.
// `start_junglepotion` tests `%druidquest = ^druid_complete` for *equality*, so 4
// exactly — a higher value reads as "requirements not met" and the quest silently
// refuses to start.
const prereqs = flag('--no-prereqs') ? [] : which === 'shilo' ? ['junglepotion 12', 'druidquest 4'] : ['druidquest 4'];

interface SoloSnapshot {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

const browser = await launchBrowser();
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

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    await cheat(page, `speed ${speed}`);
    if (!(await cheatQuiet(page, '~maxme'))) {
        fail('could not max stats');
    }

    for (const pair of prereqs) {
        const [varp, value] = pair.split(' ');
        if (!(await cheatQuiet(page, `setvar ${varp} ${value}`))) {
            fail(`could not set ${varp}`);
        }
        console.log(`prerequisite ${varp}=${value}`);
    }
    if (stage !== undefined && !(await cheatQuiet(page, `setvar ${quest.varp} ${stage}`))) {
        fail(`could not set ${quest.varp}`);
    }
    if (bits !== undefined) {
        if (!quest.bits) {
            fail(`--bits is not supported for ${which}`);
        }
        if (!(await cheatQuiet(page, `setvar ${quest.bits} ${bits}`))) {
            fail(`could not set ${quest.bits}`);
        }
    }
    // The quest-tab colour is pushed by if_setcolour, not derived from the varp;
    // only the login script's ~update_questlist re-derives it after a setvar.
    await relog(page, user);
    console.log(`stage ${stage ?? '(unset)'}${bits !== undefined ? ` bits ${bits}` : ''} — relogged`);

    // Seed only what a stage *produces*, never its tools: a spade handed to every
    // stage test hides a quest that cannot dig.
    for (const pair of give.split(',').map(s => s.trim()).filter(Boolean)) {
        const [obj, n] = pair.split(':');
        if (!(await cheatQuiet(page, `give ${obj} ${Number(n) || 1}`))) {
            fail(`could not give ${pair}`);
        }
        console.log(`gave ${pair}`);
    }
    // Coins and bones are the only things this quest cannot buy on Karamja, and
    // `::give` is the engine's only seeding cheat — it reaches the inventory, not
    // the bank, so the withdraw path stays a unit-test concern.
    const carried = purse || (which === 'shilo' ? 'coins:20000,bones:3' : 'coins:20000');
    for (const pair of carried.split(',').map(s => s.trim()).filter(Boolean)) {
        const [obj, n] = pair.split(':');
        if (!(await cheatQuiet(page, `give ${obj} ${Number(n) || 1}`))) {
            fail(`could not give ${pair}`);
        }
        console.log(`carrying ${pair}`);
    }

    // `~maxme` grants stats, never gear, and Nazastarool has three forms totalling
    // 220 hitpoints. A maxed account fighting bare-handed is not the account the
    // issue means, so the test dresses one.
    if (gear) {
        const held = (n: string): Promise<number> =>
            page.evaluate(x => (globalThis as never as { __rs2b0t: { Inventory: { count(n: string): number } } }).__rs2b0t.Inventory.count(x), n);
        for (const [obj, item] of GEAR) {
            let ok = false;
            for (let i = 0; i < 5 && !ok; i++) {
                await cheatQuiet(page, `give ${obj} 1`);
                ok = (await held(item)) > 0;
            }
            if (!ok) {
                fail(`could not seed ${item}`);
            }
            // Equipment.equip() awaits Execution.delayUntil, which needs a running
            // script context and throws from page.evaluate. The direct driver's
            // held-op is synchronous, so drive the Wield/Wear op itself.
            await page.evaluate(x => {
                const inv = (globalThis as never as {
                    __rs2b0t: { Inventory: { first(n: string): { actions(): string[]; interact(a: string): unknown } | null } };
                }).__rs2b0t.Inventory;
                const entry = inv.first(x);
                const op = entry?.actions().find(o => /wield|wear|equip/i.test(o));
                if (entry && op) {
                    entry.interact(op);
                }
            }, item);
            await page.waitForTimeout(700);
        }
        console.log(`geared: ${GEAR.map(g => g[1]).join(', ')}`);
    }

    if (tele) {
        if (!(await cheatQuiet(page, `tele ${tele}`))) {
            fail(`could not tele to ${tele}`);
        }
        // A teleport leaves the scene un-rebuilt for a moment; the walker mispaths
        // until it settles.
        await page.waitForTimeout(2500);
        console.log(`teleported to ${tele}`);
    }

    await page.evaluate(id => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', id), which === 'shilo' ? 'zombiequeen' : 'junglepotion');
    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', 'Bread'));
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester on ${quest.name} — watching`);

    const deadline = Date.now() + minutes * 60_000;
    let lastLogTime = 0;
    let last: SoloSnapshot | null = null;
    while (Date.now() < deadline) {
        last = await page.evaluate((questName): SoloSnapshot => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: { worldTile(): { x: number; z: number; level: number } | null };
                    Quests: { status(n: string): string; points(): number };
                };
                rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
            };
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                status: g.__rs2b0t.Quests.status(questName),
                qp: g.__rs2b0t.Quests.points(),
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-60)
            };
        }, quest.name);
        const t = Math.round((Date.now() - t0) / 1000);
        const pos = last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?';
        console.log(`  t=${t}s pos=${pos} status=${last.status} qp=${last.qp} runner=${last.runner}`);
        for (const line of last.logs) {
            if (line.time > lastLogTime) {
                console.log(`      · [${line.level}] ${line.msg}`);
            }
        }
        if (last.logs.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time));
        }
        if (last.status === 'complete' || last.runner !== 'running') {
            break;
        }
        await page.waitForTimeout(10_000);
    }

    if (!last) {
        fail('no snapshot');
    }
    console.log(`END status=${last.status} qp=${last.qp} runner=${last.runner}`);
} finally {
    await browser.close();
}
