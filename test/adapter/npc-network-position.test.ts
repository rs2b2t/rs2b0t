import { afterEach, expect, test } from 'bun:test';
import { attach, detach, reader } from '#/bot/adapter/ClientAdapter.js';
import { Npc } from '#/bot/api/model/Npc.js';
import NpcType from '#/client/config/NpcType.js';
import ClientNpc from '#/client/dash3d/ClientNpc.js';
import ClientPlayer from '#/client/dash3d/ClientPlayer.js';
import { Client } from '#/client/shell/Client.js';

afterEach(detach);

test('adapter exposes route-head body centre separately from rendered centre', () => {
    const client: Client = Object.create(Client.prototype);
    const dragon = new ClientNpc();
    dragon.type = new NpcType();
    dragon.type.size = 4;
    dragon.x = 35 * 128;
    dragon.z = 25 * 128;
    dragon.routeX[0] = 32;
    dragon.routeZ[0] = 25;
    client['mapBuildBaseX'] = 2800;
    client['mapBuildBaseZ'] = 9800;
    client['minusedlevel'] = 0;
    client['localPlayer'] = new ClientPlayer();
    client['npcCount'] = 1;
    client['npcIds'] = new Int32Array([17]);
    client['npc'] = [];
    client['npc'][17] = dragon;
    attach(client);

    const snapshot = reader.npcs()[0];

    if (!snapshot) throw new Error('Missing NPC snapshot');
    expect(snapshot.tile).toEqual({ x: 2835, z: 9825, level: 0 });
    expect(snapshot.networkTile).toEqual({ x: 2834, z: 9827, level: 0 });
    expect(new Npc(snapshot).networkTile()).toMatchObject({ x: 2834, z: 9827 });
    expect(new Npc(snapshot).tile()).toMatchObject({ x: 2835, z: 9825 });
});
