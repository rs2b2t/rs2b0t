// test/api/periodic-bank.test.ts
import { expect, test } from 'bun:test';
import { PeriodicBank } from '#/bot/api/tasks/PeriodicBank.js';
import { Banking } from '#/bot/api/Banking.js';
import { Game } from '#/bot/api/Game.js';

function make(over: Partial<ConstructorParameters<typeof PeriodicBank>[0]> = {}) {
    return new PeriodicBank({
        strategy: () => 'items', itemsThreshold: () => 5, minutesThreshold: () => 999,
        countLoot: () => 10, deposit: () => true, ...over
    } as any);
}

test('off strategy never validates', () => {
    expect(make({ strategy: () => 'off' }).validate()).toBe(false);
});
test('validates when the strategy trips and out of combat', () => {
    const spy = (Game as any).inCombat; (Game as any).inCombat = () => false;
    expect(make().validate()).toBe(true);
    (Game as any).inCombat = spy;
});
test('never validates in combat', () => {
    const spy = (Game as any).inCombat; (Game as any).inCombat = () => true;
    expect(make().validate()).toBe(false);
    (Game as any).inCombat = spy;
});
test('execute calls bankNearest with the deposit filter + returnTo, then resets timer', async () => {
    let called: any = null;
    const spy = Banking.bankNearest; (Banking as any).bankNearest = async (o: any) => { called = o; return true; };
    const gspy = (Game as any).inCombat; (Game as any).inCombat = () => false;
    const dep = () => true;
    const task = make({ deposit: dep, returnTo: () => ({ x: 1, z: 2, level: 0 }) });
    await task.execute();
    expect(called.deposit).toBe(dep);
    expect(called.returnTo).toEqual({ x: 1, z: 2, level: 0 });
    (Banking as any).bankNearest = spy; (Game as any).inCombat = gspy;
});
