import { afterEach, describe, expect, test } from 'bun:test';

import { actions, attach, detach } from '#/bot/adapter/ClientAdapter.js';
import IfType, { ComponentType } from '#/client/config/IfType.js';
import Packet from '#/client/io/Packet.js';
import { ClientProt } from '#/client/io/ClientProt.js';

const originalInterfaces = IfType.list;

function fakeClient(): { out: Packet; statSessionGeneration: number } {
    return { out: new Packet(new Uint8Array(512)), statSessionGeneration: 0 };
}

function invComponent(id: number, ids: readonly number[]): IfType {
    const com = new IfType();
    com.id = id;
    com.type = ComponentType.TYPE_INV;
    com.linkObjType = new Int32Array(8);
    com.linkObjNumber = new Int32Array(8);
    ids.forEach((objId, i) => {
        com.linkObjType![i] = objId + 1;
        com.linkObjNumber![i] = 1;
    });
    IfType.list = [];
    IfType.list[id] = com;
    return com;
}

function slots(com: IfType): number[] {
    return [...com.linkObjType!].map(v => v - 1);
}

function sent(client: { out: Packet }): number[] {
    return [...client.out.data.subarray(0, client.out.pos)];
}

afterEach(() => {
    IfType.list = originalInterfaces;
    detach();
});

describe('dragInvSlot', () => {
    test('mode 0 swaps the two slots locally and writes the packet', () => {
        const com = invComponent(5382, [10, 20, 30, 40]);
        const client = fakeClient();
        attach(client as never);

        expect(actions.dragInvSlot(5382, 0, 2, 0)).toBe(true);
        expect(slots(com).slice(0, 4)).toEqual([30, 20, 10, 40]);

        const bytes = sent(client);
        expect(bytes[0]).toBe(ClientProt.INV_BUTTOND & 0xff);
        expect((bytes[1] << 8) | bytes[2]).toBe(5382);
        expect((bytes[3] << 8) | bytes[4]).toBe(0);
        expect((bytes[5] << 8) | bytes[6]).toBe(2);
        expect(bytes[7]).toBe(0);
    });

    test('mode 1 shifts the run and marks the packet as an insert', () => {
        const com = invComponent(5382, [10, 20, 30, 40]);
        const client = fakeClient();
        attach(client as never);

        expect(actions.dragInvSlot(5382, 3, 0, 1)).toBe(true);
        expect(slots(com).slice(0, 4)).toEqual([40, 10, 20, 30]);
        expect(sent(client)[7]).toBe(1);
    });

    test('mode 1 shifts left to right as well', () => {
        const com = invComponent(5382, [10, 20, 30, 40]);
        const client = fakeClient();
        attach(client as never);

        expect(actions.dragInvSlot(5382, 0, 2, 1)).toBe(true);
        expect(slots(com).slice(0, 4)).toEqual([20, 30, 10, 40]);
    });

    test('an empty source slot sends nothing', () => {
        const com = invComponent(5382, [10, 20]);
        const client = fakeClient();
        attach(client as never);

        expect(actions.dragInvSlot(5382, 5, 0, 0)).toBe(false);
        expect(sent(client)).toEqual([]);
        expect(slots(com).slice(0, 2)).toEqual([10, 20]);
    });

    test('an out of range slot sends nothing', () => {
        invComponent(5382, [10, 20]);
        const client = fakeClient();
        attach(client as never);

        expect(actions.dragInvSlot(5382, 0, 99, 0)).toBe(false);
        expect(sent(client)).toEqual([]);
    });

    test('a no-op drag sends nothing', () => {
        invComponent(5382, [10, 20]);
        const client = fakeClient();
        attach(client as never);

        expect(actions.dragInvSlot(5382, 1, 1, 0)).toBe(false);
        expect(sent(client)).toEqual([]);
    });
});
