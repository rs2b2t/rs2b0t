import { expect, test } from 'bun:test';
import { combatPlan, COMBAT_CAMPS } from '#/bot/scripts/AccountLeveler/combat.js';
import { dragonPrayer } from '#/bot/scripts/AccountLeveler/dragons.js';
import { emptyMemory, enabledSkills } from '#/bot/scripts/AccountLeveler/planner.js';
import { DROP_DB } from '#/bot/data/dropdb.js';
import { wantsAutoFighterLoot } from '#/bot/scripts/AutoFighter/AutoFighterData.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, 80])),
    stock: { coins: 100000, lobster: 100, 'dragonfire shield': 1, 'dragon longsword': 1, '#861': 1 },
    quests: { 'Lost City': true, 'Dragon Slayer': true }, target: 90, bankReady: true, wilderness: true, now: 1000
});
const isolate = (id: string) => ({ ...emptyMemory(), cooldowns: Object.fromEntries(COMBAT_CAMPS.filter(camp => camp.id !== id).map(camp => [camp.id, 2000])) });

test('hobgoblin combat gathers secondary ingredients and runes without ending the training objective', () => {
    const plan = combatPlan(snapshot(), 'attack', isolate('rimmington-hobgoblins'), () => 0)!;
    expect(plan.objective).toBe('attack');
    expect(plan.output).toBeUndefined();
    const loot = plan.settings.loot as string[];
    for (const name of ['Limpwurt root', 'Herb', 'Ranarr weed', 'Snape grass', 'White berries', "Red spiders' eggs", 'Unicorn horn', 'Unicorn horn dust', 'Eye of newt']) {
        expect(wantsAutoFighterLoot(name, loot, true), name).toBe(true);
    }
    for (const name of ['Air', 'Water', 'Earth', 'Fire', 'Mind', 'Body', 'Chaos', 'Death', 'Blood', 'Law', 'Nature', 'Cosmic', 'Soul']) {
        expect(wantsAutoFighterLoot(`${name} rune`, loot, true), name).toBe(true);
    }
    expect(plan.settings.avoidHerbs).toEqual([]);
    expect(plan.settings.banking).toBe('Auto');
    expect(wantsAutoFighterLoot('Iron sword', loot, true)).toBe(false);
});

test.each(['Dragon longsword', 'Dragon dagger', 'Magic shortbow'])('%s enables special attacks through the combat adapter', weapon => {
    const s = snapshot();
    const ranged = weapon === 'Magic shortbow';
    s.stock['dragon longsword'] = weapon === 'Dragon longsword' ? 1 : 0;
    s.stock['dragon dagger'] = weapon === 'Dragon dagger' ? 1 : 0;
    const plan = combatPlan(s, ranged ? 'ranged' : 'attack', isolate('lumbridge-cows'), () => 0)!;
    expect(plan.needs.some(need => need.item === weapon && need.equip)).toBe(true);
    expect(plan.settings.useSpecial).toBe(true);
});

test.each([0, 0.999])('dragon session %s collects its secondary drops and enables specials', roll => {
    const plan = dragonPrayer(snapshot(), emptyMemory(), () => roll)!;
    const target = plan.script === 'GreenDragon' ? 'Green dragon' : 'Blue dragon';
    const loot = plan.settings.loot as string[];
    expect(loot).toContain('Herb');
    for (const rune of DROP_DB[target].filter(name => name.endsWith(' rune'))) expect(loot, rune).toContain(rune);
    expect(loot).toContain('Dragon bones');
    expect(loot).toContain('Dragonhide');
    expect(loot.every(name => DROP_DB[target].includes(name))).toBe(true);
    expect(plan.settings.useSpecial).toBe(true);
});
