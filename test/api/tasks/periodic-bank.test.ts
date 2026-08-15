/* eslint-disable @typescript-eslint/no-explicit-any -- Game/Banking singletons are
   monkey-patched per test; typed shims would re-state the surface for no safety. */
import { expect, test } from 'bun:test';
import { PeriodicBank } from '#/bot/api/tasks/PeriodicBank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Game } from '#/bot/api/game/Game.js';
import { Execution } from '#/bot/api/execution/Execution.js';

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
test('execute forwards the RAW own predicate + commonJunk=true (default) so bankNearest composes once', async () => {
    let called: any = null;
    const spy = Banking.bankNearest; (Banking as any).bankNearest = async (o: any) => { called = o; return true; };
    const gspy = (Game as any).inCombat; (Game as any).inCombat = () => false;
    const dep = (n: string) => n === 'mine';
    const task = make({ deposit: dep, returnTo: () => ({ x: 1, z: 2, level: 0 }) });
    await task.execute();
    expect(called.deposit('mine')).toBe(true);
    expect(called.deposit('uncut sapphire')).toBe(false);
    expect(called.deposit('rune scimitar')).toBe(false);
    expect(called.commonJunk).toBe(true);
    expect(called.returnTo).toEqual({ x: 1, z: 2, level: 0 });
    (Banking as any).bankNearest = spy; (Game as any).inCombat = gspy;
});
test('execute forwards commonJunk=false so the junk opt-out reaches bankNearest', async () => {
    let called: any = null;
    const spy = Banking.bankNearest; (Banking as any).bankNearest = async (o: any) => { called = o; return true; };
    const gspy = (Game as any).inCombat; (Game as any).inCombat = () => false;
    const dep = (n: string) => n === 'mine';
    const task = make({ deposit: dep, commonJunk: () => false });
    await task.execute();
    expect(called.deposit('mine')).toBe(true);
    expect(called.deposit('uncut sapphire')).toBe(false);
    expect(called.commonJunk).toBe(false);
    (Banking as any).bankNearest = spy; (Game as any).inCombat = gspy;
});
test('execute forwards the after-deposit bank hook', async () => {
    let called: any = null;
    const spy = Banking.bankNearest; (Banking as any).bankNearest = async (o: any) => { called = o; return true; };
    const afterDeposit = async () => {};
    await make({ afterDeposit }).execute();
    expect(called.afterDeposit).toBe(afterDeposit);
    (Banking as any).bankNearest = spy;
});
test('execute forwards an explicit bank destination', async () => {
    let called: any = null;
    const spy = Banking.bankNearest; (Banking as any).bankNearest = async (o: any) => { called = o; return true; };
    const destination = { name: 'Al Kharid', tile: { x: 3269, z: 3167, level: 0 } };
    await make({ destination: () => destination }).execute();
    expect(called.destination).toEqual(destination);
    (Banking as any).bankNearest = spy;
});
test('execute logs a durable completion marker after successful banking', async () => {
    const messages: string[] = [];
    const spy = Banking.bankNearest; (Banking as any).bankNearest = async () => true;
    await make({ log: message => messages.push(message) }).execute();
    expect(messages).toContain('periodic bank: completed');
    (Banking as any).bankNearest = spy;
});
test('backs off ALL strategies after a failed (unreachable-bank) attempt', async () => {
    const bspy = Banking.bankNearest; (Banking as any).bankNearest = async () => false;
    const gspy = (Game as any).inCombat; (Game as any).inCombat = () => false;
    const dspy = Execution.delayTicks; (Execution as any).delayTicks = async () => {};
    const task = make();
    expect(task.validate()).toBe(true);
    await task.execute();
    expect(task.validate()).toBe(false);
    (Banking as any).bankNearest = bspy; (Game as any).inCombat = gspy; (Execution as any).delayTicks = dspy;
});

test('PeriodicBankOptions accepts a commonJunk getter (type-level + default include)', () => {
    const base = {
        strategy: () => 'off' as const, itemsThreshold: () => 1, minutesThreshold: () => 1,
        countLoot: () => 0, deposit: (_n: string) => false
    };
    expect(new PeriodicBank(base)).toBeDefined();
    expect(new PeriodicBank({ ...base, commonJunk: () => false })).toBeDefined();
});
