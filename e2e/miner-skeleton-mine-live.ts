import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { deployIsolatedClient, launchBrowser, parseArgs, setSettings } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, teleTo } from './tutorial/harness.js';
import { installMiningProbe, type MiningGlobal, type MiningProof } from './miner-skeleton/probe.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 8 });
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Use a local test engine');
const tag = `skm${Date.now().toString(36).slice(-7)}`;
const evidence = `out/e2e/${tag}`;
await mkdir(evidence, { recursive: true });
const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));

function summarize(proof: Omit<MiningProof, 'stop'>) {
    const samples = proof.samples;
    const depletions = proof.depletions.filter(d => d.nearby && !d.full && d.available > 0);
    const retargets = depletions.filter(d => d.selectionTicks !== undefined);
    const clicked = retargets.filter(d => d.clickTicks !== undefined);
    const nearbyClicks = clicked.filter(d => d.nextDistance !== undefined && d.nextDistance <= 2);
    const random = proof.choices.filter(c => c.rolls[0] < 0.1);
    return {
        build: proof.build, startedAt: proof.startedAt,
        seconds: samples.length ? (samples.at(-1)!.at - samples[0].at) / 1000 : 0,
        miningXp: samples.length ? samples.at(-1)!.xp - samples[0].xp : 0,
        coalPeak: Math.max(0, ...samples.map(s => s.coal)),
        damageTaken: samples.reduce((sum, s, i) => sum + Math.max(0, (samples[i - 1]?.hp ?? s.hp) - s.hp), 0),
        skeletonAttackTicks: samples.filter(s => s.skeletons > 0 && s.combat).length,
        retaliateOnTicks: samples.filter(s => s.retaliate).length,
        choices: proof.choices.length, randomChoices: random.length,
        randomNonNearest: random.filter(c => c.distance > c.nearest).length,
        wrongNearestChoices: proof.choices.filter(c => c.rolls[0] >= 0.1 && c.distance > c.nearest).length,
        clicksDuringCombatAnimation: proof.clicks.filter(c => c.combat && c.anim !== -1).length,
        retargets: retargets.length,
        combatRetargets: retargets.filter(d => d.combat && d.skeletons > 0).length,
        maxSelectionTicks: Math.max(0, ...retargets.map(d => d.selectionTicks!)),
        maxSelectionMs: Math.max(0, ...retargets.map(d => d.selectionMs!)),
        completedRetargets: clicked.length,
        nearbyClicks: nearbyClicks.length,
        maxNearbyClickTicks: Math.max(0, ...nearbyClicks.map(d => d.clickTicks!)),
        maxNearbyClickMs: Math.max(0, ...nearbyClicks.map(d => d.clickMs!)),
        maxClickTicksIncludingWalks: Math.max(0, ...clicked.map(d => d.clickTicks!)),
        pendingRetargets: depletions.filter(d => d.clickTicks === undefined).length
    };
}

try {
    await mainlandAccount(page, base, tag, client.page);
    for (const stat of ['mining 99', 'hitpoints 99', 'defence 60']) {
        await cheatQuiet(page, `setstat ${stat}`, 900);
    }
    await clearChatDialogs(page, 'mining fixture');
    await cheatQuiet(page, 'give rune_pickaxe 1', 900);
    const seeded = await page.evaluate(() => {
        const api = (globalThis as never as MiningGlobal).__rs2b0t;
        return { mining: api.Skills.effective('mining'), hp: api.Skills.effective('hitpoints'), pick: api.Inventory.count('Rune pickaxe') };
    });
    assert.deepEqual(seeded, { mining: 99, hp: 99, pick: 1 }, 'Account fixture was not seeded');
    assert(await teleTo(page, { x: 3018, z: 3590, level: 0 }, 3, 25_000), 'Mine teleport failed');
    await setSettings(page, 'Miner', {
        rocks: 'Coal', location: 'Wilderness Skeleton Mine', toolAcquire: 'Off',
        purgePackOnStart: false, muleMode: 'Off', tickManip: 'Off', foodWithdraw: 0, forgetfulBank: false
    });
    await page.evaluate(() => {
        const g = globalThis as never as MiningGlobal;
        const meta = g.rs2b0t.registry.get('Miner');
        if (!meta) throw new Error('Miner unavailable');
        g.rs2b0t.runner.start(meta);
    });
    await page.waitForFunction(() => {
        const g = globalThis as never as MiningGlobal;
        return !g.__rs2b0t.Game.autoRetaliateOn()
            && g.rs2b0t.runner.bot?.tasks.some(task => typeof task.pickRock === 'function');
    }, undefined, { timeout: 30_000 });
    await page.evaluate(installMiningProbe);
    const deadline = Date.now() + minutes * 60_000;
    let proof: Omit<MiningProof, 'stop'>;
    let lastLog = 0;
    for (;;) {
        await page.waitForTimeout(1000);
        proof = await page.evaluate(() => {
            const p = (globalThis as never as MiningGlobal).__miningProof;
            if (!p) throw new Error('Missing mining probe');
            const { stop: _stop, ...data } = p;
            return data;
        });
        const summary = summarize(proof);
        if (Date.now() - lastLog > 10_000) {
            console.log(JSON.stringify(summary));
            lastLog = Date.now();
        }
        const ready = summary.completedRetargets >= 20 && summary.combatRetargets >= 5
            && summary.randomNonNearest >= 1 && summary.clicksDuringCombatAnimation >= 1 && summary.damageTaken > 0
            && summary.pendingRetargets === 0;
        if (ready || Date.now() >= deadline || proof.samples.at(-1)?.state !== 'running') break;
    }
    const summary = summarize(proof);
    const logs = await page.evaluate(() => (globalThis as never as MiningGlobal).rs2b0t.runner.ctx?.log ?? []);
    await writeFile(`${evidence}/trace.json`, JSON.stringify({ summary, proof, logs, errors }, null, 2) + '\n');
    await page.screenshot({ path: `${evidence}/mining.png` });
    console.log(`evidence=${evidence}`);
    assert.equal(errors.length, 0, `Browser errors: ${errors.join('; ')}`);
    assert(summary.miningXp >= 1000, 'Expected at least 20 coal worth of mining XP');
    assert(summary.coalPeak >= 20, 'Expected at least 20 mined coal');
    assert(summary.damageTaken > 0 && summary.skeletonAttackTicks >= 20, 'Skeleton attack evidence missing');
    assert.equal(summary.retaliateOnTicks, 0, 'Auto Retaliate enabled while mining');
    assert(summary.retargets >= 20 && summary.combatRetargets >= 5, 'Insufficient depletion retargets under attack');
    assert(summary.completedRetargets >= 20, 'Insufficient clicks after depletion');
    assert.equal(summary.pendingRetargets, 0, 'Depleted rock still waiting for the next click');
    assert(summary.maxSelectionTicks <= 2, 'Depleted rock waited more than two server ticks before selection');
    assert(summary.nearbyClicks >= 5 && summary.maxNearbyClickTicks <= 2, 'Nearby next rock was not clicked promptly');
    assert(summary.randomNonNearest >= 1, 'No random non-nearest rock was selected');
    assert.equal(summary.wrongNearestChoices, 0, 'Nearest branch selected a farther rock');
    assert(summary.clicksDuringCombatAnimation > 0, 'No rock clicks observed during combat animations');
    await writeFile(`${evidence}/summary.json`, JSON.stringify({ result: 'PASS', ...summary }, null, 2) + '\n');
    console.log(`PASS ${JSON.stringify(summary)}`);
} finally {
    await page.evaluate(() => {
        const g = globalThis as never as MiningGlobal;
        g.__miningProof?.stop();
        g.rs2b0t?.runner.stop('mining e2e complete');
    }).catch(() => {});
    await browser.close();
    client.cleanup();
}
