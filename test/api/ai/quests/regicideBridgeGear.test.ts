import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Game } from '#/bot/api/game/Game.js';
import Tile from '#/bot/geometry/Tile.js';
import { enterTirannwn } from '#/bot/api/ai/quests/defs/regicide/pass.js';
import * as bridge from '#/bot/api/ai/quests/defs/upass/bridge.js';

const item = (id: number, name: string, slot: number): InvItemSnapshot => ({ id, name, slot, count: 1, comId: 1, ops: [] });
afterEach(() => mock.restore());

test.each([true, false])('restores the chosen weapon and shield after the bridge shot returns %s', async crossed => {
    let worn = [item(1333, 'Rune scimitar', 3), item(1189, 'Bronze kiteshield', 5), item(1129, 'Leather body', 4)];
    spyOn(reader, 'equipment').mockImplementation(() => worn);
    spyOn(reader, 'inventory').mockReturnValue([item(942, 'Lit arrows', 0)]);
    spyOn(Game, 'tile').mockReturnValue(new Tile(2450, 9716, 0));
    spyOn(bridge, 'makeFireArrow').mockResolvedValue(true);
    spyOn(bridge, 'armFireArrow').mockImplementation(async () => {
        worn = [item(859, 'Magic longbow', 3), item(1129, 'Leather body', 4)];
        return true;
    });
    spyOn(bridge, 'shootGuiderope').mockResolvedValue(crossed);
    spyOn(Equipment, 'equip').mockImplementation(async name => {
        const restored = name === 'Rune scimitar' ? item(1333, name, 3) : item(1189, name, 5);
        worn = [...worn.filter(i => i.slot !== restored.slot), restored];
        return true;
    });

    expect(await enterTirannwn(() => {})).toBe(crossed);
    expect(worn.map(i => i.name).sort()).toEqual(['Bronze kiteshield', 'Leather body', 'Rune scimitar']);
});
