import { afterEach, describe, expect, test } from 'bun:test';

import { attach, detach, reader } from '#/bot/adapter/ClientAdapter.js';
import IfType, { ComponentType } from '#/client/config/IfType.js';
import { ServerProt } from '#/client/io/ServerProt.js';

const originalInterfaces = IfType.list;

function component(id: number, type: ComponentType): IfType {
    const result = new IfType();
    result.id = id;
    result.type = type;
    return result;
}

function installBankInterfaces(): void {
    const inventoryRoot = component(300, ComponentType.TYPE_LAYER);
    const inventory = component(301, ComponentType.TYPE_INV);
    inventory.objOps = true;
    inventory.linkObjType = new Int32Array(28);
    inventory.linkObjNumber = new Int32Array(28);
    inventoryRoot.children = [inventory.id];

    const main = component(100, ComponentType.TYPE_LAYER);
    const mainInv = component(101, ComponentType.TYPE_INV);
    mainInv.iop = ['Withdraw-1', null, null, null, null];
    mainInv.linkObjType = new Int32Array(40);
    mainInv.linkObjNumber = new Int32Array(40);
    main.children = [mainInv.id];

    const side = component(200, ComponentType.TYPE_LAYER);
    const sideInv = component(201, ComponentType.TYPE_INV);
    sideInv.iop = ['Deposit-1', null, null, null, null];
    sideInv.linkObjType = new Int32Array(28);
    sideInv.linkObjNumber = new Int32Array(28);
    side.children = [sideInv.id];

    IfType.list = [];
    for (const value of [main, mainInv, side, sideInv, inventoryRoot, inventory]) {
        IfType.list[value.id] = value;
    }
}

function fakeClient() {
    const packets: number[] = [];
    return {
        statSessionGeneration: 1,
        invUpdateState: new Map<number, { generation: number; fullGeneration: number; transmitting: boolean }>(),
        mainModalId: -1,
        sideModalId: -1,
        sideIcon: [-1, -1, -1, 300],
        ptype0: -1,
        packets,
        async tcpIn(): Promise<boolean> {
            const ptype = packets.shift();
            if (ptype === undefined) return false;
            this.ptype0 = ptype;
            if (ptype === ServerProt.IF_OPENMAIN_SIDE) {
                this.mainModalId = 100;
                this.sideModalId = 200;
            } else if (ptype === ServerProt.IF_CLOSE) {
                this.mainModalId = -1;
                this.sideModalId = -1;
            }
            return true;
        }
    };
}

function full(client: ReturnType<typeof fakeClient>, comId: number): void {
    const generation = (client.invUpdateState.get(comId)?.generation ?? 0) + 1;
    client.invUpdateState.set(comId, { generation, fullGeneration: generation, transmitting: true });
}

async function packet(client: ReturnType<typeof fakeClient>, ptype: ServerProt): Promise<void> {
    client.packets.push(ptype);
    expect(await client.tcpIn()).toBe(true);
}

afterEach(() => {
    detach();
    IfType.list = originalInterfaces;
});

describe('bank snapshot packet generations', () => {
    test('requires a current-login full normal inventory snapshot', () => {
        installBankInterfaces();
        const client = fakeClient();
        attach(client as never);

        expect(reader.inventorySize()).toBe(28);
        expect(reader.inventorySnapshotReady()).toBe(false);

        full(client, 301);
        expect(reader.inventorySnapshotReady()).toBe(true);

        client.statSessionGeneration++;
        client.invUpdateState.clear();
        expect(reader.inventorySnapshotReady()).toBe(false);
    });

    test('accepts complete empty snapshots that arrived before the local bank-open packet', async () => {
        installBankInterfaces();
        const client = fakeClient();
        attach(client as never);
        full(client, 101);
        full(client, 201);

        await packet(client, ServerProt.IF_OPENMAIN_SIDE);

        expect(reader.bankItems()).toEqual([]);
        expect(reader.bankSnapshotReady()).toBe(true);
        expect(reader.bankSideSnapshotReady()).toBe(true);
    });

    test('requires full snapshots when the modal arrives first', async () => {
        installBankInterfaces();
        const client = fakeClient();
        attach(client as never);
        await packet(client, ServerProt.IF_OPENMAIN_SIDE);

        expect(reader.bankSnapshotReady()).toBe(false);
        expect(reader.bankSideSnapshotReady()).toBe(false);

        client.invUpdateState.set(101, { generation: 1, fullGeneration: 0, transmitting: true });
        client.invUpdateState.set(201, { generation: 1, fullGeneration: 0, transmitting: true });
        expect(reader.bankSnapshotReady()).toBe(false);
        expect(reader.bankSideSnapshotReady()).toBe(false);

        full(client, 101);
        full(client, 201);
        expect(reader.bankSnapshotReady()).toBe(true);
        expect(reader.bankSideSnapshotReady()).toBe(true);
    });

    test('requires newer full snapshots after close and reopen', async () => {
        installBankInterfaces();
        const client = fakeClient();
        attach(client as never);
        full(client, 101);
        full(client, 201);
        await packet(client, ServerProt.IF_OPENMAIN_SIDE);
        expect(reader.bankSnapshotReady()).toBe(true);

        await packet(client, ServerProt.IF_CLOSE);
        await packet(client, ServerProt.IF_OPENMAIN_SIDE);
        expect(reader.bankSnapshotReady()).toBe(false);
        expect(reader.bankSideSnapshotReady()).toBe(false);

        full(client, 101);
        full(client, 201);
        expect(reader.bankSnapshotReady()).toBe(true);
        expect(reader.bankSideSnapshotReady()).toBe(true);
    });

    test('rejects stopped transmission even when an earlier full snapshot exists', async () => {
        installBankInterfaces();
        const client = fakeClient();
        attach(client as never);
        full(client, 101);
        full(client, 201);
        await packet(client, ServerProt.IF_OPENMAIN_SIDE);

        const main = client.invUpdateState.get(101)!;
        client.invUpdateState.set(101, { ...main, generation: main.generation + 1, transmitting: false });
        expect(reader.bankSnapshotReady()).toBe(false);
    });
});
