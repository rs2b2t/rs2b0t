import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Game } from '#/bot/api/game/Game.js';
import Tile from '#/bot/geometry/Tile.js';
import { enterTirannwn } from '#/bot/api/ai/quests/defs/regicide/pass.js';
import * as bridge from '#/bot/api/ai/quests/defs/upass/bridge.js';
import * as grid from '#/bot/api/ai/quests/defs/upass/grid.js';

const item = (id: number, name: string, slot: number): InvItemSnapshot => ({ id, name, slot, count: 1, comId: 1, ops: [] });
afterEach(() => mock.restore());

test.each([true, false])('restores the chosen weapon and shield after the bridge shot returns %s', async crossed => {
    let worn = [item(1333, 'Rune scimitar', 3), item(1189, 'Bronze kiteshield', 5), item(1129, 'Leather body', 4)];
    spyOn(reader, 'equipment').mockImplementation(() => worn);
    let pack = [item(942, 'Lit arrows', 0)];
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(Game, 'tile').mockReturnValue(new Tile(2450, 9716, 0));
    spyOn(bridge, 'makeFireArrow').mockResolvedValue(true);
    spyOn(bridge, 'armFireArrow').mockImplementation(async () => {
        pack.push(...worn.filter(i => i.slot === 3 || i.slot === 5));
        worn = [item(859, 'Magic longbow', 3), item(1129, 'Leather body', 4)];
        return true;
    });
    spyOn(bridge, 'shootGuiderope').mockResolvedValue(crossed);
    spyOn(Equipment, 'equip').mockImplementation(async name => {
        const restored = name === 'Rune scimitar' ? item(1333, name, 3) : item(1189, name, 5);
        pack = pack.filter(i => i.name !== name);
        worn = [...worn.filter(i => i.slot !== restored.slot), restored];
        return true;
    });

    expect(await enterTirannwn(() => {})).toBe(crossed);
    expect(worn.map(i => i.name).sort()).toEqual(['Bronze kiteshield', 'Leather body', 'Rune scimitar']);
});

test.each([false, true])('recovers after a bridge equip lock, with the shield subsequently missing: %s', async missing => {
    let worn = [item(1333, 'Rune scimitar', 3), item(1189, 'Bronze kiteshield', 5)];
    let locked = true;
    spyOn(grid, 'crossGrid').mockResolvedValue(false);
    spyOn(reader, 'equipment').mockImplementation(() => worn);
    let pack = [item(942, 'Lit arrows', 0)];
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    const tile = spyOn(Game, 'tile').mockReturnValue(new Tile(2450, 9716, 0));
    spyOn(bridge, 'makeFireArrow').mockResolvedValue(true);
    spyOn(bridge, 'armFireArrow').mockImplementation(async () => {
        pack.push(...worn.filter(i => i.slot === 3 || i.slot === 5));
        worn = [item(859, 'Magic longbow', 3)];
        return true;
    });
    spyOn(bridge, 'shootGuiderope').mockResolvedValue(false);
    spyOn(Equipment, 'equip').mockImplementation(async name => {
        if (locked || !pack.some(i => i.name === name)) return false;
        const restored = name === 'Rune scimitar' ? item(1333, name, 3) : item(1189, name, 5);
        pack = pack.filter(i => i.name !== name);
        worn = [...worn.filter(i => i.slot !== restored.slot), restored];
        return true;
    });
    expect(await enterTirannwn(() => {})).toBe(false);
    locked = false;
    if (missing) { worn = [item(1333, 'Rune scimitar', 3)]; pack = []; }
    tile.mockReturnValue(new Tile(2442, 9716, 0));

    expect(await enterTirannwn(() => {})).toBe(true);
    expect(worn.map(i => i.name).sort()).toEqual(missing ? ['Rune scimitar'] : ['Bronze kiteshield', 'Rune scimitar']);
});
