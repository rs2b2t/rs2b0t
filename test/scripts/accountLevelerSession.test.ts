import { expect, test } from 'bun:test';
import { LevelerSession } from '#/bot/scripts/AccountLeveler/session.js';
import { emptyMemory } from '#/bot/scripts/AccountLeveler/planner.js';
import type { ActivityPlan } from '#/bot/scripts/AccountLeveler/types.js';
const plan: ActivityPlan = { id:'goblins', label:'goblins', script:'AutoFighter', objective:'attack', needs:[], settings:{}, combat:true };

test('first stall requests a bank reset; repeated failure cools down the camp', () => {
    const session=new LevelerSession(emptyMemory());
    session.start(plan,1000,()=>0);
    expect(session.failure(2000)).toBe('reset');
    session.start(plan,3000,()=>0);
    expect(session.failure(4000)).toBe('rotate');
    expect(session.memory.cooldowns.goblins).toBeGreaterThan(4000);
    expect(session.memory.objective).toBeNull();
});

test('observed progress advances the stall deadline but does not erase the retry budget', () => {
    const session=new LevelerSession(emptyMemory());session.start(plan,0,()=>0);
    session.observe('xp:1',1000);
    expect(session.stalled(180000)).toBe(false);
    expect(session.stalled(182000)).toBe(true);
    session.failure(182000);session.start(plan,183000,()=>0);session.observe('xp:2',184000);
    expect(session.failure(185000)).toBe('rotate');
});

test('finishing a resource dependency retains the objective; finishing training rotates it', () => {
    const session=new LevelerSession(emptyMemory());
    session.start({...plan,id:'logs',output:{item:'Logs',count:28}},0,()=>0);
    session.complete(1000,true);
    expect(session.memory.objective).toBe('attack');
    session.start(plan,2000,()=>0);session.complete(3000,true);
    expect(session.memory.objective).toBeNull();
    expect(session.memory.recent).toContain('goblins');
});

test('death records recovery and repeated deaths exclude the same location', () => {
    const session=new LevelerSession(emptyMemory());session.start(plan,0,()=>0);
    expect(session.death(1000)).toBe('reset');
    session.start(plan,2000,()=>0);
    expect(session.death(3000)).toBe('rotate');
    expect(session.memory.deaths).toBe(2);
});

test('normal resupply keeps its objective without consuming the failure budget', () => {
    const session=new LevelerSession(emptyMemory());
    for(let i=0;i<3;i++) { session.start(plan,i*1000,()=>0);session.resupply(i*1000+500); }
    expect(session.memory.cooldowns).toEqual({});
    expect(session.memory.objective).toBe('attack');
    session.start(plan,5000,()=>0);expect(session.failure(6000)).toBe('reset');
});

test('travel and bank observation do not consume the training budget', () => {
    const session=new LevelerSession(emptyMemory());session.start(plan,0,()=>0);
    session.observe('walked to bank',300000);
    session.observe('walked to camp',1200000);
    expect(session.remainingMs).toBe(600000);
    session.work(10000);
    expect(session.remainingMs).toBe(590000);
});

test('a child starting idle is charged for a full fight while its loop remains pending', async () => {
    const session=new LevelerSession(emptyMemory());session.start(plan,0,()=>0);
    session.sampleWork(1000,false);
    let finish!:()=>void;const child=new Promise<void>(resolve=>{finish=resolve;});
    for(let t=1600;t<=61000;t+=600)session.sampleWork(t,true);
    finish();await child;
    expect(session.remainingMs).toBe(540000);
    session.sampleWork(61600,false);
    expect(session.remainingMs).toBe(540000);
});

test('routine gathering resets twice and reports repeated failure without cooling down food production', () => {
    const session = new LevelerSession(emptyMemory());
    const fish = { ...plan, id: 'fish-shrimps', label: 'fish shrimps', script: 'Fisher', combat: false, output: { item: 'Raw shrimps', count: 28 } };
    for (let attempt = 1; attempt <= 3; attempt++) {
        session.start(fish, attempt * 1000, () => 0);
        expect(session.failure(attempt * 1000 + 500)).toBe(attempt < 3 ? 'reset' : 'stop');
        expect(session.memory.cooldowns).toEqual({});
    }
    expect(session.memory.objective).toBe('attack');
});
