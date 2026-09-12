import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Shop } from '#/bot/api/shop/Shop.js';
import { BotHost } from '#/bot/runtime/BotHost.js';
import { RandomEvents } from '#/bot/runtime/randomevents/RandomEvents.js';

const startTick = BotHost.tickCount;
afterEach(() => { mock.restore(); BotHost.tickCount = startTick; });

for (const [name, id, distance, expected] of [
    ['Fishing spot', 320, 10, { kind: 'lost-gear', name: 'harpoon' }],
    ['Fishing spot', 320, 11, null],
    ['Whirlpool', 406, 10, { kind: 'lost-gear', name: 'harpoon' }],
    ['Man', 1, 1, null]
] as const) {
    test(`tool loss near ${name} at distance ${distance}`, () => {
        const events: typeof RandomEvents = Reflect.construct(RandomEvents.constructor, []);
        const tile = { x: 2800, z: 3400, level: 0 };
        let held = true;
        BotHost.tickCount = 100;
        spyOn(reader, 'worldTile').mockReturnValue(tile);
        spyOn(reader, 'npcs').mockReturnValue([{ id, name, distance, tile, index: 1, anim: -1, level: 0, ops: [], inCombat: false, health: 0, totalHealth: 0, faceEntity: -1 }]);
        spyOn(reader, 'locs').mockReturnValue([]);
        spyOn(reader, 'selfSlot').mockReturnValue(0);
        spyOn(reader, 'selfFaceEntity').mockReturnValue(-1);
        spyOn(reader, 'groundItems').mockReturnValue([{ id: 311, name: 'Harpoon', count: 1, tile, distance: 1, ops: ['Take'] }]);
        spyOn(Inventory, 'items').mockImplementation(() => held ? [new InvItem({ id: 311, name: 'Harpoon', count: 1, slot: 0, comId: 3214, ops: [] })] : []);
        spyOn(Equipment, 'items').mockReturnValue([]);
        spyOn(Bank, 'isOpen').mockReturnValue(false);
        spyOn(Shop, 'isOpen').mockReturnValue(false);
        spyOn(Game, 'inCombat').mockReturnValue(false);
        spyOn(Game, 'animating').mockReturnValue(false);
        events.detect();
        held = false;
        BotHost.tickCount = 102;
        expect(events.detect()).toEqual(expected);
    });
}
