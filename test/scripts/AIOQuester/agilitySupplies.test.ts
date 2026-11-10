import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Npc } from '#/bot/api/npcs/Npcs.js';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import BrimhavenAgility from '#/bot/scripts/BrimhavenAgility/BrimhavenAgility.js';
import { ticketSupplyActivity, toadflaxSupplyActivity } from '#/bot/scripts/AIOQuester/agilitySupplyActivities.js';

afterEach(() => mock.restore());

test('ticket gathering leaves the arena once banked and carried tickets meet the target', async () => {
    let total = 5;
    const leave = spyOn(BrimhavenAgility.prototype, 'leaveArena').mockResolvedValue(undefined);
    const inside = spyOn(BrimhavenAgility.prototype, 'inArenaNow').mockReturnValue(true);
    const gather = spyOn(BrimhavenAgility.prototype, 'loop').mockResolvedValue(undefined);
    const bot = ticketSupplyActivity(() => total).create() as BrimhavenAgility;
    bot.settings = new SettingsBag({ count: 6 });
    await bot.loop();
    expect(gather).toHaveBeenCalledTimes(1);
    total = 6;
    await bot.loop();
    expect(leave).toHaveBeenCalledTimes(1);
    expect(gather).toHaveBeenCalledTimes(1);
    inside.mockReturnValue(false);
    await bot.loop();
    expect(gather).toHaveBeenCalledTimes(1);
});

test('Toadflax trade opens Jackie’s reward interface and spends three tickets per herb', async () => {
    let modal = -1;
    let tickets = 6;
    let herbs = 0;
    spyOn(Modals, 'main').mockImplementation(() => modal);
    spyOn(reader, 'npcs').mockReturnValue([{ index: 1, id: 1055, name: 'Pirate Jackie the Fruit',
        tile: { x: 2809, z: 3194, level: 0 }, level: 1, anim: -1, size: 1, distance: 1,
        inCombat: false, health: 1, totalHealth: 1, faceEntity: -1, ops: ['Talk-to', null, 'Trade'] }]);
    const interact = spyOn(Npc.prototype, 'interact').mockImplementation(async action => { expect(action).toBe('Trade'); modal = 8292; return true; });
    spyOn(Inventory, 'count').mockImplementation(name => name === 'Agility arena ticket' ? tickets : 0);
    spyOn(Inventory, 'countById').mockImplementation(id => id === 2998 ? herbs : 0);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    const click = spyOn(actions, 'ifButton').mockImplementation(id => { expect(id).toBe(8382); tickets -= 3; herbs++; return true; });
    const bot = toadflaxSupplyActivity.create() as LoopingBot;
    await bot.loop();
    expect(interact).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    await bot.loop();
    expect(tickets).toBe(3);
    expect(herbs).toBe(1);
    await bot.loop();
    expect(tickets).toBe(0);
    expect(herbs).toBe(2);
});
