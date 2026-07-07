// Death-recovery test for the shared DeathRecovery task + Traversal.walkResilient
// (Task 6): kill the bot MID-RUN (floor defence+hitpoints while it fights —
// the engaged NPC lands the killing hit within a few rounds; real death
// pipeline, real "Oh dear you are dead!" line, real Lumbridge respawn) and
// assert the script's shared DeathRecovery detects the death with the script
// still running, walks back from the respawn, and the normal kill/loot cycle
// resumes — no operator intervention at any point after the kill.
//
// Two targets, both on the shared task:
// - ChickenKiller (default): Lumbridge chicken pen; short, reliable
//   walk-back through DeathRecovery's default Traversal.walkResilient leg.
//   This is the deterministic covering run.
// - ChaosDruidKiller: Edgeville dungeon; exercises the walkBack override
//   (trapdoor climb-down the web-walker can't do + gatedWalk). The
//   cross-map Lumbridge->Edgeville surface leg can coin-flip onto a corridor
//   near (3138,3351) whose live blocker isn't in the baked nav pack (walker
//   limitation, pre-existing — BankRun's surface leg shares it), so treat a
//   timeout there as the known nav flake, not a recovery failure.
//
// Cheats are delivered as direct CLIENT_CHEAT packets, not keyboard input
// (typed commands can be silently swallowed — see docs/quest-campaign-map.md,
// Task 6 section). Script selection uses the "Browse..." modal (the old
// `.lcb-select` dropdown is gone from BotPanel).
//
// Usage: bun tools/death-test.ts [base-url] [username] [script]
//        script = ChickenKiller (default) | ChaosDruidKiller

import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8888';
// max 12 chars: the login screen caps typed usernames at 12 (Client.ts ~1457)
// and the programmatic client.login() path the tests use skips that cap —
// a longer name fails the login handshake silently
const username = process.argv[3] ?? `dth${Date.now().toString(36).slice(-7)}`;
const script = process.argv[4] ?? 'ChickenKiller';

const UNLOCK_TELE = 'tele 0,50,50,20,20'; // generic off-tutorial-island mainland tile (unlocks the sidebar on relog)

const TARGETS = {
    ChickenKiller: {
        // Lumbridge east chicken pen — same tele the original version of this
        // test used (also the quests-tab test's off-island tile)
        tele: 'tele 0,50,51,32,34',
        npc: 'Chicken',
        underground: false,
        // chickens die to one 80-str punch before they ever retaliate, so a
        // mid-fight stat floor never draws a killing hit — instead: pause,
        // floor hp, spawn an aggressive hunter on the stationary player.
        // NOT a flytrap (this content build's flytrap has defaultmode=none,
        // moverestrict=nomove and NO huntmode — it literally cannot attack;
        // the old recipe's comment described an earlier build). 'Jail guard'
        // has huntmode=aggressive_melee with check_nottoostrong=off — it
        // attacks players of ANY combat level (area_draynor/configs/
        // draynor.npc + _unpack/225/all.hunt [aggressive_melee]).
        pauseKill: true,
        // cycle-resume markers, from ChickenKiller's own log lines
        // (case-insensitive: the script logs 'Chicken killed' / 'looted Bones')
        resumeRe: /chicken killed|looted bones|buried bones/i,
        deadlineMin: 6
    },
    ChaosDruidKiller: {
        // (3110,9928) among the Chaos druids — proven live by tools/chaosdruid-test.ts
        tele: 'tele 0,48,155,38,8',
        npc: 'Chaos druid',
        underground: true,
        // druids hit back hard and constantly — floor defence+hp MID-FIGHT
        // and the engaged druid kills us in a few rounds. (Flytraps don't
        // work here: spawned on the player's tile with every adjacent tile
        // crowded by druids, they can never step next to us to melee —
        // observed live, 2 verified flytraps idle for 120s.)
        pauseKill: false,
        resumeRe: null, // druid mode gates on herb/law-rune loot instead
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

type Lcb = {
    lcbuddy: {
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

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    const boot = async () => {
        await page.waitForFunction(() => (globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy !== undefined && (globalThis as never as { lcbuddy: { client: { constructor: { loopCycle: number } } } }).lcbuddy.client.constructor.loopCycle > 10, undefined, { timeout: 60000 });
    };

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
            .waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 30000 })
            .then(() => true)
            .catch(() => false);
    };

    // Send a '::' cheat command by writing the CLIENT_CHEAT packet directly
    // on the live connection — byte-identical to the client's own Enter
    // handler (Client.ts ~3092: p1Enc(CLIENT_CHEAT=224), p1(len+1), pjstr).
    // The keyboard route other tests use (canvas click to focus, then
    // page.keyboard.type) is unreliable here: the focus click is a REAL game
    // click, and in a crowded scene it can land on an NPC minimenu and
    // silently swallow the typed command (observed live — '::npcadd flytrap'
    // eaten, no death possible). No keyboard, no focus, no click.
    const cheat = async (command: string) => {
        const sent = await page.evaluate(cmd => {
            const { client } = (globalThis as never as Lcb).lcbuddy;
            if (!client.ingame || !client.out) return false;
            client.out.p1Enc(224); // ClientProt.CLIENT_CHEAT
            client.out.p1(cmd.length + 1);
            client.out.pjstr(cmd);
            return true;
        }, command);
        if (!sent) fail(`cheat '::${command}' not sent — client not ingame`);
        await page.waitForTimeout(1200);
    };

    await page.goto(`${base}/bot.html`);
    await boot();
    // fresh-account bootstrap (char creation + tutorial scene load) can be
    // slow under a busy dev engine; a couple of retries before giving up
    // (same account, same evaluate) is cheap insurance against that, not a
    // fresh-username retry (this account hasn't logged in yet either way)
    let firstIn = false;
    for (let attempt = 0; attempt < 3 && !firstIn; attempt++) {
        firstIn = await login();
    }
    if (!firstIn) {
        const mes = await page.evaluate(() => {
            const { client } = (globalThis as never as Lcb).lcbuddy;
            return `${client.loginMes1} / ${client.loginMes2}`;
        });
        fail(`first login failed (server said: '${mes}')`);
    }

    // unlock the sidebar: teleport off Tutorial Island, reload, relogin
    // (proven recipe, shared by tools/chaosdruid-test.ts / rockcrab-test.ts)
    await cheat(UNLOCK_TELE);
    await page.reload();
    await boot();
    let backIn = false;
    for (let attempt = 0; attempt < 8 && !backIn; attempt++) {
        await page.waitForTimeout(5000);
        backIn = await login();
    }
    if (!backIn) fail('re-login failed');

    // survivable combat stats so ordinary fighting can't kill us before we
    // force the death ourselves with the stat floor below
    for (const s of ['attack', 'strength', 'defence', 'hitpoints']) {
        await cheat(`advancestat ${s} 80`);
    }

    // tele to the target spot; verify the tile actually moved before
    // trusting it — a swallowed command otherwise turns into a misleading
    // "no NPCs" failure — and give the scene a moment to populate
    const atSpot = () =>
        page.evaluate(needUnderground => {
            const t = (globalThis as never as Lcb).lcbuddy.reader.worldTile();
            if (!t) return false;
            return needUnderground ? t.z > 6400 : Math.abs(t.x - 3222) > 10 || Math.abs(t.z - 3218) > 10; // surface mode: just "not at the respawn/unlock area"
        }, target.underground);
    for (let round = 0; round < 3 && !(await atSpot()); round++) {
        await cheat(target.tele);
        await page.waitForTimeout(2000);
    }
    if (target.underground && !(await atSpot())) fail('dungeon tele never took (still on the surface)');
    const npcCount = () => page.evaluate(name => (globalThis as never as Lcb).lcbuddy.reader.npcs().filter(n => n.name === name).length, target.npc);
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
            for (const node of Array.from(document.querySelectorAll('.lcb-row'))) {
                rows[node.querySelector('.lcb-key')?.textContent ?? ''] = node.querySelector('.lcb-value')?.textContent ?? '';
            }
            const reader = (globalThis as never as { lcbuddy: { reader: { stat(i: number): { name: string; effective: number; base: number } } } }).lcbuddy.reader;
            const hp = reader.stat(3);
            return { tile: rows.tile ?? '?', status: rows.status ?? '?', hp: `${hp.effective}/${hp.base}` };
        });

    // script-library modal (Browse... -> category chip -> card), the current
    // (post `.lcb-select` dropdown) selection UI
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Combat/ }).click();
    await page.locator('.lcb-library-card', { hasText: script }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'hidden', timeout: 5000 });
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`${script} started`);

    // Let it settle into the cycle (proves it's running).
    await page.waitForTimeout(12000);
    let snap = await snapshot();
    console.log(`running at ${snap.tile}, status '${snap.status}'`);

    // Kill it deterministically, per-mode (content debugprocs like ::killme
    // aren't in this engine's pack, so the kill has to come from real NPC
    // damage either way; see TARGETS for why each mode needs its own shape).
    if (target.pauseKill) {
        // pause so the player stands still, floor defence AND hp, spawn an
        // aggressive hunter ON the stationary player. Two kill paths, one
        // per engagement state:
        // - paused MID-FIGHT: the engaged chicken keeps pecking the frozen
        //   player (harmlessly vs def 80 — which also refreshes %lastcombat
        //   forever and blocks the hunter's check_notcombat acquisition, a
        //   live-observed stalemate). At def 1 its next peck kills.
        // - paused IDLE: nothing refreshes %lastcombat, so the jail guard
        //   acquires the stationary player and lands the kill.
        await page.getByRole('button', { name: 'Pause' }).click();
        await page.waitForTimeout(6000); // let the pause take
        await cheat('setstat defence 1');
        await cheat('setstat hitpoints 1');
        const hunters = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.npcs().filter(n => n.name === 'Jail guard').length);
        for (let round = 0; round < 3 && (await hunters()) < 1; round++) {
            await cheat('npcadd jailguard');
        }
        const guards = await hunters();
        if (guards === 0) fail('::npcadd jailguard never took — no Jail guard NPCs in scene');
        snap = await snapshot();
        console.log(`paused, ${guards} jail guard(s) spawned at ${snap.tile}, hp ${snap.hp} — waiting to die...`);
    } else {
        // the bot is ALREADY fighting NPCs that hit back — floor defence +
        // hitpoints mid-combat and the engaged NPC lands the killing hit
        // within a few rounds. The script keeps RUNNING through the death,
        // which is exactly the production shape the shared DeathRecovery
        // must handle: death mid-cycle, recovery on the next loop, no
        // operator intervention.
        await cheat('setstat defence 1');
        await cheat('setstat hitpoints 1');
        snap = await snapshot();
        console.log(`defence+hp floored mid-fight at ${snap.tile}, hp ${snap.hp} — waiting to die...`);
    }

    // Death = respawn teleport to the Lumbridge respawn point (~3222,3218).
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

    // setstat floored the BASE levels too — restore them now (respawn healed
    // to the floored base of 1) so the bot survives the return trip and the
    // resumed fights (and any leftover flytraps at the anchor).
    await cheat('setstat hitpoints 80');
    await cheat('setstat defence 80');
    if (target.pauseKill) {
        await page.getByRole('button', { name: 'Resume' }).click();
    }
    console.log('stats restored — expecting death detection + walk-back + cycle resume');

    const lootCount = () =>
        page.evaluate(() =>
            (globalThis as never as Lcb).lcbuddy.reader
                .inventory()
                .filter(i => {
                    const n = (i.name ?? '').toLowerCase();
                    return n.includes('herb') || n.includes('law rune');
                }).length
        );

    // NOTE for druid mode: one recovery leg (Lumbridge->Edgeville dungeon)
    // measured ~5.5 min live when the pathfinder picks the clean corridor.
    const deadline = Date.now() + target.deadlineMin * 60_000;
    let lastLogged = 0;
    let detected = false;
    let arrived = false; // druid: back underground; chicken: 'back at the anchor' logged
    let arrivedAt = 0; // log index at arrival — resume markers only count AFTER this (a pre-death 'Chicken killed' must not satisfy the resume gate)

    while (Date.now() < deadline) {
        await page.waitForTimeout(5000);
        const s = await page.evaluate(() => {
            const { runner, reader } = (globalThis as never as Lcb).lcbuddy;
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
