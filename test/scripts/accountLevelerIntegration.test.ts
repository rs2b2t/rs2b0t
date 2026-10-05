import { expect, test } from 'bun:test';
import '#/bot/scripts/index.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { emptyMemory, enabledSkills, planNext } from '#/bot/scripts/AccountLeveler/planner.js';
import { methodFor, producer } from '#/bot/scripts/AccountLeveler/methods.js';
import { supplyOffer } from '#/bot/scripts/AccountLeveler/offers.js';
import { combatPlan } from '#/bot/scripts/AccountLeveler/combat.js';
import { LevelerSession } from '#/bot/scripts/AccountLeveler/session.js';
import type { ActivityPlan, LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (level=1): LevelerSnapshot => ({ levels:Object.fromEntries(enabledSkills.map(s=>[s,s==='hitpoints'?Math.max(10,level):level])),stock:{coins:100000},bankReady:true,quests:{},target:40,wilderness:true,now:1000 });

function validate(plan:ActivityPlan) {
    const meta=ScriptRegistry.get(plan.script);
    expect(meta,plan.script).toBeDefined();
    for(const [key,value] of Object.entries(plan.settings)) {
        const def=meta?.settingsSchema?.[key];
        expect(def,`${plan.script}.${key}`).toBeDefined();
        if(def?.options?.length && !def.optionsFrom) {
            for(const chosen of Array.isArray(value)?value:[value]) expect(def.options,`${plan.script}.${key}=${chosen}`).toContain(chosen);
        }
    }
    for(const need of plan.needs) {
        if(need.item==='Coins')continue;
        expect(supplyOffer(need.item) || producer(snapshot(40),plan.objective,need,emptyMemory(),()=>0),need.item).toBeTruthy();
    }
}

test('every training adapter uses an installed script and supported settings', () => {
    for(const level of [1,5,20,39]) {
        const s=snapshot(level);
        for(const quests of [false,true]) {
            s.quests={'Druidic Ritual':quests,'Rune Mysteries Quest':quests};
            for(const skill of enabledSkills) {
                const plan=methodFor(s,skill,emptyMemory(),()=>0);
                expect(plan,skill).not.toBeNull();
                if(plan)validate(plan);
            }
        }
    }
});

test('fresh account supplies progress from catching to cooking to equipped combat', () => {
    const s=snapshot();const session=new LevelerSession({...emptyMemory(),objective:'attack'});
    const scripts:string[]=[];
    for(let step=0;step<3;step++) {
        const next=planNext(s,session.memory,()=>0);
        expect(next.kind).toBe('activity');if(next.kind!=='activity')return;
        scripts.push(next.plan.script);validate(next.plan);
        session.start(next.plan,s.now,()=>0);
        for(const need of next.plan.needs) if(supplyOffer(need.item))s.stock[need.item.toLowerCase()]=need.count;
        if(next.plan.output)s.stock[next.plan.output.item.toLowerCase()]=next.plan.output.count;
        session.complete(s.now+100,true);s.now+=1000;
    }
    expect(scripts).toEqual(['Fisher','CookBot','AutoFighter']);
});

test('cooldown and Wilderness preference exclude camps from actual combat selection', () => {
    const s=snapshot(39);s.wilderness=false;
    const memory=emptyMemory();
    for(let i=0;i<30;i++) {
        const plan=combatPlan(s,'attack',memory,()=>i/30);
        expect(plan?.wilderness).not.toBe(true);
    }
    s.wilderness=true;
    const wild=combatPlan(s,'attack',memory,()=>0.999);
    expect(wild?.wilderness).toBe(true);
    if(!wild)return;
    memory.cooldowns[wild.id]=s.now+60000;
    expect(combatPlan(s,'attack',memory,()=>0.999)?.id).not.toBe(wild.id);
});

test('high attack alone does not qualify a fragile account for stronger camps', () => {
    const s=snapshot();s.levels.attack=40;
    for(let i=0;i<20;i++) {
        const plan=combatPlan(s,'attack',emptyMemory(),()=>i/20);
        expect(['lumbridge-chickens','falador-chickens','lumbridge-goblins','lumbridge-men','edgeville-men']).toContain(plan?.id ?? '');
    }
});

test('delegated AutoFighter uses the requested combat style instead of saved standalone settings', async () => {
    const { spyOn } = await import('bun:test');
    const { Game } = await import('#/bot/api/game/Game.js');
    const { SettingsStore } = await import('#/bot/runtime/Settings.js');
    const { Execution } = await import('#/bot/api/execution/Execution.js');
    const { ScriptActivity } = await import('#/bot/runtime/ScriptActivity.js');
    const patches=[spyOn(Execution,'delayUntil').mockImplementation(async cond=>cond()),spyOn(Game,'ingame').mockReturnValue(true),spyOn(Game,'tile').mockReturnValue({x:3220,z:3218,level:0}),
        spyOn(SettingsStore,'displayString').mockReturnValue('melee'),spyOn(SettingsStore,'saved').mockReturnValue('strength')];
    const logs:string[]=[];const activity=new ScriptActivity(message=>logs.push(message));
    try {
        await activity.start(ScriptRegistry.get('AutoFighter')!, {combatStyle:'mage',spell:'Wind Strike',solveClues:false});
        expect(logs.some(line=>line.includes('style mage (Wind Strike'))).toBe(true);
    } finally { activity.stop(); for(const patch of patches)patch.mockRestore(); }
});

test('Crafting 1 uses leather before switching to flax at 10', () => {
    const s=snapshot(39);s.levels.crafting=1;
    const first=methodFor(s,'crafting',emptyMemory(),()=>0);
    expect(first?.script).toBe('LeatherCrafter');
    s.levels.crafting=10;
    expect(methodFor(s,'crafting',emptyMemory(),()=>0)?.script).toBe('FlaxAIO');
});

test('Druidic Ritual first trains combat prerequisites then carries equipment and food', () => {
    const s=snapshot();s.stock.shrimps=100;
    const first=methodFor(s,'herblore',emptyMemory(),()=>0);
    expect(first?.script).toBe('AutoFighter');
    Object.assign(s.levels,{attack:20,strength:20,defence:20,hitpoints:25});
    const quest=methodFor(s,'herblore',emptyMemory(),()=>0);
    expect(quest?.script).toBe('AIOQuester');
    expect(quest?.needs.some(n=>n.item==='Mithril scimitar'&&n.equip)).toBe(true);
    expect(quest?.needs.some(n=>n.item==='Shrimps'&&n.carry===12)).toBe(true);
});

test('Cooking 1 ignores banked trout when choosing a recipe it can cook', () => {
    const s=snapshot(40);s.levels.cooking=1;s.stock.trout=24;
    const plan=methodFor(s,'cooking',emptyMemory(),()=>0);
    expect(plan?.settings.fish).toBe('Raw shrimps');
});
