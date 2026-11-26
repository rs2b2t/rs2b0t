import { expect, test } from 'bun:test';
import { dragonPrayer } from '#/bot/scripts/AccountLeveler/dragons.js';
import { emptyMemory, enabledSkills } from '#/bot/scripts/AccountLeveler/planner.js';
import { provision, type SupplyPort } from '#/bot/scripts/AccountLeveler/supplies.js';
import type { ActivityPlan, LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

function fixture(plan: ActivityPlan) {
    const bank = Object.fromEntries(plan.needs.map(need => [need.item, need.count]));
    const pack: Record<string, number> = {};
    const worn: Record<string, number> = {};
    const stackable = (name: string) => name === 'Coins' || name.endsWith(' rune');
    const used = () => Object.entries(pack).reduce((count, [name, amount]) => count + (stackable(name) ? Number(amount > 0) : amount), 0);
    let peak = 0;
    const port: SupplyPort = {
        bank: async () => true,
        deposit: async () => {
            for (const [name, count] of Object.entries(pack)) {
                bank[name] = (bank[name] ?? 0) + count;
                delete pack[name];
            }
        },
        stock: () => Object.fromEntries(Object.entries(bank).map(([name, count]) => [name.toLowerCase(), count])),
        held: name => pack[name] ?? 0,
        worn: name => worn[name] ?? 0,
        equipment: () => Object.keys(worn),
        unequip: async name => {
            pack[name] = (pack[name] ?? 0) + worn[name];
            delete worn[name];
            return true;
        },
        withdraw: async (name, count) => {
            const slots = stackable(name) ? Number(!pack[name]) : count;
            if ((bank[name] ?? 0) < count || used() + slots > 28) return false;
            bank[name] -= count;
            pack[name] = (pack[name] ?? 0) + count;
            peak = Math.max(peak, used());
            return true;
        },
        closeBank: async () => true,
        walk: async () => true,
        shop: async () => false,
        shopStock: () => 0,
        buy: async () => 0,
        closeShop: async () => {},
        equip: async name => {
            if (!pack[name]) return false;
            worn[name] = pack[name];
            delete pack[name];
            return true;
        },
        log: () => {}
    };
    return { port, pack, worn, peak: () => peak };
}

test.each([
    [false, 'Lobster', false], [true, 'Lobster', false], [false, 'Shark', true], [true, 'Shark', true]
] as [boolean, string, boolean][])('adult dragon provisioning fits wilderness=%s, food=%s, gauntlets=%s', async (wilderness, food, gauntlets) => {
    const s: LevelerSnapshot = {
        levels: Object.fromEntries(enabledSkills.map(skill => [skill, 70])),
        stock: { coins: 1000000, [food.toLowerCase()]: 100, 'dragon longsword': 1, 'rune platebody': 1,
            'rune platelegs': 1, 'rune full helm': 1, 'dragonfire shield': 1, 'law rune': 10,
            'air rune': 100, 'water rune': 100, 'fire rune': 100, 'chaos gauntlets': Number(gauntlets) },
        quests: { 'Lost City': true, 'Dragon Slayer': true, 'Family Crest': true }, bankReady: true, target: 80, wilderness, now: 1000
    };
    const plan = dragonPrayer(s, emptyMemory(), () => 0)!;
    const gearCount = gauntlets ? 6 : 5;
    expect(plan.needs.filter(need => need.equip)).toHaveLength(gearCount);
    expect(plan.bankTeleport).toBe(wilderness ? 'Varrock' : 'Falador');
    const f = fixture(plan);
    await provision(plan, f.port);
    expect(f.peak()).toBeLessThanOrEqual(28);
    expect(Object.keys(f.worn)).toHaveLength(gearCount);
    if (gauntlets) expect(f.worn['Chaos gauntlets']).toBe(1);
    expect(f.pack[food]).toBe(Number(plan.settings.foodWithdraw));
    for (const need of plan.needs.filter(need => need.item.endsWith(' rune'))) {
        expect(f.pack[need.item]).toBe(need.carry!);
    }
});
