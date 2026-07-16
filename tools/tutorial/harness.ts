// Shared headless-Chrome harness for the tutorial-run tooling (Task 2+):
// boot a fresh bot.html page, log in as a brand-new (auto-created) account,
// start a registered script, and poll a varp for progress.
//
// All game-state access goes through the page's `globalThis.rs2b0t` inside
// page.evaluate()/waitForFunction(). Like every other
// tools/*-test.ts file, this re-declares the minimal structural type it
// needs rather than importing from src/bot/ — the tools run under Node, the
// bot runtime is browser-only.

import type { Page } from 'playwright-core';

type Rs2b0t = {
    rs2b0t: {
        client: {
            ingame: boolean;
            sceneState: number;
            loginUser: string;
            loginPass: string;
            login(u: string, p: string, r: boolean): Promise<void>;
            logout(): Promise<void>;
            constructor: { loopCycle: number };
            /** Root interface id per sidebar tab (3 = backpack), -1 if unattached. */
            sideIcon: number[];
            /** Outbound packet stream — for direct CLIENT_CHEAT writes (see getServerVarQuiet). */
            out: { p1Enc(op: number): void; p1(v: number): void; pjstr(s: string): void };
        };
        reader: { varp(index: number): number; chat(n: number): { type: number; username: string | null; text: string }[] };
        runner: { start(meta: unknown): void };
        registry: { get(name: string): unknown };
    };
};

/**
 * Boot `bot.html` and log in as `user` (dev engine: any password logs in,
 * unknown usernames get a fresh save). Resolves once ingame with the scene
 * rendering (`sceneState === 2`) — a fresh account lands tutorial-locked,
 * which is fine; the caller decides what to do from there.
 */
export async function bootAndLogin(page: Page, base: string, user: string): Promise<void> {
    await page.goto(`${base}/bot.html?nodeid=10`);
    await page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });

    await page.evaluate(u => {
        const { client } = (globalThis as never as Rs2b0t).rs2b0t;
        client.loginUser = u;
        client.loginPass = 'test';
        void client.login(u, 'test', false);
    }, user);

    await page.waitForFunction(
        () => {
            const { client } = (globalThis as never as Rs2b0t).rs2b0t;
            return client.ingame && client.sceneState === 2;
        },
        undefined,
        { timeout: 30000 }
    );
}

/**
 * Log out and back in as the same `user` (the "relog trick" several
 * tutorial-arc tasks use to force the login script to re-evaluate a
 * server-side varp after a `::setvar` stage-jump — e.g. it only reopens the
 * character-design screen while `tutorial == 0`, so relogging past that
 * value skips it).
 *
 * `client.logout()` (src/client/Client.ts) is purely client-local — it just
 * closes the socket and resets client state, with no logout request sent to
 * the server. The server therefore doesn't notice the player is gone until
 * its own dead-connection timeout fires (`World.TIMEOUT_NO_CONNECTION`,
 * engine/World.ts: 50 ticks = 30s), then runs the logout trigger and frees
 * the username. Confirmed empirically (Task 3): a same-username relogin is
 * rejected (silently — the client just never reaches `ingame` again) for
 * ~30s and succeeds by ~39s. There's no known way to force a faster/clean
 * logout from bot code yet — that needs the logout interface's component id
 * (undiscovered, same category as the design-screen Accept button) so a
 * script can click it and set `player.requestLogout` immediately instead of
 * waiting out the idle-connection timeout. Until then, budget ~35-90s for
 * any test that relogs.
 */
export async function relog(page: Page, user: string): Promise<void> {
    await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.client.logout());
    await page.waitForFunction(() => !(globalThis as never as Rs2b0t).rs2b0t.client.ingame, undefined, { timeout: 15000 });

    const attemptLogin = () =>
        page.evaluate(u => {
            const { client } = (globalThis as never as Rs2b0t).rs2b0t;
            client.loginUser = u;
            client.loginPass = 'test';
            void client.login(u, 'test', false);
        }, user);

    const isIngame = () =>
        page
            .waitForFunction(
                () => {
                    const { client } = (globalThis as never as Rs2b0t).rs2b0t;
                    return client.ingame && client.sceneState === 2;
                },
                undefined,
                { timeout: 5000 }
            )
            .then(() => true)
            .catch(() => false);

    // Never succeeds before World.TIMEOUT_NO_CONNECTION (30s) -- don't burn
    // attempts before then, but keep retrying well past it for headroom.
    await page.waitForTimeout(28000);
    const deadline = Date.now() + 60000;
    for (;;) {
        await attemptLogin();
        if (await isIngame()) {
            return;
        }
        if (Date.now() >= deadline) {
            throw new Error(`relog: could not log back in as '${user}' within the retry budget (Engine-TS's ~30s dead-connection timeout may need more headroom)`);
        }
        await page.waitForTimeout(4000);
    }
}

/**
 * Type a `::` admin/debug command into the chat box (dev engine only —
 * gated server-side by staffModLevel; see
 * network/game/client/handler/ClientCheatHandler.ts in Engine-TS. Every
 * login on a non-production Engine-TS gets staffModLevel 4 there
 * (server/login/LoginThread.ts), so both plain admin commands like
 * `::setvar`/`::tele` (gated >=3) and `::~`-prefixed debugprocs (gated >=4)
 * work here). Same recipe as the original inline helper in
 * tools/scout-npcs.ts, promoted here so later tutorial-arc tasks share one
 * stage-jump mechanism (`::setvar <varp-debugname> <value>` + `relog()`)
 * instead of re-deriving it per task.
 */
export async function cheat(page: Page, command: string): Promise<void> {
    await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
    await page.waitForTimeout(200);
    await page.keyboard.type(`::${command}`, { delay: 25 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
}

/**
 * `cheat` without the keyboard OR the canvas click: writes the CLIENT_CHEAT
 * packet directly (byte-identical to the client's own Enter handler — the
 * same recipe `getServerVarQuiet` uses for reads). Prefer this over `cheat`
 * for any command issued while the game world is interactable: the typed
 * path's canvas-focus click is a REAL game click, and once the
 * character-design modal is gone (e.g. right after a `setvar tutorial`
 * stage-jump — the engine `closeModal()`s it before writing) that click
 * lands in the world and can start an NPC dialogue — after which ALL typed
 * input is eaten, silently dropping every subsequent `cheat` call. Found in
 * Task 9: a five-command jump kit reproducibly lost its tail two commands
 * (`advancestat`s) to exactly this, leaving the account half-jumped.
 * Returns false if the client isn't ingame (packet not sent).
 */
export async function cheatQuiet(page: Page, command: string): Promise<boolean> {
    const sent = await page.evaluate(c => {
        const { client } = (globalThis as never as Rs2b0t).rs2b0t;
        if (!client.ingame) {
            return false;
        }
        client.out.p1Enc(224); // ClientProt.CLIENT_CHEAT (src/io/ClientProt.ts)
        client.out.p1(c.length + 1);
        client.out.pjstr(c);
        return true;
    }, command);
    await page.waitForTimeout(700); // one server tick + headroom for the effect
    return sent;
}

/**
 * Read a player-varp's true server-side value via `::getvar <name>`,
 * parsing the echoed game-chat line (server format: `"get " + debugname +
 * ": " + value`). Returns null if the varp name is unknown or the echo
 * didn't show up.
 *
 * IMPORTANT — use this, not `reader.varp()`/`tutorialVarp()`, to verify a
 * `::setvar` stage-jump: a varp only reaches the client's local mirror
 * (what `reader.varp()` reads) if its pack config sets `transmit=yes`
 * (content/scripts/**\/*.varp; e.g. skill_prayer/configs/prayer.varp
 * marks prayer0..14 `transmit=yes`). `tutorial` (varp 281,
 * content/scripts/tutorial/configs/tutorial.varp) does **not** set
 * `transmit=yes` — confirmed empirically (Task 3): `::setvar tutorial N`
 * echoes "set tutorial: to N" (the write really happens server-side, and
 * `::getvar tutorial` echoes it back correctly) but `reader.varp(281)`
 * never changes from 0, even scanning the full varp index space for any
 * stray write. Since real tutorial-stage scripts (`%tutorial = X;`) write
 * through the exact same server-side storage, this isn't just a debug-
 * command quirk: TutorialBot.progress() (reader.varp(281)) cannot observe
 * real tutorial advancement either, on this content build. See
 * the Task 3 report for the full writeup —
 * flagged as a concern blocking Task 4+ until resolved (most likely fix:
 * add `transmit=yes` to tutorial.varp's `[tutorial]` section).
 *
 * `getvar`'s direct-by-name resolution path is also not protect-gated
 * (ClientCheatHandler.ts), so this is safe to call even while a modal
 * (e.g. the character-design screen) is open.
 */
export async function getServerVar(page: Page, name: string): Promise<number | null> {
    await cheat(page, `getvar ${name}`);
    const lines = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.chat(5));
    const line = lines.find(l => l.text.toLowerCase().startsWith(`get ${name.toLowerCase()}:`));
    if (!line) {
        return null;
    }

    const value = parseInt(line.text.split(':')[1]?.trim() ?? '', 10);
    return Number.isNaN(value) ? null : value;
}

/**
 * `getServerVar` without the keyboard: writes the CLIENT_CHEAT packet
 * directly (`out.p1Enc(224) + p1(len+1) + pjstr` — byte-identical to the
 * client's own Enter handler; Task 6's recipe)
 * and parses the same chat echo. Use this over `getServerVar` whenever a
 * script is RUNNING on the page: the typed path first clicks the canvas at
 * a fixed pixel to focus it — a real game click injected into the bot's
 * world — and typed input is eaten entirely while a chat dialog is open
 * (both observed live in Task 7: design-test's post-accept read raced the
 * new TalkToGuide dialogue and read a stale echo). Caveat shared with
 * `getServerVar`: the parse matches the NEWEST `get <name>:` line in the
 * chat ring, so if this read's own echo hasn't landed yet it can return the
 * value of a PREVIOUS read of the same varp — poll in a loop and treat a
 * repeated value as "unchanged", never as fresh confirmation of a write.
 */
export async function getServerVarQuiet(page: Page, name: string): Promise<number | null> {
    const sent = await page.evaluate(n => {
        const { client } = (globalThis as never as Rs2b0t).rs2b0t;
        if (!client.ingame) {
            return false;
        }
        const cmd = `getvar ${n}`;
        client.out.p1Enc(224); // ClientProt.CLIENT_CHEAT (src/io/ClientProt.ts)
        client.out.p1(cmd.length + 1);
        client.out.pjstr(cmd);
        return true;
    }, name);
    if (!sent) {
        return null;
    }

    await page.waitForTimeout(900); // one server tick + headroom for the echo
    const lines = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.chat(8));
    const line = lines.find(l => l.text.toLowerCase().startsWith(`get ${name.toLowerCase()}:`));
    if (!line) {
        return null;
    }

    const value = parseInt(line.text.split(':')[1]?.trim() ?? '', 10);
    return Number.isNaN(value) ? null : value;
}

/** Lumbridge east chicken pen, world (3232,3298) -- off Tutorial Island (tools/quests-tab-test.ts). */
const OFF_ISLAND_TELE = '0,50,51,32,34';

/**
 * Dev-only: fresh tutorial-locked account -> mainland-ready UI state (every
 * sidebar tab attached, including the backpack, `sideIcon[3]`).
 *
 * A naive `::setvar tutorial 1000` + relog (no teleport) HANGS: the login
 * script only runs `initalltabs` (which attaches every side tab) once
 * `~in_tutorial_island(coord) = false`, but an on-island watchdog reverts
 * `%tutorial` back every tick regardless of what a `::setvar` just wrote — so
 * setting the varp while still standing on the island silently reverts
 * before the relog's login script re-evaluates it (same gotcha the retired
 * farm template-save tool hit). Fix, proven live in
 * `tools/quests-tab-test.ts` (the "Tab-attachment requirement"
 * finding): teleport off-island FIRST, then
 * setvar, then relog. Skipping the teleport left every side tab except
 * logout/options at -1 even after the relog, confirmed empirically.
 */
export async function mainlandAccount(page: Page, base: string, user: string): Promise<void> {
    await bootAndLogin(page, base, user);

    await cheat(page, `tele ${OFF_ISLAND_TELE}`);
    await page.waitForTimeout(1500);

    // The setvar/getvar round-trip flakes transiently (getvar=null — the typed
    // cheat or its response gets swallowed; observed ~1-in-3 during the
    // 2026-07-16 quest-smoke burst). Bounded retry: re-issue the pair, don't
    // fail the whole account build on one dropped exchange.
    let tut: number | null = null;
    for (let attempt = 0; attempt < 3 && tut !== 1000; attempt++) {
        if (attempt > 0) {
            await page.waitForTimeout(1500);
        }
        await cheat(page, 'setvar tutorial 1000');
        await page.waitForTimeout(1000);
        tut = await getServerVar(page, 'tutorial');
    }
    if (tut !== 1000) {
        throw new Error(`mainlandAccount: setvar tutorial 1000 did not stick after 3 attempts (getvar=${tut}) -- still on-island?`);
    }

    await relog(page, user);

    const unlocked = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.client.sideIcon[3] ?? -1) !== -1);
    if (!unlocked) {
        throw new Error('mainlandAccount: sidebar still tutorial-locked after tele + setvar tutorial=1000 + relog');
    }
}

/** Start a registered script by name — the headless equivalent of picking it in the panel and clicking Start. */
export async function startScript(page: Page, name: string): Promise<void> {
    await page.evaluate(n => {
        const { runner, registry } = (globalThis as never as Rs2b0t).rs2b0t;
        runner.start(registry.get(n));
    }, name);
}

/** Resolve true as soon as varp `varpIndex` reaches >= `target`, false on timeout. */
export async function runToVarp(page: Page, varpIndex: number, target: number, timeoutMs: number): Promise<boolean> {
    return page
        .waitForFunction(([i, t]) => (globalThis as never as Rs2b0t).rs2b0t.reader.varp(i) >= t, [varpIndex, target], { timeout: timeoutMs })
        .then(() => true)
        .catch(() => false);
}

/** Read-only snapshot of varp `i` (for pass/fail reporting after runToVarp settles). */
export async function tutorialVarp(page: Page, i: number): Promise<number> {
    return page.evaluate(idx => (globalThis as never as Rs2b0t).rs2b0t.reader.varp(idx), i);
}
