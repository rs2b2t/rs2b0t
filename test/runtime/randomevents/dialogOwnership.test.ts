import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { reader, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Shop } from '#/bot/api/shop/Shop.js';
import { RandomEvents } from '#/bot/runtime/randomevents/RandomEvents.js';

const TILE = { x: 3200, z: 3200, level: 0 };
const SELF_SLOT = 3;

afterEach(() => { mock.restore(); });

function npc(over: Partial<NpcSnapshot> = {}): NpcSnapshot {
    return {
        id: 2108, name: 'Genie', index: 5, anim: -1, level: -1, size: 1,
        tile: TILE, distance: 2, ops: ['Talk-to'], inCombat: false,
        health: 0, totalHealth: 0, faceEntity: -1,
        ...over
    };
}

function detect(npcs: NpcSnapshot[]): ReturnType<typeof RandomEvents.detect> {
    const events: typeof RandomEvents = Reflect.construct(RandomEvents.constructor, []);
    spyOn(reader, 'worldTile').mockReturnValue(TILE);
    spyOn(reader, 'npcs').mockReturnValue(npcs);
    spyOn(reader, 'locs').mockReturnValue([]);
    spyOn(reader, 'groundItems').mockReturnValue([]);
    spyOn(reader, 'selfSlot').mockReturnValue(SELF_SLOT);
    spyOn(reader, 'selfFaceEntity').mockReturnValue(-1);
    spyOn(reader, 'takingDamage').mockReturnValue(false);
    spyOn(Inventory, 'items').mockReturnValue([]);
    spyOn(Inventory, 'contains').mockReturnValue(false);
    spyOn(Equipment, 'items').mockReturnValue([]);
    spyOn(Bank, 'isOpen').mockReturnValue(false);
    spyOn(Shop, 'isOpen').mockReturnValue(false);
    spyOn(Game, 'animating').mockReturnValue(false);
    return events.detect();
}

describe('a talking random that belongs to another player', () => {
    test.each(['Genie', 'Drunken dwarf', 'Mysterious old man'])('%s following someone else is left alone', name => {
        expect(detect([npc({ name, faceEntity: 32768 + SELF_SLOT + 4 })])).toBeNull();
    });

    test('the same npc following us is still handled', () => {
        expect(detect([npc({ faceEntity: 32768 + SELF_SLOT })])).toEqual({ kind: 'dialog', name: 'genie' });
    });

    test('a spawn tick that carries no facing yet is handled rather than skipped', () => {
        expect(detect([npc({ faceEntity: -1 })])).toEqual({ kind: 'dialog', name: 'genie' });
    });

    test('one foreign random beside us does not suppress our own further out', () => {
        expect(detect([
            npc({ index: 4, distance: 1, faceEntity: 32768 + SELF_SLOT + 4 }),
            npc({ index: 5, distance: 5, faceEntity: 32768 + SELF_SLOT })
        ])).toEqual({ kind: 'dialog', name: 'genie' });
    });

    test('a strange plant keeps its own ownership rule, since it never faces its owner', () => {
        expect(detect([npc({
            id: 407, name: 'Strange plant', distance: 1, ops: ['Pick'], faceEntity: 32768 + SELF_SLOT + 4
        })])).toEqual({ kind: 'pick', name: 'strange plant' });
    });
});
