// Live GreenDragon proof: [base]. Case 1 — a hard clue on the ground with a pack full of lobsters: spend food for the slot, take the clue by obj id, hand to SolveClue, leave the wilderness, open a bank.
// Case 2 — clues off and teleported off the field: the bot walks itself back. Proven on a short hop rather than a full trail, which is slow and flakes on the known nav-island destinations.

//   bun e2e/greendragon-test.ts [http://localhost:8888]
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, positionalArgs, setSettings } from './lib/harness.js';
import type { Page } from 'playwright-core';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];

const ANCHOR = { x: 3096, z: 3814 };
/** Quiet low wilderness for the slot-freeing case.
 *  Why: in the dragon field, damage lets the hp-driven Eat task (which outranks FreeSlot) free the slot incidentally, so FreeSlot never decides and the assertion flakes. */
const QUIET_FIELD = { x: 3096, z: 3560 };
const WILDY_MIN_Z = 3520;
const FIELD_RADIUS = 22;

const LOBSTER = 379;
// bank_f2p maxes out lobster/swordfish, and a max-int bank stack REFUSES further
// deposits — so the trail-prep case seeds a food that cheat does not stock.
const TUNA = 361;
const SCIMITAR = 1333;
const SHIELD = 1540;
const SPADE = 952;
const HARD_CLUE = 2723; // trail_clue_hard_sextant001
const DRAGON_BONES = 536;
/** Mirrors TRAIL_FOOD_CAP in src/bot/api/ai/clues/packPlan.ts. */
const TRAIL_FOOD_CAP = 10;

interface Api {
    __rs2b0t: {
        Inventory: {
            items(): { id: number; name: string | null; count: number; interact(op: string): boolean | Promise<boolean> }[];
            count(name: string): number;
            used(): number;
            free(): number;
            isFull(): boolean;
        };
        Equipment: { contains(name: string): boolean };
        Skills: { level(name: string): number; effective(name: string): number; xp(name: string): number };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            groundItems(): { id: number; name: string | null }[];
            inventory(): { id: number; name: string | null; count: number }[];
        };
    };
    rs2b0t: {
        client: { ingame: boolean };
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
        reader: { chat(count: number): { text: string }[] };
    };
}

const tile = (page: Page) => page.evaluate(() => (globalThis as never as Api).__rs2b0t.reader.worldTile());
const invIds = (page: Page) => page.evaluate(() => (globalThis as never as Api).__rs2b0t.reader.inventory().map(i => i.id));
const logLines = (page: Page) => page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

async function dump(page: Page, label: string, tailCount = 20): Promise<void> {
    const lines = await logLines(page);
    const state = await page
        .evaluate(() => {
            const g = (globalThis as never as Api).__rs2b0t;
            const t = g.reader.worldTile();
            return {
                at: t ? `${t.x},${t.z},${t.level}` : 'none',
                hp: `${g.Skills.effective('hitpoints')}/${g.Skills.level('hitpoints')}`,
                pack: `${g.Inventory.used()}/28`,
                lobsters: g.Inventory.count('Lobster'),
                shield: g.Equipment.contains('Dragonfire shield'),
                clue: g.reader.inventory().some(i => i.id === 2723),
                ground: g.reader.groundItems().length,
                runner: (globalThis as never as Api).rs2b0t.runner.state,
                ingame: (globalThis as never as Api).rs2b0t.client.ingame
            };
        })
        .catch(() => null);
    console.log(`--- ${label} --- ${state ? JSON.stringify(state) : 'state unavailable'}`);
    console.log(`  (log has ${lines.length} lines)`);
    for (const l of lines.slice(-tailCount)) {
        console.log(`  ${l}`);
    }
    const chat = await page.evaluate(() => (globalThis as never as Api).rs2b0t.reader.chat(12).map(c => c.text)).catch(() => []);
    for (const c of chat) {
        console.log(`  chat| ${c}`);
    }
}

/** ::give, then confirm the item landed — only some debugnames work. */
async function give(page: Page, debugName: string, id: number, count: number): Promise<void> {
    const before = (await invIds(page)).filter(i => i === id).length;
    await cheatQuiet(page, `give ${debugName} ${count}`, 1200);
    const ok = await page
        .waitForFunction(
            ([itemId, want]) => (globalThis as never as Api).__rs2b0t.reader.inventory().filter(i => i.id === itemId).length >= want,
            [id, before + count] as const,
            { timeout: 5000 }
        )
        .then(() => true)
        .catch(() => false);
    if (!ok) {
        const inv = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.reader.inventory().map(i => `${i.name}#${i.id}x${i.count}`));
        fail(`::give ${debugName} x${count} did not land; inventory=${JSON.stringify(inv)}`);
    }
}

/** The direct input driver works outside a script run, so gear/drops need no bot. */
async function itemOp(page: Page, id: number, op: string): Promise<void> {
    const present = await page
        .waitForFunction(itemId => (globalThis as never as Api).__rs2b0t.Inventory.items().some(i => i.id === itemId), id, { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
    if (!present) {
        const seen = await page.evaluate(() => {
            const g = (globalThis as never as Api).__rs2b0t;
            return {
                api: g.Inventory.items().map(i => `${i.name}#${i.id}`),
                reader: g.reader.inventory().map(i => `${i.name}#${i.id}`),
                worn: ['Rune scimitar', 'Dragonfire shield'].filter(n => g.Equipment.contains(n))
            };
        });
        fail(`item #${id} never showed up in the pack to '${op}'; ${JSON.stringify(seen)}`);
    }
    const sent = await page.evaluate(
        ([itemId, action]) => {
            const item = (globalThis as never as Api).__rs2b0t.Inventory.items().find(i => i.id === itemId);
            return item ? Boolean(item.interact(action)) : false;
        },
        [id, op] as const
    );
    if (!sent) {
        fail(`could not send '${op}' to item #${id}`);
    }
    await page.waitForTimeout(1200);
}


/** Wield/Wear and CONFIRM it landed — a single send flakes under engine load. */
async function equip(page: Page, id: number, op: string, wornName: string): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
        if (await page.evaluate(n => (globalThis as never as Api).__rs2b0t.Equipment.contains(n), wornName)) {
            return;
        }
        await itemOp(page, id, op);
        const on = await page
            .waitForFunction(n => (globalThis as never as Api).__rs2b0t.Equipment.contains(n), wornName, { timeout: 6000 })
            .then(() => true)
            .catch(() => false);
        if (on) {
            return;
        }
    }
    fail(`could not equip '${wornName}' (#${id}) after 4 attempts`);
}

async function startBot(page: Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('GreenDragon');
        if (!meta) {
            throw new Error('GreenDragon is not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
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
    await cheatQuiet(page, `tele 0,${at.x >> 6},${at.z >> 6},${at.x & 63},${at.z & 63}`, 3500);
    const landed = await tile(page);
    if (!landed || Math.max(Math.abs(landed.x - at.x), Math.abs(landed.z - at.z)) > 4) {
        fail(`tele to ${at.x},${at.z} landed at ${landed ? `${landed.x},${landed.z}` : 'nowhere'}`);
    }
    console.log(`${user}: ingame at (${landed.x},${landed.z})`);
}

async function caseClueHandover(page: Page, user: string): Promise<void> {
    await prepare(page, user, QUIET_FIELD);
    await setSettings(page, 'GreenDragon', {
        solveClues: true,
        logDetail: 'Verbose',
        foodReserve: 4,
        food: 'Tuna',
        anchorTile: `${QUIET_FIELD.x},${QUIET_FIELD.z},0`
    });

    await give(page, 'rune_scimitar', SCIMITAR, 1);
    await give(page, 'antidragonbreathshield', SHIELD, 1);
    await give(page, 'spade', SPADE, 1);
    await equip(page, SCIMITAR, 'Wield', 'Rune scimitar');
    await equip(page, SHIELD, 'Wear', 'Dragonfire shield');

    // Clue onto the ground, then fill every remaining slot with lobsters.
    await give(page, 'trail_clue_hard_sextant001', HARD_CLUE, 1);
    await itemOp(page, HARD_CLUE, 'Drop');
    const onGround = await page
        .waitForFunction(id => (globalThis as never as Api).__rs2b0t.reader.groundItems().some(g => g.id === id), HARD_CLUE, { timeout: 8000 })
        .then(() => true)
        .catch(() => false);
    if (!onGround) {
        fail('the hard clue never appeared on the ground');
    }
    await give(page, 'tuna', TUNA, 27);
    // A stocked bank is what makes the trail-prep assertion meaningful: with an
    // empty one there is nothing for the prep to withdraw and no rune to starve.
    await cheatQuiet(page, '~bank_f2p', 2500);
    console.log(`after ~bank_f2p, chat: ${JSON.stringify(await page.evaluate(() => (globalThis as never as Api).rs2b0t.reader.chat(4).map(c => c.text)))}`);

    const setup = await page.evaluate(() => {
        const inv = (globalThis as never as Api).__rs2b0t;
        return { used: inv.Inventory.used(), full: inv.Inventory.isFull(), lobsters: inv.Inventory.count('Tuna') };
    });
    if (!setup.full) {
        fail(`expected a full pack before starting, got ${setup.used}/28 (${setup.lobsters} tuna)`);
    }
    if ((await invIds(page)).includes(HARD_CLUE)) {
        fail('the clue is still in the pack — it must start on the ground');
    }
    console.log(`seeded: pack FULL (${setup.lobsters} tuna), hard clue #${HARD_CLUE} on the ground`);

    await startBot(page);
    console.log('GreenDragon started (clues on)');

    // 1. spends food for the slot instead of walking to the bank
    const freed = await page
        .waitForFunction(
            () => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).some(l => l.msg.includes('to make room for')),
            undefined,
            { timeout: 120_000 }
        )
        .then(() => true)
        .catch(() => false);
    if (!freed) {
        await dump(page, 'slot-freeing never decided');
        fail('never freed a pack slot for loot — it banked instead (the bug under test)');
    }
    // The decision logs before the eat/drop lands, so wait for the effect.
    const spent = await page
        .waitForFunction(() => (globalThis as never as Api).__rs2b0t.Inventory.count('Tuna') < 27, undefined, { timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
    await dump(page, 'after the slot-freeing leg');
    if (!spent) {
        fail('decided to free a slot but no food was ever actually spent');
    }
    const stillInField = await tile(page);
    if (!stillInField || stillInField.z < WILDY_MIN_Z) {
        fail(`left the wilderness to make pack room at ${JSON.stringify(stillInField)} — should have eaten or dropped on the spot`);
    }
    const afterFree = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.count('Tuna'));
    console.log(`PASS 1/4 — freed a slot in the field (tuna 27 -> ${afterFree}, still at z=${stillInField.z})`);

    // 2. takes the clue off the ground, matched by obj id
    const took = await page
        .waitForFunction(id => (globalThis as never as Api).__rs2b0t.reader.inventory().some(i => i.id === id), HARD_CLUE, { timeout: 120_000 })
        .then(() => true)
        .catch(() => false);
    await dump(page, 'after the clue pickup leg');
    if (!took) {
        fail('never picked the hard clue up off the ground');
    }
    console.log('PASS 2/4 — picked the hard clue up by obj id');

    // 3. hands control to SolveClue and walks out of the wilderness
    const leftWildy = await page
        .waitForFunction(minZ => {
            const t = (globalThis as never as Api).__rs2b0t.reader.worldTile();
            return t !== null && t.z < minZ;
        }, WILDY_MIN_Z, { timeout: 600_000 })
        .then(() => true)
        .catch(() => false);
    await dump(page, 'after the hand-over leg', 30);
    if (!leftWildy) {
        fail('never left the wilderness with the clue — Escape most likely dragged it back to the field');
    }
    console.log(`PASS 3/4 — handed over to SolveClue and left the wilderness (at ${JSON.stringify(await tile(page))})`);

    // 4. the trail pack is viable: runes aboard, food trimmed to trail size, and no duplicate of the weapon already worn
    const prepped = await page
        .waitForFunction(
            () => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).some(l => l.msg.includes('[clue] trail pack:')),
            undefined,
            { timeout: 300_000 }
        )
        .then(() => true)
        .catch(() => false);
    await dump(page, 'after the trail-prep leg', 30);
    if (!prepped) {
        fail('SolveClue never finished prepping the trail pack');
    }
    const pack = await page.evaluate(() => {
        const g = (globalThis as never as Api).__rs2b0t;
        return {
            food: g.Inventory.count('Tuna'),
            runes: ['Air rune', 'Earth rune', 'Fire rune', 'Law rune', 'Water rune'].filter(n => g.Inventory.count(n) > 0),
            weaponInPack: g.Inventory.count('Rune scimitar'),
            weaponWorn: g.Equipment.contains('Rune scimitar'),
            free: g.Inventory.free()
        };
    });
    console.log(`trail pack: ${JSON.stringify(pack)}`);
    if (pack.runes.length < 5) {
        fail(`only ${pack.runes.length}/5 teleport runes aboard (${pack.runes.join(', ') || 'none'}) — food crowded them out`);
    }
    if (pack.food > TRAIL_FOOD_CAP) {
        fail(`carried ${pack.food} Tuna on a trail — should be trimmed to ${TRAIL_FOOD_CAP}`);
    }
    if (pack.weaponWorn && pack.weaponInPack > 0) {
        fail(`withdrew ${pack.weaponInPack} spare Rune scimitar while already wearing one`);
    }
    console.log(`PASS 4/4 — viable trail pack (${pack.runes.length}/5 runes, ${pack.food} food, no spare weapon)`);
}

async function caseRegainControl(page: Page, user: string): Promise<void> {
    await prepare(page, user, ANCHOR);
    await setSettings(page, 'GreenDragon', { solveClues: false, logDetail: 'Verbose' });

    // Gear first, bulk food after — fewer inventory updates in flight between
    // the two equips, which is where a stale snapshot loses the shield.
    await give(page, 'rune_scimitar', SCIMITAR, 1);
    await give(page, 'antidragonbreathshield', SHIELD, 1);
    await equip(page, SCIMITAR, 'Wield', 'Rune scimitar');
    await equip(page, SHIELD, 'Wear', 'Dragonfire shield');
    await give(page, 'lobster', LOBSTER, 14);

    // Strand it off the field BEFORE starting: teleporting a running bot races
    // its in-flight walk and it drifts before the assertion can read a position.
    const away = { x: ANCHOR.x, z: 3745 };
    await cheatQuiet(page, `tele 0,${away.x >> 6},${away.z >> 6},${away.x & 63},${away.z & 63}`, 4000);
    const at = await tile(page);
    if (!at || Math.max(Math.abs(at.x - away.x), Math.abs(at.z - away.z)) > 4) {
        fail(`tele away from the field landed at ${JSON.stringify(at)}`);
    }
    const offBy = Math.max(Math.abs(at.x - ANCHOR.x), Math.abs(at.z - ANCHOR.z));
    if (offBy <= FIELD_RADIUS + 6) {
        fail(`stranded only ${offBy} tiles from the anchor — inside the return threshold, the test would prove nothing`);
    }
    console.log(`stranded ${offBy} tiles off the field at (${at.x},${at.z})`);

    await startBot(page);
    console.log('GreenDragon started (clues off), off the field');

    const returned = await page
        .waitForFunction(
            ([ax, az, radius]) => {
                const t = (globalThis as never as Api).__rs2b0t.reader.worldTile();
                return t !== null && Math.max(Math.abs(t.x - ax), Math.abs(t.z - az)) <= radius;
            },
            [ANCHOR.x, ANCHOR.z, FIELD_RADIUS + 6] as const,
            { timeout: 420_000 }
        )
        .then(() => true)
        .catch(() => false);
    await dump(page, 'after the return leg', 25);
    if (!returned) {
        fail('never walked back to the dragon field — nothing regains control after a detour');
    }
    console.log(`PASS — walked itself back to the field (at ${JSON.stringify(await tile(page))})`);
}

async function caseBuryBones(page: Page, user: string): Promise<void> {
    await prepare(page, user, QUIET_FIELD);
    // Bones deliberately left OUT of the loot list: burying must force them to
    // be looted and buried anyway.
    await setSettings(page, 'GreenDragon', {
        solveClues: false,
        buryBones: true,
        logDetail: 'Verbose',
        loot: 'Dragonhide',
        anchorTile: `${QUIET_FIELD.x},${QUIET_FIELD.z},0`
    });

    await give(page, 'rune_scimitar', SCIMITAR, 1);
    await give(page, 'antidragonbreathshield', SHIELD, 1);
    await give(page, 'lobster', LOBSTER, 5);
    await equip(page, SCIMITAR, 'Wield', 'Rune scimitar');
    await equip(page, SHIELD, 'Wear', 'Dragonfire shield');

    // One bone in the pack, one on the ground — proves burying AND the forced pickup.
    await give(page, 'dragon_bones', DRAGON_BONES, 2);
    await itemOp(page, DRAGON_BONES, 'Drop');
    const dropped = await page
        .waitForFunction(id => (globalThis as never as Api).__rs2b0t.reader.groundItems().some(g => g.id === id), DRAGON_BONES, { timeout: 8000 })
        .then(() => true)
        .catch(() => false);
    if (!dropped) {
        fail('could not put a set of Dragon bones on the ground');
    }
    const prayerBefore = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('prayer'));
    console.log(`seeded: 1 Dragon bones held + 1 on the ground, prayer xp ${prayerBefore}, bones NOT in the loot list`);

    await startBot(page);
    console.log('GreenDragon started (bury on)');

    // 1. buries what it is holding — Prayer xp is the proof, not the slot count
    const gainedXp = await page
        .waitForFunction(before => (globalThis as never as Api).__rs2b0t.Skills.xp('prayer') > before, prayerBefore, { timeout: 120_000 })
        .then(() => true)
        .catch(() => false);
    await dump(page, 'after the burial leg');
    if (!gainedXp) {
        fail('never buried the Dragon bones it was holding — no Prayer xp gained');
    }
    console.log(`PASS 1/2 — buried held bones (prayer xp ${prayerBefore} -> ${await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('prayer'))})`);

    // 2. picks the ground set up despite bones being absent from the loot list
    const clearedGround = await page
        .waitForFunction(id => !(globalThis as never as Api).__rs2b0t.reader.groundItems().some(g => g.id === id), DRAGON_BONES, { timeout: 120_000 })
        .then(() => true)
        .catch(() => false);
    await dump(page, 'after the forced-pickup leg');
    if (!clearedGround) {
        fail('left the Dragon bones on the ground — burying must force them into the loot filter');
    }
    console.log('PASS 2/2 — looted bones that were not in the loot list, because burying is on');
}


async function caseDepositControl(page: Page, user: string): Promise<void> {
    await prepare(page, user, { x: 3094, z: 3493 });
    await setSettings(page, 'GreenDragon', { solveClues: false, logDetail: 'Verbose', bankTile: '3094,3493,0', anchorTile: '3094,3493,0' });
    await give(page, 'dragon_bones', DRAGON_BONES, 27);
    const before = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.used());
    console.log(`control: pack ${before}/28 of non-keep junk at the Edgeville bank`);
    await startBot(page);
    const shrank = await page
        .waitForFunction(b => (globalThis as never as Api).__rs2b0t.Inventory.used() < b, before, { timeout: 120_000 })
        .then(() => true).catch(() => false);
    await dump(page, 'deposit control', 25);
    if (!shrank) {
        fail('CONTROL: GreenDragon own bank run also deposited nothing -> Bank.depositAllMatching is broken generally');
    }
    console.log('CONTROL PASS — depositAllMatching does work for the ordinary bank run');
}


/** Fleeing must bank, restock, heal and go back to work.
 *  Why: low hp and no food stay true after arriving, so Escape re-walks a zero-tile path and logs forever while BankRun sits below it. */
async function caseFleeAndRecover(page: Page, user: string): Promise<void> {
    await prepare(page, user, ANCHOR);
    await setSettings(page, 'GreenDragon', { solveClues: false, logDetail: 'Verbose', foodWithdraw: 10 });
    await give(page, 'rune_scimitar', SCIMITAR, 1);
    await give(page, 'antidragonbreathshield', SHIELD, 1);
    await equip(page, SCIMITAR, 'Wield', 'Rune scimitar');
    await equip(page, SHIELD, 'Wear', 'Dragonfire shield');
    await cheatQuiet(page, '~bank_f2p', 2500);

    // No food at all, and one hit point: the exact panic state from the report.
    await cheatQuiet(page, '~1hp', 1500);
    const start = await page.evaluate(() => {
        const g = (globalThis as never as Api).__rs2b0t;
        return { hp: g.Skills.effective('hitpoints'), food: g.Inventory.count('Lobster') };
    });
    if (start.hp > 5 || start.food > 0) {
        fail(`expected 1hp and no food, got hp=${start.hp} food=${start.food}`);
    }
    console.log(`stranded in the field at ${start.hp}hp with no food`);

    await startBot(page);
    console.log('GreenDragon started (panic state)');

    const recovered = await page
        .waitForFunction(
            () => {
                const g = (globalThis as never as Api).__rs2b0t;
                return g.Inventory.count('Lobster') > 0 && g.Skills.effective('hitpoints') >= g.Skills.level('hitpoints');
            },
            undefined,
            { timeout: 420_000 }
        )
        .then(() => true)
        .catch(() => false);
    await dump(page, 'after the flee-and-recover leg', 30);
    if (!recovered) {
        fail('never restocked food and healed at the bank — the flee wedged');
    }
    const heal = await page.evaluate(() => {
        const g = (globalThis as never as Api).__rs2b0t;
        return { hp: g.Skills.effective('hitpoints'), food: g.Inventory.count('Lobster') };
    });
    console.log(`PASS 1/2 — banked, withdrew ${heal.food} Lobster and healed to ${heal.hp}hp`);
    // Why: hp reaches full mid-loop a beat before the line that reports it, so the heal is waited for rather than sampled — and it must come from the bank run, not the Eat task after the walk home began at panic hp.
    const healedAtBank = await page
        .waitForFunction(
            () => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).some(l => /healed to (9[0-9]|100)% hp/.test(l.msg)),
            undefined,
            { timeout: 30_000 }
        )
        .then(() => true)
        .catch(() => false);
    if (!healedAtBank) {
        fail('bank run did not eat back to full before leaving — it walked home on panic hp');
    }

    const backToWork = await page
        .waitForFunction(
            ([ax, az, radius]) => {
                const t = (globalThis as never as Api).__rs2b0t.reader.worldTile();
                return t !== null && Math.max(Math.abs(t.x - ax), Math.abs(t.z - az)) <= radius;
            },
            [ANCHOR.x, ANCHOR.z, FIELD_RADIUS + 6] as const,
            { timeout: 420_000 }
        )
        .then(() => true)
        .catch(() => false);
    await dump(page, 'after the return-to-work leg', 20);
    if (!backToWork) {
        fail('recovered at the bank but never went back to the dragons');
    }
    console.log('PASS 2/2 — walked back to the field and resumed');
}

const browser = await launchBrowser();
const stamp = Date.now().toString(36).slice(-5);
let failed = false;
// GD_CASE=clue|regain|bury runs a single case while iterating.
const only = process.env.GD_CASE ?? '';
for (const [name, tag, run] of ([
    ['clue hand-over', 'c', caseClueHandover],
    ['regain control', 'r', caseRegainControl],
    ['bury bones', 'b', caseBuryBones],
    ['deposit control', 'd', caseDepositControl],
    ['flee recover', 'f', caseFleeAndRecover]
] as const).filter(([n]) => only === '' || n.includes(only))) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const user = `gd${tag}${stamp}`;
    console.log(`\n=== case: ${name} (${user}) ===`);
    try {
        await run(page, user);
        console.log(`=== case: ${name} PASSED ===`);
    } catch (e) {
        failed = true;
        console.log(`=== case: ${name} FAILED — ${e instanceof Error ? e.message : String(e)} ===`);
    } finally {
        await page.evaluate(() => {
            try {
                (globalThis as never as Api).rs2b0t.runner.stop('harness stop');
            } catch {
                // already stopped
            }
        }).catch(() => undefined);
        await page.close();
    }
}
await browser.close();
if (failed) {
    process.exit(1);
}
console.log('\nall GreenDragon cases passed');
