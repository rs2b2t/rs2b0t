import { expect, test } from 'bun:test';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory, type InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import AIOQuester from '#/bot/scripts/AIOQuester/AIOQuester.js';

function food(
    name: string,
    onInteract: (action: string) => void
): InvItem {
    return {
        name,
        actions: () => ['Eat'],
        interact: async (action: string) => {
            onInteract(action);
            return true;
        }
    } as unknown as InvItem;
}

test('AIOQuester reselects the fitting mixed-pack food at execution time', async () => {
    const original = {
        items: Inventory.items,
        effective: Skills.effective,
        level: Skills.level,
        delayUntil: Execution.delayUntil
    };
    let hp = 6;
    let inventory: InvItem[] = [];
    const interactions: string[] = [];
    const lobster = food('Lobster', action => interactions.push(`Lobster:${action}`));
    const cake = food('Cake', action => {
        interactions.push(`Cake:${action}`);
        hp = 10;
    });

    try {
        Inventory.items = () => inventory;
        Skills.effective = name => name === 'hitpoints' ? hp : 0;
        Skills.level = name => name === 'hitpoints' ? 10 : 0;
        Execution.delayUntil = async cond => cond();

        const bot = new AIOQuester();
        bot.sustainPolicy = () => ({ foods: ['lobster'] });
        inventory = [lobster, cake];

        expect(bot.shouldEat()).toBe(true);
        await bot.eatOnce();

        expect(interactions).toEqual(['Cake:Eat']);
    } finally {
        Inventory.items = original.items;
        Skills.effective = original.effective;
        Skills.level = original.level;
        Execution.delayUntil = original.delayUntil;
    }
});

test('AIOQuester does not consume a stale selection after inventory changes', async () => {
    const original = {
        items: Inventory.items,
        effective: Skills.effective,
        level: Skills.level,
        delayUntil: Execution.delayUntil
    };
    let inventory: InvItem[] = [];
    const interactions: string[] = [];
    const lobster = food('Lobster', action => interactions.push(`Lobster:${action}`));
    const cake = food('Cake', action => interactions.push(`Cake:${action}`));

    try {
        Inventory.items = () => inventory;
        Skills.effective = name => name === 'hitpoints' ? 6 : 0;
        Skills.level = name => name === 'hitpoints' ? 10 : 0;
        Execution.delayUntil = async cond => cond();

        const bot = new AIOQuester();
        bot.sustainPolicy = () => ({ foods: ['lobster'] });
        inventory = [lobster, cake];

        expect(bot.shouldEat()).toBe(true);
        inventory = [lobster];
        await bot.eatOnce();

        expect(interactions).toEqual([]);
    } finally {
        Inventory.items = original.items;
        Skills.effective = original.effective;
        Skills.level = original.level;
        Execution.delayUntil = original.delayUntil;
    }
});
