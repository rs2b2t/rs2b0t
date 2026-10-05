import { expect, test } from 'bun:test';
import { emptyMemory, enabledSkills, planNext, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import { ActionQueue, activityActions, describeActivity } from '#/bot/scripts/AccountLeveler/actions.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (): LevelerSnapshot => ({ levels: Object.fromEntries(enabledSkills.map(skill => [skill, skill === 'hitpoints' ? 10 : 1])), stock: {coins: 100000}, quests:{}, bankReady:true, target:40, wilderness:true, now:1000 });

test('a food dependency preserves the chosen fish, cook, combat sequence through bank refreshes', () => {
    const s=snapshot();
    const decision=planNext(s,{...emptyMemory(), objective:'attack'},()=>0);
    expect(decision.kind).toBe('activity');
    if(decision.kind!=='activity')return;
    expect(decision.queue.map(plan=>plan.script)).toEqual(['Fisher','CookBot','AutoFighter']);
    s.stock['raw shrimps']=28;
    const next=resolveActivity(s,decision.queue[1],emptyMemory(),()=>0.99);
    expect(next.kind==='activity'&&next.plan.script).toBe('CookBot');
    expect(decision.queue[2].id).toBe('lumbridge-chickens');
});

test('action preview explains the shopping destination and why fishing is queued', () => {
    const s=snapshot();
    const decision=planNext(s,{...emptyMemory(),objective:'attack'},()=>0);
    if(decision.kind!=='activity')throw new Error('expected activity');
    const actions=activityActions(decision.plan,s,decision.queue.slice(1));
    expect(actions.find(a=>a.id==='shop:Gerrant')?.detail).toContain('Small fishing net');
    expect(actions.find(a=>a.id==='shop:Gerrant')?.destination).toMatchObject({x:3013,z:3224});
    expect(describeActivity(decision.plan)).toContain('28 Raw shrimps');
    expect(actions.some(a=>a.label.includes('cook'))).toBe(true);
    expect(actions.some(a=>a.label.includes('Chicken'))).toBe(true);
});

test('queue advances from real events, retains failures and caps action history', () => {
    const queue=new ActionQueue();
    queue.reset([{id:'shop:Bob',label:'Shop at Bob',detail:'Bronze axe'}, {id:'loadout',label:'Withdraw kit',detail:'Bronze axe'}]);
    queue.update({id:'shop:Bob',message:'Walking to Bob',state:'running'},1000);
    queue.update({id:'shop:Bob',message:'Bought Bronze axe',state:'done'},2000);
    queue.update({id:'loadout',message:'Withdrawing Bronze axe',state:'running',destination:{x:3200,z:3200,level:0}},3000);
    expect(queue.items.map(a=>a.state)).toEqual(['done','running']);
    queue.fail('Bank did not open',4000);
    expect(queue.items[1].state).toBe('failed');
    expect(queue.destination).toBeUndefined();
    expect(queue.history.at(-1)?.message).toContain('Bank did not open');
    for(let i=0;i<100;i++)queue.note(`walk ${i}`,5000+i);
    expect(queue.history.length).toBeLessThanOrEqual(40);
});

test('queued goals are revalidated while combat supply dependencies remain eligible', async () => {
    const { canResumeObjective }=await import('#/bot/scripts/AccountLeveler/priority.js');
    const s=snapshot();
    Object.assign(s.levels,{attack:25,strength:20,defence:5});
    expect(canResumeObjective(s.levels,s.target,'agility')).toBe(false);
    expect(canResumeObjective(s.levels,s.target,'attack')).toBe(false);
    expect(canResumeObjective(s.levels,s.target,'defence')).toBe(true);
    for(const skill of ['attack','strength','defence','hitpoints','ranged','magic','prayer'])s.levels[skill]=40;
    expect(canResumeObjective(s.levels,s.target,'agility')).toBe(true);
});
