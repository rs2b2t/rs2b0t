import { afterEach, expect, test } from 'bun:test';
import IfType from '#/client/config/IfType.js';
import { attach, detach, reader } from '#/bot/adapter/ClientAdapter.js';

const interfaces = IfType.list;
afterEach(() => { detach(); IfType.list = interfaces; });

function fixture(mainModalId: number) {
    IfType.list = [];
    for (const id of [6669, 6670, 6507, 6508, 6516, 6517]) {
        const component = new IfType();
        component.id = id;
        component.linkObjType = new Int32Array(28);
        component.linkObjNumber = new Int32Array(28);
        IfType.list[id] = component;
    }
    const client = { mainModalId, invUpdateState: new Map<number, { generation: number; fullGeneration: number; transmitting: boolean }>() };
    attach(client as never);
    return client;
}

test('empty first-screen stakes require both transmitted full inventories', () => {
    const client = fixture(6575);
    expect(reader.duelOffers().ready).toBe(false);
    client.invUpdateState.set(6669, { generation: 1, fullGeneration: 1, transmitting: true });
    expect(reader.duelOffers().ready).toBe(false);
    client.invUpdateState.set(6670, { generation: 1, fullGeneration: 1, transmitting: true });
    expect(reader.duelOffers()).toEqual({ ready: true, mine: [], theirs: [] });
    client.invUpdateState.set(6670, { generation: 2, fullGeneration: 1, transmitting: false });
    expect(reader.duelOffers().ready).toBe(false);
});

test('confirmation needs both explicit empty-stake labels', () => {
    fixture(6412);
    expect(reader.duelOffers().ready).toBe(false);
    IfType.list[6516].text = 'Absolutely nothing!';
    expect(reader.duelOffers().ready).toBe(false);
    IfType.list[6517].text = 'Absolutely nothing!';
    expect(reader.duelOffers().ready).toBe(true);
    IfType.list[6517].text = '';
    expect(reader.duelOffers().ready).toBe(false);
});
