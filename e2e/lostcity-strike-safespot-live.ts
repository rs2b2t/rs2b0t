import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import type { Page } from 'playwright-core';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { getServerVarQuiet, mainlandAccount, relog, startScript, teleTo } from './tutorial/harness.js';

type Tile = { x: number; z: number; level: number };
type Item = { id: number; count: number; name: string };
type Spirit = { id: number; index: number; networkTile: Tile; health: number; totalHealth: number; ops: string[] };
type Cast = { tick: number; tile: Tile | null; spirit: Tile | null; spiritHp: number; spiritMaxHp: number; spell: string; index: number; sent: boolean };
type Api = {
    __rs2b0t: {
        Inventory: { items(): Item[] };
        Equipment: { items(): Item[] };
        Game: { tick(): number; runEnabled(): boolean; autoRetaliateOn(): boolean; castOnNpc(spell: string, npc: { index: number }): Promise<boolean> };
        Skills: { effective(name: string): number; level(name: string): number; xp(name: string): number };
        Prayer: { active(name: string): boolean };
        Quests: { status(name: string): string };
    };
    rs2b0t: {
        actions: { menuAction(op: number, a: number, b: number, c: number): boolean; setRun(on: boolean): boolean };
        reader: { serverTile(): Tile | null; npcs(): Spirit[] };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
    };
    __lostCityProof: { casts: Cast[]; melee: { tick: number; index: number }[] };
};

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 12 });
const tag = `strike${Date.now().toString(36).slice(-5)}`;
const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const SAFE = { x: 2859, z: 9731, level: 0 };
const TRAPPED = { x: 2859, z: 9733, level: 0 };
const FOOD = 20;
const count = (items: Item[], id: number) => items.filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
const sameTile = (a: Tile | null, b: Tile) => a?.x === b.x && a.z === b.z && a.level === b.level;

async function snapshot(page: Page) {
    return page.evaluate(() => {
        const g = globalThis as never as Api;
        const api = g.__rs2b0t;
        return {
            tick: api.Game.tick(), tile: g.rs2b0t.reader.serverTile(), hp: api.Skills.effective('hitpoints'),
            magic: api.Skills.effective('magic'), magicXp: api.Skills.xp('magic'),
            meleeXp: ['attack', 'strength', 'defence'].map(skill => api.Skills.xp(skill)),
            prayer: api.Skills.level('prayer'), protected: api.Prayer.active('Protect from Melee'),
            run: api.Game.runEnabled(), autoRetaliate: api.Game.autoRetaliateOn(),
            inventory: api.Inventory.items().map(({ id, count, name }) => ({ id, count, name })),
            equipment: api.Equipment.items().map(({ id, count, name }) => ({ id, count, name })),
            spirit: g.rs2b0t.reader.npcs().filter(npc => npc.id === 655).map(({ index, networkTile, health, totalHealth }) => ({ index, tile: networkTile, health, totalHealth })),
            quest: api.Quests.status('Lost City'), state: g.rs2b0t.runner.state,
            casts: g.__lostCityProof?.casts ?? [], melee: g.__lostCityProof?.melee ?? [],
            logs: g.rs2b0t.runner.ctx?.log.slice(-24).map(line => line.msg) ?? []
        };
    });
}

async function observeActions(page: Page) {
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        g.__lostCityProof = { casts: [], melee: [] };
        const cast = g.__rs2b0t.Game.castOnNpc.bind(g.__rs2b0t.Game);
        g.__rs2b0t.Game.castOnNpc = async (spell, npc) => {
            const target = g.rs2b0t.reader.npcs().find(n => n.index === npc.index);
            const event = { tick: g.__rs2b0t.Game.tick(), tile: g.rs2b0t.reader.serverTile(), spirit: target?.networkTile ?? null, spiritHp: target?.health ?? 0, spiritMaxHp: target?.totalHealth ?? 0, spell, index: npc.index, sent: false };
            g.__lostCityProof.casts.push(event);
            event.sent = await cast(spell, npc);
            return event.sent;
        };
        const action = g.rs2b0t.actions.menuAction.bind(g.rs2b0t.actions);
        g.rs2b0t.actions.menuAction = (op, a, b, c) => {
            const npc = g.rs2b0t.reader.npcs().find(n => n.index === a && n.id === 655);
            const slot = [242, 209, 309, 852, 793].indexOf(op);
            if (npc && slot >= 0 && npc.ops[slot]?.toLowerCase() === 'attack') g.__lostCityProof.melee.push({ tick: g.__rs2b0t.Game.tick(), index: a });
            return action(op, a, b, c);
        };
    });
}

async function scenario(mode: 'complete' | 'exhaustion') {
    const page = await browser.newPage();
    const user = `${tag}${mode === 'complete' ? 'c' : 'e'}`;
    const casts = mode === 'complete' ? 500 : 1;
    const samples: Record<string, unknown>[] = [];
    try {
        await mainlandAccount(page, base, user, client.page);
        for (const command of ['~clearinv inv', '~clearinv worn', 'setvar zanaris 2', 'setstat woodcutting 36', 'setstat crafting 31',
            'setstat magic 13', 'setstat attack 1', 'setstat strength 1', 'setstat defence 1', 'setstat hitpoints 70', 'setstat prayer 1',
            'give knife 1', 'give iron_axe 1', `give lobster ${FOOD}`, `give mindrune ${casts}`, `give airrune ${casts * 2}`, `give firerune ${casts * 3}`]) {
            assert(await cheatQuiet(page, command), command);
        }
        await relog(page, user);
        await setSettings(page, 'Global', { runAuto: false });
        assert(await page.evaluate(() => (globalThis as never as Api).rs2b0t.actions.setRun(false)));
        assert(await teleTo(page, { x: 2860, z: 9733, level: 0 }, 0));
        assert.equal(await getServerVarQuiet(page, 'zanaris'), 2);
        await observeActions(page);
        const before = await snapshot(page);
        assert.equal(before.magic, 13);
        assert.equal(before.prayer, 1);
        assert.equal(count(before.inventory, 379), FOOD);
        await setSettings(page, 'AIOQuester', { quests: 'zanaris', food: 'Lobster', loadout: '(none)' });
        await startScript(page, 'AIOQuester');
        const deadline = Date.now() + minutes * 60_000;
        let previous = before;
        let safeHp: number | undefined;
        let safeFood: number | undefined;
        let exhaustedAt = 0;
        let printed = 0;
        let spiritSeen = false;
        let successfulCasts = 0;
        let lastTick = -1;
        while (Date.now() < deadline) {
            const current = await snapshot(page);
            assert(!current.protected, 'protection prayer hides safespot damage');
            assert.deepEqual(current.meleeXp, before.meleeXp, 'melee XP changed');
            assert.equal(current.melee.length, 0, 'sent melee Attack on the spirit');
            assert(current.hp > 0, 'player died');
            spiritSeen ||= current.spirit.length > 0;
            for (const cast of current.casts) {
                assert.equal(cast.spell.toLowerCase(), 'fire strike', 'highest castable Strike at Magic 13');
                assert(sameTile(cast.tile, SAFE), `cast outside safespot: ${JSON.stringify(cast)}`);
                assert(sameTile(cast.spirit, TRAPPED), `cast before spirit trapped: ${JSON.stringify(cast)}`);
                assert(cast.spiritMaxHp === 0 || cast.spiritHp > 0, 'cast at a dead spirit');
            }
            if (count(current.inventory, 558) < count(previous.inventory, 558)) {
                successfulCasts += count(previous.inventory, 558) - count(current.inventory, 558);
                assert(sameTile(current.tile, SAFE), 'runes consumed away from safespot');
                safeHp ??= current.hp;
                safeFood ??= count(current.inventory, 379);
            }
            if (safeHp !== undefined && current.spirit.some(npc => npc.totalHealth === 0 || npc.health > 0)) {
                assert(sameTile(current.tile, SAFE), 'left safespot with a living spirit');
                assert(!current.autoRetaliate, 'auto-retaliation remained enabled');
                assert(current.hp >= safeHp, 'spirit damaged the player in the safespot');
                if (sameTile(previous.tile, SAFE)) assert(current.hp >= previous.hp, 'HP decreased between safespot samples');
                assert.equal(count(current.inventory, 379), safeFood, 'food consumed after safespot casting began');
            }
            if (current.tick !== lastTick) {
                samples.push({ tick: current.tick, tile: current.tile, hp: current.hp, food: count(current.inventory, 379), mind: count(current.inventory, 558), air: count(current.inventory, 556), fire: count(current.inventory, 554), magicXp: current.magicXp, spirit: current.spirit });
                lastTick = current.tick;
            }
            if (mode === 'exhaustion' && count(current.inventory, 558) === 0) {
                exhaustedAt ||= Date.now();
                assert(sameTile(current.tile, SAFE), 'rune exhaustion left the safespot');
                if (Date.now() - exhaustedAt >= 15_000) break;
            }
            if (current.quest === 'complete') break;
            assert.notEqual(current.state, 'crashed', 'AIOQuester crashed');
            if (Date.now() - printed >= 10_000) { console.log('STATE', mode, JSON.stringify(current)); printed = Date.now(); }
            previous = current;
            await page.waitForTimeout(100);
        }
        const after = await snapshot(page);
        const stage = await getServerVarQuiet(page, 'zanaris');
        assert(spiritSeen && successfulCasts > 0, 'no real spirit fight or rune-consuming casts observed');
        assert(after.magicXp > before.magicXp, 'no Magic XP from casting');
        assert(count(after.inventory, 379) >= FOOD / 2, 'more than half the selected food was consumed');
        if (mode === 'complete') {
            assert.equal(stage, 6);
            assert.equal(after.quest, 'complete');
            assert.equal(count(after.inventory, 772) + count(after.equipment, 772), 5, 'expected five Dramen staves');
        } else {
            assert(exhaustedAt > 0, 'rune exhaustion was not reached');
            assert.equal(stage, 2);
            assert.equal(successfulCasts, 1);
            assert.equal(count(after.inventory, 558), 0);
            assert(sameTile(after.tile, SAFE));
            assert(!after.autoRetaliate);
            assert(after.logs.some(line => line.includes('no castable Strike spell; holding the Tree Spirit safespot')), 'missing safe exhaustion result');
        }
        assert(!after.inventory.some(item => item.name === 'Kebab'), 'selected food was replaced');
        await mkdir('out', { recursive: true });
        await page.screenshot({ path: `out/lostcity-strike-${mode}.png`, fullPage: true });
        const proof = { result: 'PASS', mode, user, stage, before, after, successfulCasts, safeHp, safeFood, samples };
        await Bun.write(`out/lostcity-strike-${mode}.json`, JSON.stringify(proof, null, 2) + '\n');
        console.log('PASS', mode, JSON.stringify({ stage, successfulCasts, safeHp, safeFood, after }));
        return proof;
    } catch (error) {
        console.log('FAILURE', mode, JSON.stringify(await snapshot(page).catch(() => null)));
        await mkdir('out', { recursive: true });
        await page.screenshot({ path: `out/lostcity-strike-${mode}-failure.png`, fullPage: true }).catch(() => undefined);
        throw error;
    } finally {
        await stopScript(page).catch(() => undefined);
        await logout(page).catch(() => false);
        await page.close();
    }
}

try {
    const complete = await scenario('complete');
    const exhaustion = await scenario('exhaustion');
    await Bun.write('out/lostcity-strike-safespot.json', JSON.stringify({ result: 'PASS', complete, exhaustion }, null, 2) + '\n');
} finally {
    await browser.close();
    client.cleanup();
}
