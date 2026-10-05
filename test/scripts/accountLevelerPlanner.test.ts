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

test('combat with no supplies first produces food without a combat dependency cycle', () => {
    const memory = { ...emptyMemory(), objective: 'attack' };
    const result = planNext(fresh(), memory, () => 0);
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.plan.script).toBe('Fisher');
    expect(result.plan.output?.item).toBe('Raw shrimps');
    expect(result.plan.needs.some(n => n.item === 'Small fishing net')).toBe(true);
});

test('cooking uses banked raw fish before gathering more', () => {
    const snapshot = fresh(); snapshot.stock['raw shrimps'] = 100;
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

test('unfinished melee takes priority over an older saved skilling objective', () => {
    const s=fresh();s.stock.shrimps=100;
    const memory={...emptyMemory(),objective:'agility',attempted:{attack:999,strength:999,defence:999}};
    for(const random of [0,0.3,0.8,0.99]) {
        const next=planNext(s,memory,()=>random);
        expect(next.kind).toBe('activity');
        if(next.kind==='activity') {
            expect(['attack','strength','defence']).toContain(next.plan.objective);
            expect(next.plan.script).toBe('AutoFighter');
        }
    }
});

test('low Defence supersedes a saved higher-level Attack objective', () => {
    const s=fresh();s.stock.shrimps=100;
    Object.assign(s.levels,{attack:30,strength:25,defence:5});
    const next=planNext(s,{...emptyMemory(),objective:'attack'},()=>0);
    expect(next.kind==='activity'&&next.plan.objective).toBe('defence');
    expect(next.kind==='activity'&&next.plan.settings.meleeStyle).toBe('defence');
});

test('food production serves the combat objective even when the saved goal was skilling', () => {
    const next=planNext(fresh(),{...emptyMemory(),objective:'woodcutting'},()=>0);
    expect(next.kind==='activity'&&next.plan.script).toBe('Fisher');
    expect(next.kind==='activity'&&next.plan.objective).toBe('attack');
});

test('other combat stats precede skilling after melee reaches the target', () => {
    const s=fresh();s.stock.shrimps=100;
    Object.assign(s.levels,{attack:40,strength:40,defence:40});
    const next=planNext(s,{...emptyMemory(),objective:'runecraft'},()=>0);
    expect(next.kind==='activity'&&['hitpoints','ranged','magic','prayer'].includes(next.plan.objective)).toBe(true);
});

test('skilling unlocks once combat reaches the configured target', () => {
    const s=fresh();s.target=10;
    for(const skill of ['attack','strength','defence','hitpoints','ranged','magic','prayer'])s.levels[skill]=10;
    const next=planNext(s,{...emptyMemory(),objective:'woodcutting'},()=>0);
    expect(next.kind==='activity'&&next.plan.objective).toBe('woodcutting');
});

test('blocked combat does not send a fragile account on an unrelated training trip', () => {
    const s=fresh();s.stock={coins:0,'bronze axe':1};
    const next=planNext(s,{...emptyMemory(),objective:'woodcutting'},()=>0);
    expect(next.kind).toBe('blocked');
});
