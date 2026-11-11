import { expect, test } from 'bun:test';
import { restockTravelSupplies } from '#/bot/scripts/AutoFighter/travelSupplies.js';

test('banking replenishes spent fares and consumed ropes without duplicating the carried axe', async () => {
    const held: Record<string, number> = { Coins: 95, 'Bronze axe': 1, Rope: 0 };
    const bank: Record<string, number> = { Coins: 5000, Rope: 2 };
    const missing = await restockTravelSupplies([{ item: 'Coins', count: 1200 }, { item: 'Bronze axe', count: 1 }, { item: 'Rope', count: 1 }], {
        count: item => held[item] ?? 0,
        withdraw: async (item, target) => {
            const amount = Math.min(target - (held[item] ?? 0), bank[item] ?? 0);
            bank[item] -= amount;
            held[item] = (held[item] ?? 0) + amount;
        }
    });
    expect(missing).toBeNull();
    expect(held).toEqual({ Coins: 1200, 'Bronze axe': 1, Rope: 1 });
    expect(bank).toEqual({ Coins: 3895, Rope: 1 });
});

test('an incomplete withdrawal reports the missing travel item before returning to camp', async () => {
    const held = { Coins: 100 };
    const missing = await restockTravelSupplies([{ item: 'Coins', count: 1200 }], {
        count: () => held.Coins,
        withdraw: async () => { held.Coins += 200; }
    });
    expect(missing).toBe('Coins');
});
