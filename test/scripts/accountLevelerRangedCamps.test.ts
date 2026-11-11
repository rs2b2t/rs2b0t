import { expect, test } from 'bun:test';
import { COMBAT_CAMPS, combatPlan } from '#/bot/scripts/AccountLeveler/combat.js';
import { emptyMemory, enabledSkills } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, 99])),
    stock: { coins: 1000000, lobster: 100, 'climbing boots': 1, 'dusty key': 1, 'dragonfire shield': 1 },
    bankReady: true, quests: Object.fromEntries(COMBAT_CAMPS.flatMap(camp => camp.quests ?? []).map(quest => [quest, true])),
    target: 99, wilderness: true, now: 1000
});
const isolate = (id: string) => ({ ...emptyMemory(), cooldowns: Object.fromEntries(COMBAT_CAMPS.filter(camp => camp.id !== id).map(camp => [camp.id, 2000])) });

test.each([
    'edgeville-dungeon-giants', 'rimmington-hobgoblins', 'wilderness-hobgoblins', 'ardougne-moss-giants',
    'burthorpe-guards', 'crandor-moss-giants', 'canifis-south-ghouls', 'gu-tanoth-ogres',
    'karamja-lesser-demons', 'crandor-lesser-demons', 'troll-stronghold-trolls', 'gu-tanoth-city-guards',
    'brimhaven-dungeon-moss-giants', 'brimhaven-dungeon-fire-giants'
])('ranged excludes %s without enforced safespot behaviour, even at maximum stats', id => {
    const s = snapshot();
    const memory = isolate(id);
    expect(combatPlan(s, 'attack', memory, () => 0)?.id).toBe(id);
    expect(combatPlan(s, 'magic', memory, () => 0)?.id).toBe(id);
    expect(combatPlan(s, 'ranged', memory, () => 0)).toBeNull();
});

test('ranged keeps rotating lower camps when higher groups are unlocked', () => {
    const s = snapshot();
    const memory = emptyMemory();
    const targets = new Set<string>();
    for (let i = 0; i < 100; i++) {
        const plan = combatPlan(s, 'ranged', memory, () => i / 100);
        expect(plan).not.toBeNull();
        expect(['Guard', 'Bear', 'Zombie', 'Skeleton', 'Warrior woman', 'Chaos druid', 'Unicorn', 'Scorpion', 'Khazard trooper', 'Soldier', 'Pirate', 'Thief']).toContain(String(plan!.settings.target));
        targets.add(String(plan!.settings.target));
        memory.recent = [...memory.recent, plan!.id].slice(-6);
    }
    expect(targets.size).toBeGreaterThan(1);
});

test('cooldowns and resource selection cannot force ranged into an unsafe higher group', () => {
    const s = snapshot();
    const memory = isolate('taverley-surface-druids');
    expect(combatPlan(s, 'ranged', memory, () => 0)).toBeNull();
    expect(combatPlan(s, 'ranged', memory, () => 0, '#199')).toBeNull();
    expect(combatPlan(s, 'attack', memory, () => 0, '#199')?.id).toBe('taverley-surface-druids');
});
