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
        expedition: { phase: 'hunt', description: 'Hunting Fiyr shades', step: async () => { steps++; return 'continue'; } },
        supply: { bank: async () => { banks++; return true; } },
        minigame: { pending: () => false }
    });
    await bot.loop();
    expect(steps).toBe(1);
    expect(banks).toBe(0);
    expect(bot.status).toContain('Hunting');
});

test('automatic loop starts from ordinary magic logs without banked sacred oil or pyres', async () => {
    const { Equipment } = await import('../../src/bot/api/equipment/Equipment.js');
    const { ChatDialog } = await import('../../src/bot/api/ui/dialogue/ChatDialog.js');
    const { Expedition } = await import('../../src/bot/scripts/ShadesOfMortton/expedition.js');
    const mocks = [
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(EventSignal, 'pending').mockReturnValue(false),
        spyOn(Skills, 'effective').mockReturnValue(70),
        spyOn(Equipment, 'items').mockReturnValue([new InvItem({ id: 1305, name: 'Dragon longsword', slot: 3, count: 1, comId: 1688, ops: [] })]),
        spyOn(ChatDialog, 'canContinue').mockReturnValue(false)
    ];
    const load = spyOn(Expedition.prototype, 'load').mockResolvedValue(true);
    cleanups.push(...mocks.map(mock => () => mock.mockRestore()), () => load.mockRestore());
    const bot = new ShadesOfMortton();
    Object.assign(bot, {
        supply: { stock: new Map([[379, 40], [995, 10000], [1513, 40]]), bank: async () => true },
        combat: { standDown: async () => {} },
        minigame: { pending: () => false, exit: async () => true }
    });
    bot.bindLog(() => {});
    await bot.loop();
    expect(load).toHaveBeenCalledTimes(1);
    expect(bot.status).toBe('Preparing supplies in Mortton');
});

test('only resource-spending preferences are exposed', async () => {
    const { SHADES_SETTINGS } = await import('../../src/bot/scripts/ShadesOfMortton/settings.js');
    expect(Object.keys(SHADES_SETTINGS)).toEqual(['prayerPotions', 'highAlchemy']);
});

test('a prepared inventory starts the village loop without banking', async () => {
    const { Equipment } = await import('../../src/bot/api/equipment/Equipment.js');
    const { ChatDialog } = await import('../../src/bot/api/ui/dialogue/ChatDialog.js');
    const { Expedition } = await import('../../src/bot/scripts/ShadesOfMortton/expedition.js');
    const mocks = [
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(EventSignal, 'pending').mockReturnValue(false),
        spyOn(Skills, 'effective').mockReturnValue(70),
        spyOn(Equipment, 'items').mockReturnValue([new InvItem({ id: 1305, name: 'Dragon longsword', slot: 3, count: 1, comId: 1688, ops: [] })]),
        spyOn(ChatDialog, 'canContinue').mockReturnValue(false),
        spyOn(Inventory, 'countById').mockImplementation(id => new Map([[379, 4], [590, 1], [2347, 1], [995, 20000], [1513, 4], [3430, 4]]).get(id) ?? 0)
    ];
    const step = spyOn(Expedition.prototype, 'step').mockResolvedValue('continue');
    cleanups.push(...mocks.map(mock => () => mock.mockRestore()), () => step.mockRestore());
    const bot = new ShadesOfMortton();
    let banks = 0;
    Object.assign(bot, { supply: { bank: async () => { banks++; return true; } }, minigame: { pending: () => false } });
    await bot.loop();
    await bot.loop();
    expect(banks).toBe(0);
    expect(step).toHaveBeenCalled();
});

test('a resupply trip reloads the automatic loop without requiring gathering levels', async () => {
    const { Equipment } = await import('../../src/bot/api/equipment/Equipment.js');
    const { ChatDialog } = await import('../../src/bot/api/ui/dialogue/ChatDialog.js');
    const { Expedition } = await import('../../src/bot/scripts/ShadesOfMortton/expedition.js');
    const mocks = [
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(EventSignal, 'pending').mockReturnValue(false),
        spyOn(Skills, 'effective').mockReturnValue(70),
        spyOn(Skills, 'level').mockReturnValue(1),
        spyOn(Equipment, 'items').mockReturnValue([new InvItem({ id: 1305, name: 'Dragon longsword', slot: 3, count: 1, comId: 1688, ops: [] })]),
        spyOn(ChatDialog, 'canContinue').mockReturnValue(false),
        spyOn(Expedition.prototype, 'load').mockResolvedValue(true)
    ];
    const step = spyOn(Expedition.prototype, 'step').mockResolvedValue('continue');
    cleanups.push(...mocks.map(mock => () => mock.mockRestore()), () => step.mockRestore());
    const bot = new ShadesOfMortton();
    let banks = 0;
    let finished = '';
    bot.bindFinish(reason => { finished = reason; });
    bot.bindLog(() => {});
    Object.assign(bot, {
        expedition: { phase: 'oil', cycles: 0, description: 'Making sacred oil', reason: 'logs exhausted', step: async () => 'bank' },
        supply: { stock: new Map([[379, 40], [995, 10000], [1513, 40]]), bank: async () => { banks++; return true; } },
        combat: { standDown: async () => {} },
        minigame: { pending: () => false, exit: async () => true }
    });
    await bot.loop();
    await bot.loop();
    expect(banks).toBe(1);
    expect(step).toHaveBeenCalledTimes(1);
    expect(bot.status).toBe('Preparing supplies in Mortton');
    expect(finished).toBe('');
});

test('missing serum ingredients gather an ash source even when pyre fuel is banked', async () => {
    const { Equipment } = await import('../../src/bot/api/equipment/Equipment.js');
    const { ChatDialog } = await import('../../src/bot/api/ui/dialogue/ChatDialog.js');
    const { Expedition } = await import('../../src/bot/scripts/ShadesOfMortton/expedition.js');
    const mocks = [
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(EventSignal, 'pending').mockReturnValue(false),
        spyOn(Skills, 'effective').mockReturnValue(90),
        spyOn(Skills, 'level').mockReturnValue(90),
        spyOn(Equipment, 'items').mockReturnValue([new InvItem({ id: 1305, name: 'Dragon longsword', slot: 3, count: 1, comId: 1688, ops: [] })]),
        spyOn(ChatDialog, 'canContinue').mockReturnValue(false)
    ];
    const load = spyOn(Expedition.prototype, 'load').mockResolvedValue(true);
    cleanups.push(...mocks.map(mock => () => mock.mockRestore()), () => load.mockRestore());
    const bot = new ShadesOfMortton();
    let gathered = 0;
    bot.bindLog(() => {});
    Object.assign(bot, {
        expedition: { phase: 'prepare', cycles: 0, reason: 'serum ingredients exhausted', step: async () => 'bank' },
        supply: { stock: new Map([[379, 40], [995, 10000], [3448, 40]]), bank: async () => true, logs: async () => { gathered++; return true; } },
        combat: { standDown: async () => {} },
        minigame: { pending: () => false, exit: async () => true }
    });
    await bot.loop();
    expect(gathered).toBe(1);
    expect(load).not.toHaveBeenCalled();
});
