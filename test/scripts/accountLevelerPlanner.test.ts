import { expect, test } from 'bun:test';
import { planNext, scimitarFor, enabledSkills, emptyMemory } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';
import { combatPlan } from '#/bot/scripts/AccountLeveler/combat.js';

const fresh = (): LevelerSnapshot => ({ levels: Object.fromEntries(enabledSkills.map(s => [s, s === 'hitpoints' ? 10 : 1])), stock: { coins: 100000 }, bankReady: true, quests: {}, target: 40, wilderness: true, now: 1000 });
const trained = () => ({ ...fresh(), levels: Object.fromEntries(enabledSkills.map(s => [s, 40])) });

test('completion covers every enabled skill and ignores disabled Slayer', () => {
    expect(planNext(trained(), emptyMemory(), () => 0).kind).toBe('complete');
    for (const skill of enabledSkills) {
        const snapshot = trained(); snapshot.levels[skill] = 1;
        expect(planNext(snapshot, emptyMemory(), () => 0).kind).not.toBe('complete');
    }
});

test('an unread bank cannot turn into a missing-supplies decision', () => {
    expect(planNext({ ...fresh(), bankReady: false }, emptyMemory(), () => 0).kind).toBe('refresh');
});

test('early combat starts without making food first', () => {
    const memory = { ...emptyMemory(), objective: 'attack' };
    const result = planNext(fresh(), memory, () => 0);
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.plan.script).toBe('AutoFighter');
    expect(result.plan.deathWalk).toBe(true);
    expect(result.queue.map(plan => plan.script)).toEqual(['AutoFighter']);
});

test('cooking uses banked raw fish before gathering more', () => {
    const snapshot = fresh(); Object.assign(snapshot.levels,{attack:20,strength:20,defence:20,hitpoints:25}); snapshot.stock['raw shrimps'] = 100;
    const result = planNext(snapshot, { ...emptyMemory(), objective: 'attack' }, () => 0);
    expect(result.kind === 'activity' && result.plan.script).toBe('CookBot');
});

test('fletching still gathers logs when woodcutting already reached 40', () => {
    const snapshot = trained(); snapshot.levels.fletching = 1;
    const result = planNext(snapshot, { ...emptyMemory(), objective: 'fletching' }, () => 0);
    expect(result.kind === 'activity' && result.plan.script).toBe('Woodcutter');
});

test('herblore schedules only its required quest', () => {
    const snapshot = trained(); snapshot.levels.herblore = 1; snapshot.stock.shrimps = 100;
    const result = planNext(snapshot, { ...emptyMemory(), objective: 'herblore' }, () => 0);
    expect(result.kind === 'activity' && result.plan.settings.quests).toEqual(['druid']);
});

test('scimitar upgrades never request stock Zeke does not sell', () => {
    expect([1, 5, 10, 20, 30, 40].map(scimitarFor)).toEqual(['Iron scimitar', 'Steel scimitar', 'Steel scimitar', 'Mithril scimitar', 'Mithril scimitar', 'Mithril scimitar']);
});

test('herbs use the unidentified guam id rather than every item named Herb', () => {
    const snapshot = trained(); snapshot.levels.herblore = 3; snapshot.quests['Druidic Ritual'] = true;
    snapshot.stock['#201'] = 100; snapshot.stock.shrimps = 100;
    const result = planNext(snapshot, { ...emptyMemory(), objective: 'herblore' }, () => 0);
    expect(result.kind === 'activity' && result.plan.script).toBe('AutoFighter');
    snapshot.stock['#199'] = 30;
    const clean = planNext(snapshot, { ...emptyMemory(), objective: 'herblore' }, () => 0);
    expect(clean.kind === 'activity' && clean.plan.script).toBe('HerbCleaner');
});

test('zero banked coins blocks a needed purchase with the missing item named', () => {
    const snapshot = trained(); snapshot.levels.fishing = 1; snapshot.stock.coins = 0;
    const result = planNext(snapshot, { ...emptyMemory(), objective: 'fishing' }, () => 0);
    expect(result.kind).toBe('blocked');
    expect(result.kind === 'blocked' && result.reason).toContain('Small fishing net');
});

test.each([{ level: 1, unstrung: 50, strung: 841, name: 'Shortbow' }, { level: 5, unstrung: 54, strung: 843, name: 'Oak shortbow' }])(
    'unstrung bows do not fund a ranged kit: %j', ({ level, unstrung, strung, name }) => {
        const snapshot = trained();
        snapshot.levels.ranged = level;
        snapshot.stock = { coins: 0, shrimps: 30, 'bronze arrow': 300, [name.toLowerCase()]: 20, [`#${unstrung}`]: 20 };
        const blocked = planNext(snapshot, emptyMemory(), () => 0);
        expect(blocked.kind).toBe('blocked');
        expect(blocked.kind === 'blocked' && blocked.reason).toContain('Shortbow');
        snapshot.stock[`#${strung}`] = 1;
        const ready = planNext(snapshot, emptyMemory(), () => 0);
        expect(ready.kind === 'activity' && ready.plan.script).toBe('AutoFighter');
    }
);

test('cowhide gathering selects cows and loots their hides', () => {
    const plan = combatPlan(trained(), 'crafting', emptyMemory(), () => 0, 'Cow hide');
    expect(plan?.settings.target).toBe('Cow');
    expect(plan?.settings.loot).toContain('Cow hide');
});

test('a shopping dependency accounts for travel money before selecting an unaffordable activity', () => {
    const s=trained();s.levels.fishing=1;s.stock={coins:100};
    const result=planNext(s,emptyMemory(),()=>0);
    expect(result.kind).toBe('blocked');
    expect(result.kind==='blocked'&&result.reason).toContain('budget 230');
});

test('identical fresh accounts can draw both combat and gathering tasks in different locations', () => {
    const s = fresh();
    const objectives = new Set<string>();
    const destinations = new Set<string>();
    for (let i = 0; i < enabledSkills.length; i++) {
        const decision = planNext(s, emptyMemory(), () => (i + 0.5) / enabledSkills.length);
        if (decision.kind !== 'activity') throw new Error(JSON.stringify(decision));
        objectives.add(decision.plan.objective);
        destinations.add(JSON.stringify(decision.plan.travel));
    }
    for (const skill of ['strength', 'mining', 'fishing', 'woodcutting']) expect(objectives.has(skill)).toBe(true);
    expect(destinations.size).toBeGreaterThan(4);
});

test('a blocked combat draw falls through to another unfinished skill', () => {
    const s = trained();
    s.levels.attack = 20;
    s.levels.woodcutting = 1;
    s.stock = { coins: 0, 'bronze axe': 1 };
    expect(planNext(s, emptyMemory(), () => 0)).toMatchObject({ kind: 'activity', plan: { objective: 'woodcutting' } });
});

test('a saved skilling objective can resume while melee is unfinished', () => {
    expect(planNext(fresh(), { ...emptyMemory(), objective: 'woodcutting' }, () => 0))
        .toMatchObject({ kind: 'activity', plan: { objective: 'woodcutting', script: 'Woodcutter' } });
});

test('legacy shrimp cooldowns cannot block the food dependency for every melee objective', () => {
    const s = fresh(); Object.assign(s.levels,{attack:20,strength:20,defence:20,hitpoints:25});
    const memory = { ...emptyMemory(), cooldowns: { 'fish-shrimps': s.now + 900000 } };
    const decision = planNext(s, memory, () => 0);
    expect(decision.kind).toBe('activity');
    expect(decision.kind === 'activity' && decision.plan.script).toBe('Fisher');
});

test('after a session a different runnable objective gets the next turn', () => {
    const s = trained();
    Object.assign(s.levels, { attack: 20, woodcutting: 1 });
    s.stock.shrimps = 100;
    const memory = { ...emptyMemory(), attempted: { attack: 999 } };
    expect(planNext(s, memory, () => 0)).toMatchObject({ plan: { objective: 'woodcutting' } });
    s.levels.woodcutting = s.target;
    expect(planNext(s, memory, () => 0)).toMatchObject({ plan: { objective: 'attack' } });
});

test('melee rotates at paired five-level milestones, upgrades weapons and then catches up Defence', () => {
    const s = { ...trained(), target: 60, allowQuests: false };
    Object.assign(s.levels, { attack: 1, strength: 1, defence: 1 });
    Object.assign(s.stock, { lobster: 100, 'black scimitar': 1, 'adamant scimitar': 1, 'rune scimitar': 1 });
    const memory = { ...emptyMemory(), objective: 'defence' };
    const weapons = ['Iron', 'Steel', 'Black', 'Black', 'Mithril', 'Mithril', 'Adamant', 'Adamant', 'Rune'];
    for (let level = 5; level <= 40; level += 5) {
        for (const skill of ['strength', 'attack']) {
            const decision = planNext(s, memory, () => 0);
            expect(decision).toMatchObject({ kind: 'activity', plan: {
                objective: skill, settings: { meleeStyle: skill }, prerequisiteLevels: { [skill]: level }
            } });
            if (decision.kind !== 'activity') throw new Error('Expected a melee activity');
            expect(decision.plan.needs).toContainEqual({ item: weapons[Math.floor(s.levels.attack / 5)] + ' scimitar', count: 1, carry: 1, equip: true });
            s.levels[skill] = level;
            memory.objective = skill;
        }
    }
    expect(planNext(s, memory, () => 0)).toMatchObject({ plan: {
        objective: 'defence', settings: { meleeStyle: 'defence' }, needs: expect.arrayContaining([expect.objectContaining({ item: 'Rune scimitar', equip: true })])
    } });
});

test('uneven melee levels catch up to the next milestone and respect a lower profile target', () => {
    const s = { ...trained(), target: 23, allowQuests: false };
    Object.assign(s.levels, { attack: 17, strength: 32, defence: 7 });
    s.stock.lobster = 100;
    const memory = { ...emptyMemory(), objective: 'defence' };
    expect(planNext(s, memory, () => 0)).toMatchObject({ plan: { objective: 'attack', prerequisiteLevels: { attack: 20 } } });
    s.levels.attack = 20;
    expect(planNext(s, memory, () => 0)).toMatchObject({ plan: { objective: 'attack', prerequisiteLevels: { attack: 23 } } });
    s.levels.attack = 23;
    expect(planNext(s, memory, () => 0)).toMatchObject({ plan: { objective: 'defence' } });
});
