import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import type { Page } from 'playwright-core';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, requireSim, setSettings, startFromLibrary, stopScript, type Rs2b0t } from './lib/harness.js';
import { clearMainModal, mainlandAccount, maxmeAndClearDialogs, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

type Api = Rs2b0t & {
    __rs2b0t: {
        Inventory: { count(name: string): number };
        Skills: { xp(name: string): number; level(name: string): number };
        Bank: { isOpen(): boolean; count(name: string): number };
    };
};
const { base, minutes, rest } = parseArgs(process.argv.slice(2), { minutes: 8 });
const review = process.argv.includes('--review');
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'local server required');
const modes = rest.length ? rest : review ? ['inside'] : ['outside', 'inside'];
assert(modes.every(mode => mode === 'outside' || mode === 'inside'), 'expected outside or inside');
assert(!review || process.env.HEADED === '1' && modes.length === 1, '--review requires HEADED=1 and one trading mode');
const tag = `cos${Date.now().toString(36).slice(-6)}`;
const output = `out/${tag}`;
await requireSim(base);
await mkdir(output, { recursive: true });
const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const pages: Page[] = [];
const errors: string[] = [];
const results: unknown[] = [];

function sample(page: Page) {
    return page.evaluate(() => {
        const g = globalThis as never as Api;
        const { Inventory, Skills, Bank } = g.__rs2b0t;
        return {
            tile: g.rs2b0t.reader.worldTile(), state: g.rs2b0t.runner.state,
            status: String(g.rs2b0t.runner.bot?.status ?? ''),
            essence: Inventory.count('Rune essence'), runes: Inventory.count('Cosmic rune'),
            talisman: Inventory.count('Cosmic talisman'), staff: Inventory.count('Dramen staff'),
            xp: Skills.xp('runecraft'), level: Skills.level('runecraft'),
            bank: Bank.isOpen(), bankRunes: Bank.isOpen() ? Bank.count('Cosmic rune') : null,
            bankEssence: Bank.isOpen() ? Bank.count('Rune essence') : null,
            logs: g.rs2b0t.runner.ctx?.log.slice(-16).map(line => line.msg) ?? [],
            chat: g.rs2b0t.reader.chat(8)
        };
    });
}

async function reviewPair(master: Page, runner: Page, mode: string): Promise<void> {
    let finish = () => {};
    const finished = new Promise<void>(resolve => { finish = resolve; });
    for (const [page, role] of [[master, 'Master'], [runner, 'Runner']] as const) {
        page.once('close', finish);
        await page.exposeFunction('finishCosmicReview', finish);
        await page.evaluate(({ role, mode }) => {
            document.title = `JiveRC Cosmic ${role} (${mode})`;
            const bar = document.createElement('div');
            bar.style.cssText = 'position:fixed;top:8px;left:12px;z-index:10000;display:flex;align-items:center;gap:12px;color:#f3b7ee;font:14px monospace;background:#171219;padding:7px 12px;border:1px solid #ac62ad;border-radius:4px';
            const label = document.createElement('span');
            label.textContent = `Cosmic ${role} | ${mode} trading`;
            const button = document.createElement('button');
            button.textContent = 'Finish test';
            button.onclick = () => void (globalThis as never as { finishCosmicReview(): Promise<void> }).finishCosmicReview();
            bar.append(label, button);
            document.body.appendChild(bar);
        }, { role, mode });
        const cdp = await page.context().newCDPSession(page);
        const { windowId } = await cdp.send('Browser.getWindowForTarget');
        const available = await page.evaluate(() => screen.availWidth);
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: role === 'Master' ? 0 : Math.max(40, available - 1300), top: 30, width: 1300, height: 820, windowState: 'normal' } });
        await cdp.detach();
    }
    const [masterState, runnerState] = await Promise.all([sample(master), sample(runner)]);
    await Bun.write(`${output}/review.json`, JSON.stringify({ mode, result: 'AWAITING USER VALIDATION', master: masterState, runner: runnerState }, null, 2) + '\n');
    await master.screenshot({ path: `${output}/review-master.png` });
    await runner.screenshot({ path: `${output}/review-runner.png` });
    console.log(`REVIEW READY: ${mode} Cosmic crafting. Use Pause/Stop freely; Finish test in either window ends both sessions. ${output}/review.json`);
    await finished;
    console.log('Manual review closed; cleaning up both accounts.');
}

try {
    for (const mode of modes) {
        const inside = mode === 'inside';
        const masterName = `${tag}m${inside ? 'i' : 'o'}`;
        const runnerName = `${tag}r${inside ? 'i' : 'o'}`;
        const master = await (await browser.newContext()).newPage();
        const runner = await (await browser.newContext()).newPage();
        pages.push(master, runner);
        for (const [page, name, isMaster] of [[master, masterName, true], [runner, runnerName, false]] as const) {
            page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
            await mainlandAccount(page, base, name, client.page);
            await maxmeAndClearDialogs(page);
            await clearMainModal(page);
            assert(await cheatQuiet(page, '~clearinv'));
            assert(await cheatQuiet(page, 'give dramen_staff 1'));
            if (isMaster || inside) assert(await cheatQuiet(page, 'give cosmic_talisman 1'));
            if (!isMaster) await seedItemsToBank(page, [{ debugName: 'blankrune', displayName: 'Rune essence', qty: 500 }], { x: 3185, z: 3436, level: 0 });
            assert(await teleTo(page, isMaster ? { x: 3173, z: 9501, level: 0 } : { x: 3152, z: 9575, level: 0 }, 0));
            await setSettings(page, 'JiveRC', {
                rune: 'Cosmic runes', mode: isMaster ? 'Master' : 'Runner', partner: isMaster ? runnerName : masterName,
                stayInAltar: inside, bankEvery: isMaster && inside ? 3 : 0, withdrawEss: 25
            });
            const state = await sample(page);
            assert.equal(state.staff, 1, `${name}: Dramen staff seeded`);
            if (isMaster || inside) assert.equal(state.talisman, 1, `${name}: Cosmic talisman seeded`);
            assert.equal(state.level, 99, `${name}: Runecrafting fixture`);
            if (review) await startFromLibrary(page, 'Runecrafting', 'JiveRC');
        }
        const before = await sample(master);
        const started = Date.now();
        const deadline = started + minutes * 60_000;
        const events: unknown[] = [];
        let crafts = 0, banked = 0, xpAtBank = 0, runnerRestocked = false, seenEmptyRunner = false, previousEssence = 0;
        let masterEntered = false, masterExited = false, runnerEntered = false, runnerExited = false;
        let previousXp = before.xp, nextPrint = 0;
        await startScript(master, 'JiveRC');
        await startScript(runner, 'JiveRC');
        await master.waitForFunction(() => (globalThis as never as Api).rs2b0t.runner.state === 'running');
        await runner.waitForFunction(() => (globalThis as never as Api).rs2b0t.runner.state === 'running');
        if (review) {
            await reviewPair(master, runner, mode);
            continue;
        }
        while (Date.now() < deadline) {
            const [m, r] = await Promise.all([sample(master), sample(runner)]);
            assert.equal(m.state, 'running', JSON.stringify(m));
            assert.equal(r.state, 'running', JSON.stringify(r));
            assert.equal(m.staff, 1, 'master retains Dramen staff');
            assert.equal(r.staff, 1, 'runner retains Dramen staff');
            const inTemple = (tile: typeof m.tile) => !!tile && tile.level === 0 && tile.x >> 6 === 33 && tile.z >> 6 === 75;
            if (inTemple(m.tile)) masterEntered = true;
            else if (masterEntered) masterExited = true;
            if (inTemple(r.tile)) runnerEntered = true;
            else if (runnerEntered) runnerExited = true;
            if (previousEssence > 0 && r.essence === 0) seenEmptyRunner = true;
            if (seenEmptyRunner && r.bank && r.essence === 25) runnerRestocked = true;
            previousEssence = r.essence;
            if (m.xp > previousXp) {
                assert.equal(m.xp - previousXp, 200, '25 essence grants 200 Runecrafting XP');
                assert(m.runes >= 50, '25 essence produces 50 Cosmic runes at level 99');
                crafts++;
                events.push({ event: 'crafted', seconds: Math.round((Date.now() - started) / 1000), master: m, runner: r });
                previousXp = m.xp;
                await master.screenshot({ path: `${output}/${mode}-craft-${crafts}.png` });
            }
            if (m.bankRunes !== null && m.bankRunes > banked) {
                banked = m.bankRunes;
                xpAtBank = m.xp;
                events.push({ event: 'banked', seconds: Math.round((Date.now() - started) / 1000), master: m, runner: r });
            }
            const done = crafts >= 2 && runnerRestocked && masterEntered && masterExited
                && (!inside || runnerEntered && runnerExited && banked >= 50 && m.xp > xpAtBank);
            if (Date.now() >= nextPrint || done) {
                console.log(JSON.stringify({ mode, seconds: Math.round((Date.now() - started) / 1000), crafts, banked, runnerRestocked,
                    master: { tile: m.tile, status: m.status, essence: m.essence, runes: m.runes, xp: m.xp - before.xp },
                    runner: { tile: r.tile, status: r.status, essence: r.essence, bankEssence: r.bankEssence } }));
                nextPrint = Date.now() + 15_000;
            }
            if (done) {
                results.push({ mode, result: 'PASS', crafts, banked, runnerRestocked, masterEntered, masterExited, runnerEntered, runnerExited, before, after: m, events });
                break;
            }
            await master.waitForTimeout(600);
        }
        assert(results.length === modes.indexOf(mode) + 1, `${mode}: did not complete all crafting, return, and bank checks within ${minutes} minutes`);
        await stopScript(master);
        await stopScript(runner);
        await logout(master);
        await logout(runner);
        await master.context().close();
        await runner.context().close();
        console.log(`PASS ${mode}`);
    }
    if (!review) {
        assert.deepEqual(errors, [], 'browser errors');
        await Bun.write(`${output}/results.json`, JSON.stringify({ result: 'PASS', at: new Date().toISOString(), base,
            sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), results }, null, 2) + '\n');
        console.log(`PASS Cosmic crafting: ${output}/results.json`);
    }
} catch (error) {
    const states = [];
    for (const [i, page] of pages.entries()) {
        if (page.isClosed()) continue;
        states.push(await sample(page).catch(() => null));
        await page.screenshot({ path: `${output}/failure-${i}.png` }).catch(() => undefined);
    }
    await Bun.write(`${output}/failure.json`, JSON.stringify({ error: String(error), errors, states, results }, null, 2) + '\n');
    console.error(JSON.stringify({ output, states, errors }));
    throw error;
} finally {
    for (const page of pages) {
        if (page.isClosed()) continue;
        await stopScript(page).catch(() => undefined);
        await logout(page).catch(() => false);
    }
    await browser.close();
    client.cleanup();
}
