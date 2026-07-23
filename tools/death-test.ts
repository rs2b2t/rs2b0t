import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const username = process.argv[3] ?? `dth${Date.now().toString(36).slice(-7)}`;
const script = process.argv[4] ?? 'ChickenKiller';

const UNLOCK_TELE = 'tele 0,50,50,20,20';

const TARGETS = {
    ChickenKiller: {
        tele: 'tele 0,50,51,32,34',
        npc: 'Chicken',
        underground: false,
        pauseKill: true,
        resumeRe: /chicken killed|looted bones|buried bones/i,
        deadlineMin: 6
    },
    ChaosDruidKiller: {
        tele: 'tele 0,48,155,38,8',
        npc: 'Chaos druid',
        underground: true,
        pauseKill: false,
        resumeRe: null,
        deadlineMin: 10
    }
} as const;

const target = TARGETS[script as keyof typeof TARGETS];
if (!target) {
    console.error(`FAIL: unknown script '${script}' (expected ${Object.keys(TARGETS).join(' | ')})`);
    process.exit(1);
}

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Rs2b0t = {
    rs2b0t: {
        client: {
            ingame: boolean;
            sceneState: number;
            loginUser: string;
            loginPass: string;
            loginMes1: string;
            loginMes2: string;
            login(u: string, p: string, r: boolean): Promise<void>;
            out: { p1Enc(op: number): void; p1(v: number): void; pjstr(s: string): void } | null;
        };
        runner: { state: string; ctx: { log: { level: string; msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null; npcs(): { name: string | null }[]; inventory(): { name: string | null }[] };
    };
};

const browser = await launchBrowser();

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    const boot = async () => {
        await page.waitForFunction(() => (globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t !== undefined && (globalThis as never as { rs2b0t: { client: { constructor: { loopCycle: number } } } }).rs2b0t.client.constructor.loopCycle > 10, undefined, { timeout: 60000 });
    };

    const login = async () => {
        await page.evaluate(
            ([user, pass]) => {
                const { client } = (globalThis as never as Rs2b0t).rs2b0t;
                client.loginUser = user;
                client.loginPass = pass;
                void client.login(user, pass, false);
            },
            [username, 'test']
        );
        return page
            .waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 30000 })
            .then(() => true)
            .catch(() => false);
    };

    const cheat = async (command: string) => {
        const sent = await page.evaluate(cmd => {
            const { client } = (globalThis as never as Rs2b0t).rs2b0t;
            if (!client.ingame || !client.out) return false;
            client.out.p1Enc(224);
            client.out.p1(cmd.length + 1);
            client.out.pjstr(cmd);
            return true;
        }, command);
        if (!sent) fail(`cheat '::${command}' not sent — client not ingame`);
        await page.waitForTimeout(1200);
    };

    await page.goto(`${base}/bot.html`);
    await boot();
    let firstIn = false;
    for (let attempt = 0; attempt < 3 && !firstIn; attempt++) {
        firstIn = await login();
    }
    if (!firstIn) {
        const mes = await page.evaluate(() => {
            const { client } = (globalThis as never as Rs2b0t).rs2b0t;
            return `${client.loginMes1} / ${client.loginMes2}`;
        });
        fail(`first login failed (server said: '${mes}')`);
    }

    await cheat(UNLOCK_TELE);
    await page.reload();
    await boot();
    let backIn = false;
    for (let attempt = 0; attempt < 8 && !backIn; attempt++) {
        await page.waitForTimeout(5000);
        backIn = await login();
    }
    if (!backIn) fail('re-login failed');

    for (const s of ['attack', 'strength', 'defence', 'hitpoints']) {
        await cheat(`advancestat ${s} 80`);
    }

    const atSpot = () =>
        page.evaluate(needUnderground => {
            const t = (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile();
            if (!t) return false;
            return needUnderground ? t.z > 6400 : Math.abs(t.x - 3222) > 10 || Math.abs(t.z - 3218) > 10;
        }, target.underground);
    for (let round = 0; round < 3 && !(await atSpot()); round++) {
        await cheat(target.tele);
        await page.waitForTimeout(2000);
    }
    if (target.underground && !(await atSpot())) fail('dungeon tele never took (still on the surface)');
    const npcCount = () => page.evaluate(name => (globalThis as never as Rs2b0t).rs2b0t.reader.npcs().filter(n => n.name === name).length, target.npc);
    let npcs = 0;
    for (let i = 0; i < 10 && npcs === 0; i++) {
        npcs = await npcCount();
        if (npcs === 0) await page.waitForTimeout(1000);
    }
    if (npcs === 0) fail(`no ${target.npc} NPCs at the tele spot`);
    console.log(`'${username}' among ${npcs} ${target.npc} NPCs`);

    const snapshot = () =>
        page.evaluate(() => {
            const rows: Record<string, string> = {};
            for (const node of Array.from(document.querySelectorAll('.rs2b0t-row'))) {
                rows[node.querySelector('.rs2b0t-key')?.textContent ?? ''] = node.querySelector('.rs2b0t-value')?.textContent ?? '';
            }
            const reader = (globalThis as never as { rs2b0t: { reader: { stat(i: number): { name: string; effective: number; base: number } } } }).rs2b0t.reader;
            const hp = reader.stat(3);
            return { tile: rows.tile ?? '?', status: rows.status ?? '?', hp: `${hp.effective}/${hp.base}` };
        });

    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Combat/ }).click();
    await page.locator('.rs2b0t-library-card', { hasText: script }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`${script} started`);

    await page.waitForTimeout(12000);
    let snap = await snapshot();
    console.log(`running at ${snap.tile}, status '${snap.status}'`);

    if (target.pauseKill) {
        await page.getByRole('button', { name: 'Pause' }).click();
        await page.waitForTimeout(6000);
        await cheat('setstat defence 1');
        await cheat('setstat hitpoints 1');
        const hunters = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.npcs().filter(n => n.name === 'Jail guard').length);
        for (let round = 0; round < 3 && (await hunters()) < 1; round++) {
            await cheat('npcadd jailguard');
        }
        const guards = await hunters();
        if (guards === 0) fail('::npcadd jailguard never took — no Jail guard NPCs in scene');
        snap = await snapshot();
        console.log(`paused, ${guards} jail guard(s) spawned at ${snap.tile}, hp ${snap.hp} — waiting to die...`);
    } else {
        await cheat('setstat defence 1');
        await cheat('setstat hitpoints 1');
        snap = await snapshot();
        console.log(`defence+hp floored mid-fight at ${snap.tile}, hp ${snap.hp} — waiting to die...`);
    }

    const diedAt = (tile: string) => {
        const m = /^(\d+), (\d+)/.exec(tile);
        if (!m) return false;
        const x = +m[1];
        const z = +m[2];
        return Math.abs(x - 3222) <= 6 && Math.abs(z - 3218) <= 6;
    };

    let died = false;
    for (let i = 0; i < 40 && !died; i++) {
        await page.waitForTimeout(3000);
        snap = await snapshot();
        died = diedAt(snap.tile);
    }
    if (!died) {
        await page.screenshot({ path: 'out/death-test.png' });
        fail(`player did not die — tile ${snap.tile}, hp ${snap.hp} (screenshot: out/death-test.png)`);
    }
    console.log(`>> died and respawned at ${snap.tile}, hp ${snap.hp}`);

    await cheat('setstat hitpoints 80');
    await cheat('setstat defence 80');
    if (target.pauseKill) {
        await page.getByRole('button', { name: 'Resume' }).click();
    }
    console.log('stats restored — expecting death detection + walk-back + cycle resume');

    const lootCount = () =>
        page.evaluate(() =>
            (globalThis as never as Rs2b0t).rs2b0t.reader
                .inventory()
                .filter(i => {
                    const n = (i.name ?? '').toLowerCase();
                    return n.includes('herb') || n.includes('law rune');
                }).length
        );

    const deadline = Date.now() + target.deadlineMin * 60_000;
    let lastLogged = 0;
    let detected = false;
    let arrived = false;
    let arrivedAt = 0;

    while (Date.now() < deadline) {
        await page.waitForTimeout(5000);
        const s = await page.evaluate(() => {
            const { runner, reader } = (globalThis as never as Rs2b0t).rs2b0t;
            return { state: runner.state, log: (runner.ctx?.log ?? []).map(l => l.msg), tile: reader.worldTile() };
        });
        for (const line of s.log.slice(lastLogged)) {
            console.log(`  [bot] ${line}`);
        }
        lastLogged = s.log.length;

        if (s.state === 'crashed') fail('script crashed during recovery');

        if (!detected && s.log.some(l => l.includes('died!'))) {
            detected = true;
            console.log('>> bot detected the death');
        }

        if (!arrived) {
            if (target.underground && s.tile && s.tile.z > 6400) {
                arrived = true;
                arrivedAt = s.log.length;
                console.log(`>> back underground at (${s.tile.x},${s.tile.z})`);
            } else if (!target.underground && s.log.some(l => l.includes('back at the anchor'))) {
                arrived = true;
                arrivedAt = s.log.findIndex(l => l.includes('back at the anchor')) + 1;
                console.log('>> walked back to the anchor from the respawn');
            }
        }

        if (detected && arrived) {
            if (target.resumeRe) {
                if (s.log.slice(arrivedAt).some(l => target.resumeRe.test(l))) {
                    await page.screenshot({ path: 'out/death-test.png' });
                    console.log('>> cycle resumed after death — screenshot: out/death-test.png');
                    console.log('PASS');
                    process.exit(0);
                }
            } else {
                const looted = await lootCount();
                if (looted > 0) {
                    await page.screenshot({ path: 'out/death-test.png' });
                    console.log(`>> cycle resumed after death — looted ${looted} herb/law-rune item(s) — screenshot: out/death-test.png`);
                    console.log('PASS');
                    process.exit(0);
                }
            }
        }
    }

    snap = await snapshot();
    await page.screenshot({ path: 'out/death-test.png' });
    fail(`recovery timed out (detected=${detected}, arrived=${arrived}) — tile ${snap.tile}, status '${snap.status}' (screenshot: out/death-test.png)`);
} finally {
    await browser.close();
}
