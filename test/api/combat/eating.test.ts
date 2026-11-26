import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { eatSelectedFood } from '#/bot/api/combat/eating.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';

afterEach(() => mock.restore());

test('a disappearing slice confirms a bite even at full hitpoints', async () => {
    let slices = 2;
    const food = new InvItem({ name: 'Slice of cake', id: 1895, count: 1, slot: 1, comId: 1, ops: ['Eat'] });
    spyOn(Skills, 'effective').mockReturnValue(30);
    spyOn(Skills, 'hpFraction').mockReturnValue(1);
    spyOn(Inventory, 'countById').mockImplementation(() => slices);
    spyOn(food, 'interact').mockImplementation(async () => { slices--; return true; });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async ready => ready());
    spyOn(Execution, 'delayUntil').mockImplementation(async ready => ready());

    expect(await eatSelectedFood({ setStatus() {} }, food, 'bite')).toBe(true);
    expect(await eatSelectedFood({ setStatus() {} }, food, 'heal')).toBe(false);
});
