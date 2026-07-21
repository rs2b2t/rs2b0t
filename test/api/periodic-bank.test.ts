// test/api/periodic-bank.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- Game/Banking singletons are
   monkey-patched per test; typed shims would re-state the whole surface for no safety. */
import { expect, test } from 'bun:test';
import { PeriodicBank } from '#/bot/api/tasks/PeriodicBank.js';
import { Banking } from '#/bot/api/Banking.js';
import { Game } from '#/bot/api/Game.js';
import { Execution } from '#/bot/api/Execution.js';

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
    // bankNearest gets the RAW own predicate — NOT pre-composed with the junk list.
    expect(called.deposit('mine')).toBe(true);             // bot's own predicate
    expect(called.deposit('uncut sapphire')).toBe(false);  // raw own does NOT include common junk
    expect(called.deposit('rune scimitar')).toBe(false);   // neither → kept
    expect(called.commonJunk).toBe(true);                  // default flag forwarded (bankNearest composes)
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
    expect(called.deposit('mine')).toBe(true);             // own predicate still honoured
    expect(called.deposit('uncut sapphire')).toBe(false);  // raw own excludes common
    expect(called.commonJunk).toBe(false);                 // opt-out plumbed end-to-end
    (Banking as any).bankNearest = spy; (Game as any).inCombat = gspy;
});
test('backs off ALL strategies after a failed (unreachable-bank) attempt', async () => {
    const bspy = Banking.bankNearest; (Banking as any).bankNearest = async () => false;
    const gspy = (Game as any).inCombat; (Game as any).inCombat = () => false;
    const dspy = Execution.delayTicks; (Execution as any).delayTicks = async () => {}; // no scheduler in tests
    const task = make(); // items strategy: countLoot 10 >= itemsThreshold 5 → would trip
    expect(task.validate()).toBe(true);       // trips before any attempt
    await task.execute();                      // bank unreachable → sets failure backoff
    expect(task.validate()).toBe(false);       // suppressed despite still-carried loot
    (Banking as any).bankNearest = bspy; (Game as any).inCombat = gspy; (Execution as any).delayTicks = dspy;
});

test('PeriodicBankOptions accepts a commonJunk getter (type-level + default include)', () => {
    // Construct with commonJunk omitted and present; both must type-check and construct.
    const base = {
        strategy: () => 'off' as const, itemsThreshold: () => 1, minutesThreshold: () => 1,
        countLoot: () => 0, deposit: (_n: string) => false
    };
    expect(new PeriodicBank(base)).toBeDefined();
    expect(new PeriodicBank({ ...base, commonJunk: () => false })).toBeDefined();
});
