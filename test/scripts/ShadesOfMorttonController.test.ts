import { afterEach, expect, spyOn, test } from 'bun:test';
import { Inventory, InvItem } from '../../src/bot/api/inventory/Inventory.js';
import { Game } from '../../src/bot/api/game/Game.js';
import { Skills } from '../../src/bot/api/skills/Skills.js';
import { EventSignal } from '../../src/bot/api/execution/EventSignal.js';
import ShadesOfMortton from '../../src/bot/scripts/ShadesOfMortton/ShadesOfMortton.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const restore of cleanups.splice(0)) restore(); });

test('stops after death before attempting another bank or hunt', async () => {
    const ready = spyOn(Game, 'sceneReady').mockReturnValue(true);
    const pending = spyOn(EventSignal, 'pending').mockReturnValue(false);
    const hp = spyOn(Skills, 'effective').mockReturnValue(0);
    cleanups.push(() => ready.mockRestore(), () => pending.mockRestore(), () => hp.mockRestore());
    const bot = new ShadesOfMortton();
    let reason = '';
    bot.bindFinish(message => { reason = message; });
    await bot.loop();
    expect(reason).toContain('Death');
});

test('an active local expedition continues without calling the bank', async () => {
    const { Equipment } = await import('../../src/bot/api/equipment/Equipment.js');
    const { ChatDialog } = await import('../../src/bot/api/ui/dialogue/ChatDialog.js');
    const ready = spyOn(Game, 'sceneReady').mockReturnValue(true);
    const pending = spyOn(EventSignal, 'pending').mockReturnValue(false);
    const hp = spyOn(Skills, 'effective').mockReturnValue(70);
    const weapon = spyOn(Equipment, 'items').mockReturnValue([new InvItem({ id: 1305, name: 'Dragon longsword', slot: 3, count: 1, comId: 1688, ops: [] })]);
    const chat = spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    cleanups.push(() => ready.mockRestore(), () => pending.mockRestore(), () => hp.mockRestore(), () => weapon.mockRestore(), () => chat.mockRestore());
    const bot = new ShadesOfMortton();
    let banks = 0;
    let steps = 0;
    Object.assign(bot, {
        expedition: { phase: 'hunt', step: async () => { steps++; return 'continue'; } },
        supply: { bank: async () => { banks++; return true; } },
        minigame: { pending: () => false }
    });
    await bot.loop();
    expect(steps).toBe(1);
    expect(banks).toBe(0);
    expect(bot.status).toContain('hunt');
});

test.each(['hunt', 'chests'] as const)('banked %s loads optional supplies before leaving the bank', async activity => {
    const { Bank } = await import('../../src/bot/api/bank/Bank.js');
    const { Equipment } = await import('../../src/bot/api/equipment/Equipment.js');
    const { ChatDialog } = await import('../../src/bot/api/ui/dialogue/ChatDialog.js');
    const { Supplies } = await import('../../src/bot/scripts/ShadesOfMortton/supply.js');
    const ready = spyOn(Game, 'sceneReady').mockReturnValue(true);
    const pending = spyOn(EventSignal, 'pending').mockReturnValue(false);
    const hp = spyOn(Skills, 'effective').mockReturnValue(70);
    const levels = spyOn(Skills, 'level').mockReturnValue(70);
    const weapon = spyOn(Equipment, 'items').mockReturnValue([new InvItem({ id: 1305, name: 'Dragon longsword', slot: 3, count: 1, comId: 1688, ops: [] })]);
    const chat = spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    const stock = spyOn(Bank, 'countById').mockImplementation(id => new Map([[139, 2], [561, 40], [554, 200]]).get(id) ?? 0);
    const free = spyOn(Inventory, 'free').mockReturnValue(10);
    const calls: (readonly [number, number] | 'close')[] = [];
    const close = spyOn(Bank, 'close').mockImplementation(async () => { calls.push('close'); return true; });
    const supply = new Supplies(() => {});
    supply.stock = new Map([[379, 30], [995, 10000], [3448, 8], [3465, activity === 'chests' ? 2 : 1]]);
    const bank = spyOn(supply, 'bank').mockResolvedValue(true);
    const take = spyOn(supply, 'take').mockImplementation(async (id, count) => { calls.push([id, count]); return true; });
    cleanups.push(() => ready.mockRestore(), () => pending.mockRestore(), () => hp.mockRestore(), () => levels.mockRestore(), () => free.mockRestore(), () => weapon.mockRestore(), () => chat.mockRestore(), () => stock.mockRestore(), () => close.mockRestore(), () => bank.mockRestore(), () => take.mockRestore());
    const bot = new ShadesOfMortton();
    Object.assign(bot, {
        local: false, prayer: true, alch: true, supply,
        combat: { standDown: async () => {} },
        minigame: { pending: () => false, exit: async () => true, openChests: async () => true, hunt: async () => true },
        loot: { process: async () => true }
    });
    bot.bindLog(() => {});
    await bot.loop();
    expect(calls).toEqual(activity === 'chests'
        ? [[379, 8], [3465, 1], [3465, 1], [139, 1], [561, 40], [554, 200], 'close']
        : [[379, 12], [3465, 1], [139, 1], 'close']);
});
