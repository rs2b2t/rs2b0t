/** GreenDragon PK-threat behaviour, two accounts: a bystander idling 3 tiles away must not scatter the bot, and the same account attacking must produce `escaping (under attack)`.
 *  Why: phase 2 runs at empty low wilderness — the zone is single-way, so while any npc is on the bot the engine refuses the PvP attack outright ("Someone else is already fighting your opponent."). */

//   HEADED=1 bun e2e/greendragon-pk-flee-test.ts
import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, setSettings } from './lib/harness.js';

const base = process.env.BASE ?? 'http://localhost:8888';
const stamp = Date.now().toString(36).slice(-6);
const BOT_USER = process.env.BOT_NAME || `pkb${stamp}`;
const FOE_USER = process.env.FOE_NAME || `pkf${stamp}`;

const DRAGON_FIELD = { x: 3096, z: 3814 };
/** North of the Edgeville ditch.
 *  Why: 3096,3560 looks quiet but has monsters the bot kills, and single-way combat refuses the PvP attack while an NPC is on it, so the flee can never arm there. */
const LOW_WILDY = { x: 3100, z: 3525 };
const SCIMITAR = 1333;
const SHIELD = 1540;
const TUNA = 361;

const SCRATCH_SLOT = 499;
const OP_PLAYER2 = 499;

const BYSTANDER_MS = Number(process.env.BYSTANDER_S ?? 45) * 1000;
const ATTACK_MS = Number(process.env.ATTACK_S ?? 90) * 1000;

interface Api {
    __rs2b0t: {
        Inventory: { items(): { id: number; interact(op: string): boolean | Promise<boolean> }[]; count(n: string): number };
        Equipment: { contains(n: string): boolean };
        reader: { worldTile(): { x: number; z: number; level: number } | null; inventory(): { id: number; name: string | null }[] };
    };
    rs2b0t: {
        client: Record<string, never>;
        registry: { get(n: string): unknown };
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
    };
}

const logLines = (page: Page): Promise<string[]> =>
    page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

const tile = (page: Page): Promise<{ x: number; z: number; level: number } | null> =>
    page.evaluate(() => (globalThis as never as Api).__rs2b0t.reader.worldTile());

function teleCmd(at: { x: number; z: number }): string {
    return `tele 0,${at.x >> 6},${at.z >> 6},${at.x & 63},${at.z & 63}`;
}

/** ::tele drops a single send often enough that one shot is not reliable. */
async function teleArrive(page: Page, at: { x: number; z: number }, maxDist = 6): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
        await cheatQuiet(page, teleCmd(at), 2500);
        for (let poll = 0; poll < 10; poll++) {
            const t = await tile(page);
            if (t && Math.max(Math.abs(t.x - at.x), Math.abs(t.z - at.z)) <= maxDist) {
                await page.waitForTimeout(700);
                return true;
            }
            await page.waitForTimeout(400);
        }
    }
    return false;
}

async function prepare(page: Page, user: string, at: { x: number; z: number }): Promise<void> {
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) {
        fail(`login failed for ${user}`);
    }
    await bringUpOffIsland(page, { user });
    for (const stat of ['attack', 'strength', 'defence', 'hitpoints']) {
        await cheatQuiet(page, `setstat ${stat} 99`, 800);
    }
    if (!(await teleArrive(page, at))) {
        fail(`${user}: tele to ${at.x},${at.z} never landed`);
    }
    console.log(`${user}: ingame at ${JSON.stringify(await tile(page))}`);
}

async function give(page: Page, debugName: string, id: number, count: number): Promise<void> {
    await cheatQuiet(page, `give ${debugName} ${count}`, 1200);
    const ok = await page
        .waitForFunction(i => (globalThis as never as Api).__rs2b0t.reader.inventory().some(it => it.id === i), id, { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
    if (!ok) {
        fail(`::give ${debugName} did not land`);
    }
}

async function equip(page: Page, id: number, op: string, wornName: string): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
        if (await page.evaluate(n => (globalThis as never as Api).__rs2b0t.Equipment.contains(n), wornName)) {
            return;
        }
        await page.evaluate(
            ([itemId, action]) => {
                const item = (globalThis as never as Api).__rs2b0t.Inventory.items().find(i => i.id === itemId);
                return item ? Boolean(item.interact(action)) : false;
            },
            [id, op] as const
        );
        const on = await page
            .waitForFunction(n => (globalThis as never as Api).__rs2b0t.Equipment.contains(n), wornName, { timeout: 6000 })
            .then(() => true)
            .catch(() => false);
        if (on) {
            return;
        }
    }
    fail(`could not equip '${wornName}'`);
}

async function startBot(page: Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('GreenDragon');
        if (!meta) {
            throw new Error('GreenDragon is not registered — redeploy the bot client');
        }
        g.rs2b0t.runner.start(meta);
    });
}

async function stopBot(page: Page): Promise<void> {
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));
    await page.waitForTimeout(1500);
}

/** OP_PLAYER2 = "Attack", granted on entering the wilderness. */
async function attackPlayer(page: Page, targetName: string): Promise<boolean> {
    return page.evaluate(
        ([name, slot, op]) => {
            const c = (globalThis as never as Api).rs2b0t.client as never as Record<string, never>;
            const norm = (s: string | null): string => (s ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
            let idx = -1;
            for (let i = 0; i < (c.playerCount as never as number); i++) {
                const id = (c.playerIds as never as number[])[i];
                const p = (c.players as never as Record<string, never>[])[id];
                if (p && norm(p.name as never as string) === norm(name as string)) {
                    idx = id;
                    break;
                }
            }
            if (idx < 0) {
                return false;
            }
            (c.menuAction as never as number[])[slot as number] = op as number;
            (c.menuParamA as never as number[])[slot as number] = idx;
            (c.menuParamB as never as number[])[slot as number] = 0;
            (c.menuParamC as never as number[])[slot as number] = 0;
            (c.doAction as never as (n: number) => void).call(c, slot as number);
            return true;
        },
        [targetName, SCRATCH_SLOT, OP_PLAYER2] as const
    );
}

const UNDER_ATTACK = /escaping \(under attack\)/;

console.log(`greendragon-pk-flee base=${base} bot=${BOT_USER} foe=${FOE_USER}`);
const browser = await launchBrowser({ swiftshader: true });

try {
    const bot = await (await browser.newContext()).newPage();
    const foe = await (await browser.newContext()).newPage();

    await prepare(bot, BOT_USER, DRAGON_FIELD);
    await setSettings(bot, 'GreenDragon', {
        solveClues: false,
        logDetail: 'Verbose',
        food: 'Tuna',
        foodReserve: 4,
        anchorTile: `${DRAGON_FIELD.x},${DRAGON_FIELD.z},0`
    });
    await give(bot, 'rune_scimitar', SCIMITAR, 1);
    await give(bot, 'antidragonbreathshield', SHIELD, 1);
    await give(bot, 'tuna', TUNA, 20);
    await equip(bot, SCIMITAR, 'Wield', 'Rune scimitar');
    await equip(bot, SHIELD, 'Wear', 'Dragonfire shield');

    // The foe idles in the dragon field for phase 1 and gets mauled without this;
    // a dead foe respawns in Lumbridge and can never land phase 2's attack.
    await prepare(foe, FOE_USER, DRAGON_FIELD);
    await give(foe, 'antidragonbreathshield', SHIELD, 1);
    await equip(foe, SHIELD, 'Wear', 'Dragonfire shield');

    // --- 1: bystander must not scare the bot -------------------------------
    await startBot(bot);
    console.log(`GreenDragon started; ${FOE_USER} idling nearby for ${BYSTANDER_MS / 1000}s`);
    await bot.waitForTimeout(BYSTANDER_MS);

    const idleLog = await logLines(bot);
    const fledFromBystander = idleLog.filter(l => UNDER_ATTACK.test(l));
    if (fledFromBystander.length > 0) {
        console.log(idleLog.slice(-20).map(l => `  ${l}`).join('\n'));
        fail(`the bot fled from a bystander: ${JSON.stringify(fledFromBystander)}`);
    }
    if (idleLog.length === 0) {
        fail('the bot logged nothing at all — it never got going');
    }
    console.log(`PASS 1/2 — no flee with a player idling nearby (${idleLog.length} log lines)`);
    console.log(idleLog.slice(-6).map(l => `  ${l}`).join('\n'));

    // --- 2: an actual attack must make it flee ------------------------------
    await stopBot(bot);
    await setSettings(bot, 'GreenDragon', {
        solveClues: false,
        logDetail: 'Verbose',
        food: 'Tuna',
        foodReserve: 4,
        anchorTile: `${LOW_WILDY.x},${LOW_WILDY.z},0`
    });
    // Why: ~maxme pushes the bot's combat level far above the foe's and low wilderness refuses attacks across a level gap ("Your level difference is too great!"); re-setting hp heals without it.
    await cheatQuiet(bot, 'setstat hitpoints 99', 1200);
    if (!(await teleArrive(bot, LOW_WILDY))) {
        fail('bot never reached the low wilderness tile');
    }
    await cheatQuiet(foe, 'setstat hitpoints 99', 1200);
    if (!(await teleArrive(foe, LOW_WILDY))) {
        fail('foe never reached the low wilderness tile');
    }
    const foeAt = await tile(foe);
    if (!foeAt || foeAt.z <= 3520) {
        fail(`foe is not in the wilderness (${JSON.stringify(foeAt)}) — it cannot attack`);
    }
    await startBot(bot);
    console.log(`restarted at the quiet tile; ${FOE_USER} attacking for up to ${ATTACK_MS / 1000}s`);

    const deadline = Date.now() + ATTACK_MS;
    let fled = false;
    let sent = 0;
    while (Date.now() < deadline && !fled) {
        const at = await tile(foe);
        if (!at || at.z <= 3520) {
            // Died and respawned in Lumbridge — heal and put it back, or the rest
            // of the loop sends attacks that can never land.
            await cheatQuiet(foe, 'setstat hitpoints 99', 1000);
            await cheatQuiet(foe, teleCmd(LOW_WILDY), 3000);
            continue;
        }
        if (await attackPlayer(foe, BOT_USER)) {
            sent++;
        }
        await foe.waitForTimeout(1200);
        fled = (await logLines(bot)).some(l => UNDER_ATTACK.test(l));
    }

    const finalLog = await logLines(bot);
    if (!fled) {
        console.log(finalLog.slice(-25).map(l => `  ${l}`).join('\n'));
        // The engine mes()es why it refused, so print it rather than guess.
        const chat = await foe.evaluate(() =>
            (globalThis as never as { __rs2b0t: { reader: { chat(n: number): { text: string }[] } } }).__rs2b0t.reader
                .chat(12)
                .map(l => l.text)
                .filter(t => t.length > 0)
        );
        console.log(`  attacker chat: ${JSON.stringify(chat.slice(0, 8))}`);
        fail(`the bot never logged "escaping (under attack)" after ${sent} attacks`);
    }
    console.log(`PASS 2/2 — fled when actually attacked (after ${sent} attack sends)`);
    console.log(finalLog.filter(l => UNDER_ATTACK.test(l)).map(l => `  ${l}`).join('\n'));

    console.log('\nALL PASS');
} finally {
    await browser.close();
}
