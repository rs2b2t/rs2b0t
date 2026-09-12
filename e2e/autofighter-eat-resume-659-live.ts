import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

type Api = {
    __rs2b0t: {
        Inventory: { count(name: string): number; first(name: string): { actions(): string[]; interact(op: string): unknown } | null };
        Skills: { xp(name: string): number; effective(name: string): number };
        Npcs: { all(): { index: number; name: string | null; targetsMe(): boolean }[] };
    };
    __damageWatch?: { hits: number[]; timer: number; sample(): void };
    rs2b0t: { client: { localPlayer: { damageValues: Int32Array; damageTypes: Int32Array; damageCycles: Int32Array } | null }; runner: { state: string; ctx: { log: { msg: string }[] } | null } };
};

const { base } = parseArgs(process.argv.slice(2));
const tag = `eat${Date.now().toString(36).slice(-6)}`;
const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const page = await browser.newPage();
const snapshot = () => page.evaluate(() => {
    const g = globalThis as never as Api;
    g.__damageWatch?.sample();
    return {
        hp: g.__rs2b0t.Skills.effective('hitpoints'),
        xp: g.__rs2b0t.Skills.xp('attack'),
        food: g.__rs2b0t.Inventory.count('Trout'),
        target: g.__rs2b0t.Npcs.all().find(n => n.name === 'Guard' && n.targetsMe())?.index ?? null,
        state: g.rs2b0t.runner.state,
        hits: g.__damageWatch?.hits ?? []
    };
});
try {
    await mainlandAccount(page, base, tag, client.page);
    for (const [stat, level] of [['attack', 60], ['strength', 1], ['defence', 99], ['hitpoints', 99]] as const) {
        await cheatQuiet(page, `setstat ${stat} ${level}`);
    }
    await clearChatDialogs(page);
    for (const [debug, name] of [['bronze_sword', 'Bronze sword'], ['rune_chainbody', 'Rune chainbody'], ['rune_platelegs', 'Rune platelegs'], ['rune_full_helm', 'Rune full helm'], ['rune_kiteshield', 'Rune kiteshield']]) {
        await cheatQuiet(page, `give ${debug} 1`);
        await page.evaluate(n => {
            const item = (globalThis as never as Api).__rs2b0t.Inventory.first(n);
            const op = item?.actions().find(a => /wield|wear/i.test(a));
            if (!item || !op) throw new Error(`missing equipment: ${n}`);
            item.interact(op);
        }, name);
        await page.waitForTimeout(700);
    }
    await cheatQuiet(page, 'give trout 10');
    if (!(await teleTo(page, { x: 2661, z: 3306, level: 0 }))) throw new Error('guard seed failed');
    await setSettings(page, 'AutoFighter', { target: 'Guard', spot: 'Start position', leashRadius: 14, combatStyle: 'melee', meleeStyle: 'attack', food: 'Trout', foodWithdraw: 0, banking: 'None', buryBones: false, solveClues: false, useSpecial: false });
    await startScript(page, 'AutoFighter');
    const start = await snapshot();
    await page.waitForFunction(xp => {
        const g = globalThis as never as Api;
        return g.__rs2b0t.Skills.xp('attack') > xp && g.__rs2b0t.Npcs.all().some(n => n.name === 'Guard' && n.targetsMe());
    }, start.xp, { timeout: 90_000 });
    const fighting = await snapshot();
    console.log('FIGHTING', JSON.stringify(fighting));
    await page.screenshot({ path: 'docs/e2e/issue-659-before.png' });
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const player = g.rs2b0t.client.localPlayer;
        if (!player) throw new Error('missing local player');
        const seen = new Set(Array.from(player.damageCycles, (cycle, i) => `${i}:${cycle}`));
        const hits: number[] = [];
        const sample = () => {
            for (let i = 0; i < player.damageCycles.length; i++) {
                const stamp = `${i}:${player.damageCycles[i]}`;
                if (seen.has(stamp)) continue;
                seen.add(stamp);
                if (player.damageTypes[i] === 1 && player.damageValues[i] > 0) hits.push(player.damageValues[i]);
            }
        };
        const timer = window.setInterval(sample, 50);
        g.__damageWatch = { hits, timer, sample };
    });
    await cheatQuiet(page, '~stat_drain hitpoints 21 0', 0);
    await page.waitForFunction(food => (globalThis as never as Api).__rs2b0t.Inventory.count('Trout') < food, fighting.food, { timeout: 20_000 });
    let afterEat = await snapshot();
    let resumed = false;
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
        await page.waitForTimeout(200);
        const snap = await snapshot();
        if (snap.food < afterEat.food) {
            afterEat = snap;
        }
        if (snap.xp > afterEat.xp && snap.target === fighting.target) {
            if (snap.hits.length > 0) throw new Error(`combat resumed after damaging hits: ${snap.hits}; zero-damage case not proven`);
            console.log('RESUMED', JSON.stringify({ afterEat, snap }));
            resumed = true;
            break;
        }
        if (snap.state !== 'running') throw new Error(`AutoFighter stopped: ${snap.state}`);
    }
    if (!resumed) throw new Error('no attack XP against the original guard after eating');
    await page.screenshot({ path: 'docs/e2e/issue-659-after.png' });
    console.log('PASS: AutoFighter ate and resumed attacking without another damaging hit');
} finally {
    await page.evaluate(() => window.clearInterval((globalThis as never as Api).__damageWatch?.timer)).catch(() => undefined);
    console.log('LOGS', await page.evaluate(() => (globalThis as never as Api).rs2b0t?.runner.ctx?.log.slice(-12).map(l => l.msg)).catch(() => []));
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
