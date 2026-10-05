import { expect, test } from 'bun:test';
import { levelerLines } from '#/bot/scripts/AccountLeveler/paint.js';
import { ActionQueue } from '#/bot/scripts/AccountLeveler/actions.js';

const queue=new ActionQueue();
queue.reset([{id:'shop:Gerrant',label:'Shop at Gerrant',detail:'Buy a Small fishing net so we can gather food for Attack training'}]);
queue.update({id:'shop:Gerrant',message:'Walking to Gerrant for a Small fishing net',destination:{x:3013,z:3224,level:0},state:'running'},1000);
const view={target:40,levels:{attack:1},completed:0,total:19,objective:'attack',plan:null,status:'Shopping',detail:'Following path to Port Sarim',queue,remainingMs:600000,deaths:0,wilderness:true,bankReady:true,stock:{coins:10000},heldCoins:230,tile:{x:3100,z:3250,level:0},waitingUntil:0,now:61000,startedAt:1000,shoppingBudget:30};

test('paint describes exact action, destination, funding and progress without clipping long lines',()=>{
    const now=levelerLines(view,'Now',48);
    expect(now.lines.map(l=>l.text).join(' ')).toContain('Gerrant');
    expect(now.lines.map(l=>l.text).join(' ')).toContain('3013, 3224');
    expect(now.lines.every(l=>l.text.length<=48)).toBe(true);
    const supplies=levelerLines(view,'Supplies',48);
    expect(supplies.lines.map(l=>l.text).join(' ')).toContain('230');
    expect(supplies.lines.map(l=>l.text).join(' ')).toContain('30gp');
});

test('queue keeps all wrapped action details and focuses the active action',()=>{
    const result=levelerLines(view,'Queue',32);
    expect(result.lines.map(l=>l.text.trim()).join(' ')).toContain('Small fishing net');
    expect(result.lines.map(l=>l.text.trim()).join(' ')).toContain('Attack training');
    expect(result.lines.every(l=>l.text.length<=32)).toBe(true);
    expect(result.focus).toBe(0);
});

test('paint explains combat-first training and the transition to other skills',()=>{
    const phase=(levels:Record<string,number>)=>levelerLines({...view,levels},'Now',100).lines.map(line=>line.text).join(' ');
    expect(phase({attack:1,strength:1,defence:1})).toContain('Build melee stats to 40');
    expect(phase({attack:40,strength:40,defence:40,ranged:1})).toContain('Finish combat stats to 40');
    expect(phase({attack:40,strength:40,defence:40,hitpoints:40,ranged:40,magic:40,prayer:40,agility:1})).toContain('Train remaining skills to 40');
});
