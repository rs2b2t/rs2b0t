import { expect, test } from 'bun:test';
import { foodCount } from '#/bot/api/combat/food.js';

for (const name of ['Lobster', 'Shark']) {
    test(`noted ${name} does not count as edible food`, () => {
        const items = [{ name, noted: true, count: 100 }, { name, noted: false, count: 1 }];
        expect(foodCount(items, name)).toBe(1);
        expect(foodCount(items.slice(0, 1), name)).toBe(0);
    });
}

test('partial foods still count without Eat actions in the bank view', () => {
    const items = [
        { name: 'Cake', noted: true, ops: ['Deposit-All'] },
        { name: '2/3 cake', noted: false, ops: ['Deposit-All'] },
        { name: 'Slice of cake', noted: false, ops: ['Deposit-All'] }
    ];
    expect(foodCount(items, 'Cake')).toBe(2);
});
