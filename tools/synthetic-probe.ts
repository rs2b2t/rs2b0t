// Slice 6 dev probe: deterministically exercises the synthetic-driver paths
// the chicken soak may not hit —
//   1. right-click row-select: 'Drop' on bones is a non-default minimenu
//      entry (default is Bury), so heldOp(op=5) must open the menu and click
//      the row.
//   2. camera-rotate recovery: attack an npc whose screen box is currently
//      null (off-screen), forcing held-arrow rotation before aiming.
//
// Usage: bun tools/synthetic-probe.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8888';
const username = process.argv[3] ?? `probe${Date.now().toString(36).slice(-7)}`;

const TELE = '::tele 0,50,51,32,34'; // chicken pen

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; sideIcon: number[]; login(u: string, p: string, r: boolean): Promise<void> };
        reader: {
            inventory(): { name: string | null; id: number; slot: number; comId: number; ops: (string | null)[] }[];
            npcs(): { index: number; name: string | null; ops: (string | null)[]; distance: number; tile: { x: number; z: number; level: number } }[];
            locs(): { typecode: number; name: string | null; ops: (string | null)[]; distance: number; tile: { x: number; z: number; level: number } }[];
            npcScreenBox(index: number): unknown;
            locScreenBox(lx: number, lz: number): unknown;
            toLocal(x: number, z: number): { lx: number; lz: number } | null;
            menu(): { open: boolean; entries: { option: string; action: number; c: number }[] };
            mouse(): { x: number; y: number };
            orbitYaw(): number;
            yawTo(tile: { x: number; z: number; level: number }): number;
            chatContinueComId(): number;
            componentRect(comId: number): { x: number; y: number; w: number; h: number } | null;
            modals(): { chat: number };
        };
        vinput: { holdKeyUntil(ch: number, until: () => boolean, maxMs: number): Promise<void>; moveTo(x: number, y: number): Promise<void> };
        router: {
            activeMode: string;
            driver: {
                heldOp(id: number, slot: number, comId: number, op: number): Promise<boolean>;
                interactNpc(index: number, op: number): Promise<boolean>;
                interactLoc(lx: number, lz: number, typecode: number, op: number): Promise<boolean>;
                continueDialog(): Promise<boolean>;
            };
        };
    };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
    const page = await browser.newPage();
    page.on('console', msg => {
        if (msg.text().includes('synthetic')) {
            console.log(`  [console] ${msg.text()}`);
        }
    });

    const login = async () => {
        await page.evaluate(
            ([user, pass]) => {
                const { client } = (globalThis as never as Lcb).lcbuddy;
                client.loginUser = user;
                client.loginPass = pass;
                void client.login(user, pass, false);
            },
            [username, 'test']
        );
        return page
            .waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 12000 })
            .then(() => true)
            .catch(() => false);
    };

    const type = async (text: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(text, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1200);
    };

    const boot = async () => {
        await page.waitForFunction(() => (globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy !== undefined && (globalThis as never as { lcbuddy: { client: { constructor: { loopCycle: number } } } }).lcbuddy.client.constructor.loopCycle > 10, undefined, { timeout: 60000 });
    };

    await page.goto(`${base}/bot.html?inputmode=synthetic`);
    await boot();
    if (!(await login())) fail('first login failed');
    await type(TELE);
    await page.reload();
    await boot();
    let backIn = false;
    for (let attempt = 0; attempt < 8 && !backIn; attempt++) {
        await page.waitForTimeout(5000);
        backIn = await login();
    }
    if (!backIn) fail('re-login failed');
    console.log(`logged in as '${username}' at the pen`);

    // ---- probe 1: row-select (Drop bones via op 5, non-default) ----
    await type('::give bones');
    const bones = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().find(i => i.name === 'Bones') ?? null);
    if (!bones) fail('::give bones did not land');

    const before = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().length);
    const dropped = await page.evaluate(b => (globalThis as never as Lcb).lcbuddy.router.driver.heldOp(b.id, b.slot, b.comId, 5), bones);
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().length);
    console.log(`row-select Drop: dispatched=${dropped} inventory ${before} -> ${after}`);
    if (!dropped || after >= before) fail('row-select Drop did not work');
    console.log('PROBE 1 PASS: right-click row-select');

    // ---- probe 2: camera rotation onto an off-screen target ----
    // The orbit camera centers on the player, so only DISTANT targets can be
    // off-screen. Pick a far tree, spin the camera to face the opposite yaw
    // (held arrow through the real key handling), confirm its screen box is
    // null, then interactLoc — the driver must rotate back to resolve it.
    const tree = await page.evaluate(() => {
        const { reader } = (globalThis as never as Lcb).lcbuddy;
        return (
            reader
                .locs()
                .filter(l => l.ops.some(op => op?.toLowerCase().startsWith('chop')) && l.distance >= 7 && l.distance <= 13)
                .sort((a, b) => b.distance - a.distance)[0] ?? null
        );
    });
    if (!tree) fail('no choppable tree 10-22 tiles out');

    await page.evaluate(async tile => {
        const { reader, vinput } = (globalThis as never as Lcb).lcbuddy;
        const away = (reader.yawTo(tile) + 1024) & 0x7ff;
        const diff = (a: number, b: number): number => Math.abs(((a - b + 3072) & 0x7ff) - 1024);
        await vinput.holdKeyUntil(diff(away, reader.orbitYaw()) > 0 ? 2 : 1, () => diff(away, reader.orbitYaw()) < 50, 8000);
    }, tree.tile);
    await page.waitForTimeout(600);

    const local = await page.evaluate(t => (globalThis as never as Lcb).lcbuddy.reader.toLocal(t.x, t.z), tree.tile);
    if (!local) fail('tree left the scene?');
    const hidden = await page.evaluate(l => (globalThis as never as Lcb).lcbuddy.reader.locScreenBox(l.lx, l.lz) === null, local);
    const yawBefore = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.orbitYaw());
    console.log(`camera turned away from tree at (${tree.tile.x},${tree.tile.z}) d=${tree.distance}; off-screen now: ${hidden} (yaw ${yawBefore})`);

    const op = tree.ops.findIndex(o => o?.toLowerCase().startsWith('chop')) + 1;
    const ok = await page.evaluate(([lx, lz, typecode, opIdx]) => (globalThis as never as Lcb).lcbuddy.router.driver.interactLoc(lx, lz, typecode, opIdx), [local.lx, local.lz, tree.typecode, op]);
    const yawAfter = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.orbitYaw());
    console.log(`chop after turn-away: dispatched=${ok}, yaw ${yawBefore} -> ${yawAfter}`);
    if (!ok) fail('off-screen interact failed (camera rotation did not recover)');
    if (hidden && yawBefore === yawAfter) console.log('warn: target was hidden but yaw never moved');
    console.log(`PROBE 2 ${hidden ? 'PASS: off-screen target resolved via camera rotation' : 'WEAK PASS: target stayed visible (no rotation needed)'}`);

    // ---- probe 3: dialog continue (level-up dialog via ::advancestat) ----
    await type('::advancestat attack 5');
    await page.waitForTimeout(800);

    const dlg = await page.evaluate(() => {
        const { reader } = (globalThis as never as Lcb).lcbuddy;
        const comId = reader.chatContinueComId();
        return { comId, rect: comId === -1 ? null : reader.componentRect(comId), chatModal: reader.modals().chat };
    });
    console.log(`dialog state: ${JSON.stringify(dlg)}`);
    if (dlg.comId === -1) fail('::advancestat did not raise a continue dialog');

    const contOk = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.router.driver.continueDialog());
    await page.waitForTimeout(600);
    const dlgAfter = await page.evaluate(() => {
        const { reader } = (globalThis as never as Lcb).lcbuddy;
        return { comId: reader.chatContinueComId(), mouse: reader.mouse(), menu: reader.menu().entries.map(e => `${e.option}/${e.action}/${e.c}`) };
    });
    console.log(`continue: dispatched=${contOk}, after: ${JSON.stringify(dlgAfter)}`);
    if (!contOk) fail('synthetic dialog continue failed');
    console.log('PROBE 3 PASS: dialog continue');

    // ---- probe 4: repeated dialog continues (comId drift across pages) ----
    // Fire several level-ups and clear every continue page synthetically;
    // this is the soak's stubborn case, made deterministic.
    let continues = 0;
    let fails = 0;
    for (const skill of ['strength', 'defence', 'attack', 'hitpoints']) {
        await type(`::advancestat ${skill} 10`);
        for (let pageNo = 0; pageNo < 6; pageNo++) {
            const has = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.chatContinueComId() !== -1);
            if (!has) break;
            const ok = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.router.driver.continueDialog());
            await page.waitForTimeout(700);
            if (ok) continues++;
            else fails++;
        }
    }
    console.log(`repeated continues: ${continues} ok, ${fails} failed`);
    if (fails > 0) fail(`dialog continue failed ${fails} times under repetition`);
    console.log('PROBE 4 PASS: repeated dialog continue');

    // ---- probe 5: dialog continue with cursor coming from the 3D scene ----
    // Mirrors the soak: a level-up fires right after an attack, so the cursor
    // starts out in the viewport, not already near the chat button.
    let s5ok = 0;
    let s5fail = 0;
    for (let lvl = 11; lvl <= 22; lvl++) {
        await type(`::advancestat attack ${lvl}`);
        const has = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.chatContinueComId() !== -1);
        if (!has) continue;

        // fling the synthetic cursor somewhere in the 3D scene first
        const sx = 80 + Math.floor(Math.random() * 400);
        const sy = 60 + Math.floor(Math.random() * 250);
        await page.evaluate(([x, y]) => (globalThis as never as Lcb).lcbuddy.vinput.moveTo(x, y), [sx, sy]);

        const ok = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.router.driver.continueDialog());
        await page.waitForTimeout(700);
        if (ok) s5ok++;
        else s5fail++;
    }
    // synthetic-fail diagnostics surface via the console listener at the top
    console.log(`scene-origin continues: ${s5ok} ok, ${s5fail} failed`);
    if (s5fail > 0) fail(`dialog continue failed ${s5fail} times from scene-origin cursor`);
    console.log('PROBE 5 PASS: dialog continue from scene-origin cursor');

    console.log('PROBES PASS');
} finally {
    await browser.close();
}
