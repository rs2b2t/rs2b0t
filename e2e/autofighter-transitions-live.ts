import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { engineLoginKey } from './lib/engineLoginKey.js';
import { launchBrowser, requireSim, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, teleTo } from './tutorial/harness.js';

const base = 'http://localhost:8890';
const tag = `aft${Date.now().toString(36)}`;
const output = `out/${tag}`;
const engine = process.env.ENGINE_DIR ?? `${homedir()}/code/rs2b2t-engine`;
await mkdir(output, { recursive: true });
await requireSim(base);
const key = engineLoginKey(engine);
const build = Bun.spawnSync(['bun', 'run', 'build:bot'], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, LOCAL_RSAE: key.rsae, LOCAL_RSAN: key.rsan, B0T_OUT_DIR: output } });
assert.equal(build.exitCode, 0, build.stderr.toString());
const deployed = `${engine}/public/bot/${tag}`;
const html = `${engine}/public/bot-${tag}.html`;
cpSync(output, deployed, { recursive: true });
cpSync('out/collision.lcnav.gz', `${deployed}/collision.lcnav.gz`);
writeFileSync(html, readFileSync(`${engine}/public/bot.html`, 'utf8').replaceAll('./bot/botclient.js', `./bot/${tag}/botclient.js`));
const browser = await launchBrowser();
const page = await browser.newPage();
const samples: unknown[] = [];
try {
    await mainlandAccount(page, base, tag, `/bot-${tag}.html`);
    for (const skill of ['attack', 'strength', 'defence', 'hitpoints']) {
        assert(await cheatQuiet(page, `setstat ${skill} 99`));
        await clearChatDialogs(page);
    }
    for (const item of ['rune_scimitar', 'rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield']) assert(await cheatQuiet(page, `give ${item} 1`));
    for (const name of ['Rune scimitar', 'Rune full helm', 'Rune chainbody', 'Rune platelegs', 'Rune kiteshield']) {
        assert(await page.evaluate(name => Reflect.get(globalThis as object, '__rs2b0t').Equipment.equip(name), name));
    }
    assert(await cheatQuiet(page, 'give lobster 15'));
    assert(await teleTo(page, { x: 2700, z: 9774, level: 0 }, 2, 25000));
    await clearChatDialogs(page);
    await setSettings(page, 'AutoFighter', { target: 'Shadow warrior', leashRadius: 12, combatStyle: 'melee', meleeStyle: 'strength', food: 'Lobster', foodWithdraw: 0,
        loot: 'Dragon spear', buryBones: false, buryBigBones: false, solveClues: false, banking: 'None', useSpecial: false });
    await page.evaluate(() => {
        const g = Reflect.get(globalThis as object, 'rs2b0t');
        const api = Reflect.get(globalThis as object, '__rs2b0t');
        const events: { kind: string; at: number; tick: number; index: number; combat: boolean }[] = [];
        Reflect.set(globalThis as object, 'fighterTiming', events);
        const record = (kind: string, index: number) => events.push({ kind, index, at: performance.now(), tick: api.Game.tick(), combat: api.Game.inCombat() });
        const interact = api.Npc.prototype.interact;
        api.Npc.prototype.interact = function (op: string) {
            if (op === 'Attack') record('attack', this.index);
            return interact.call(this, op);
        };
        const seen = new Set<number>();
        const dead = new Set<number>();
        const meta = g.registry.get('AutoFighter');
        const bot = meta.create();
        bot.on('tick', () => {
            for (const npc of g.reader.npcs()) {
                if (npc.name !== 'Shadow warrior') continue;
                if (npc.health > 0 && npc.inCombat) { seen.add(npc.index); dead.delete(npc.index); }
                if (npc.health === 0 && npc.totalHealth > 0 && seen.has(npc.index) && !dead.has(npc.index)) {
                    record('dead', npc.index);
                    dead.add(npc.index);
                }
            }
        });
        g.runner.start({ ...meta, create: () => bot });
    });
    const deadline = Date.now() + 6 * 60_000;
    let transitions: { ms: number; ticks: number }[] = [];
    while (Date.now() < deadline) {
        const sample = await page.evaluate(() => {
            const g = Reflect.get(globalThis as object, 'rs2b0t');
            return { events: Reflect.get(globalThis as object, 'fighterTiming') as { kind: string; at: number; tick: number; index: number; combat: boolean }[],
                state: g.runner.state, task: g.runner.bot?.activeTaskName, logs: g.runner.ctx?.log.slice(-8).map((line: { msg: string }) => line.msg), chat: g.reader.chat(6).map((line: { text: string }) => line.text) };
        });
        samples.push(sample);
        await writeFile(`${output}/latest.json`, JSON.stringify(sample, null, 2));
        transitions = sample.events.filter(event => event.kind === 'dead').flatMap(death => {
            const next = sample.events.find(event => event.kind === 'attack' && event.index !== death.index && event.at >= death.at);
            return next ? [{ ms: Math.round(next.at - death.at), ticks: next.tick - death.tick }] : [];
        });
        assert(!['stopped', 'crashed', 'error'].includes(sample.state), JSON.stringify(sample));
        if (transitions.length >= 4) break;
        await page.waitForTimeout(1000);
    }
    assert(transitions.length >= 4, `Only ${transitions.length} transitions observed`);
    assert(transitions.every(gap => gap.ticks <= 2), JSON.stringify(transitions));
    await page.screenshot({ path: `${output}/final.png` });
    console.log(`PASS: ${output} ${JSON.stringify(transitions)}`);
} finally {
    await writeFile(`${output}/proof.json`, JSON.stringify(samples, null, 2));
    await stopScript(page).catch(() => {});
    await browser.close();
    rmSync(deployed, { recursive: true, force: true });
    rmSync(html, { force: true });
}
