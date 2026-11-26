import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { withdrawTo } from '#/bot/api/bank/withdrawTo.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';

afterEach(() => mock.restore());

test('a rejected Withdraw-X uses fixed quantities to finish the remaining withdrawal', async () => {
    let held = 7;
    const ops: string[] = [];
    spyOn(Inventory, 'count').mockImplementation(() => held);
    spyOn(Inventory, 'isFull').mockReturnValue(false);
    spyOn(Bank, 'withdrawX').mockResolvedValue(false);
    spyOn(Bank, 'withdraw').mockImplementation(async (_name, op = 'Withdraw-1') => {
        ops.push(op);
        held += Number(op.split('-')[1]);
        return true;
    });
    spyOn(Execution, 'delayUntil').mockImplementation(async ready => ready());

    expect(await withdrawTo('Fire rune', 23)).toBe(16);
    expect(ops).toEqual(['Withdraw-10', 'Withdraw-5', 'Withdraw-1']);
});

test('an accepted Withdraw-X with no observed gain stops before another click', async () => {
    spyOn(Inventory, 'count').mockReturnValue(3);
    spyOn(Inventory, 'isFull').mockReturnValue(false);
    spyOn(Bank, 'withdrawX').mockResolvedValue(true);
    const fixed = spyOn(Bank, 'withdraw').mockReturnValue(false);
    expect(await withdrawTo('Fire rune', 20)).toBe(0);
    expect(fixed).not.toHaveBeenCalled();
});
