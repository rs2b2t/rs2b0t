import { afterEach, expect, test } from 'bun:test';
import { attach, detach, reader } from '#/bot/adapter/ClientAdapter.js';
import ClientPlayer from '#/client/dash3d/ClientPlayer.js';
import { Client } from '#/client/shell/Client.js';

afterEach(detach);

test('visible player states include self once, use route heads and expose item IDs', () => {
    const client: Client = Object.create(Client.prototype);
    const self = new ClientPlayer();
    self.name = 'Fixture initiate';
    self.ready = true;
    self.routeX[0] = 20;
    self.routeZ[0] = 30;
    self.x = 18 * 128;
    self.z = 28 * 128;
    self.appearance[0] = 256;
    self.appearance[7] = 512 + 1013;
    const unloaded = new ClientPlayer();
    unloaded.name = 'Fixture loading';
    client['localPlayer'] = self;
    client['players'] = [self, unloaded];
    client['playerIds'] = new Int32Array([0, 1]);
    client['playerCount'] = 2;
    client['mapBuildBaseX'] = 3200;
    client['mapBuildBaseZ'] = 3200;
    client['minusedlevel'] = 0;
    attach(client);

    expect(reader.visiblePlayerStates()).toEqual([
        {
            name: 'Fixture initiate',
            networkTile: { x: 3220, z: 3230, level: 0 },
            equipmentIds: [1013]
        }
    ]);
    detach();
    expect(reader.visiblePlayerStates()).toEqual([]);
});
