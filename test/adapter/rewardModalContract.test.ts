import { afterEach, beforeEach, expect, test } from 'bun:test';
import { attach, detach, reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Scheduler } from '#/bot/runtime/Scheduler.js';
import { ScriptAborted, ScriptContext } from '#/bot/runtime/ScriptContext.js';
import IfType from '#/client/config/IfType.js';
import ObjType from '#/client/config/ObjType.js';
import Packet from '#/client/io/Packet.js';
import ClientStream from '#/client/io/ClientStream.js';
import { ClientProt } from '#/client/io/ClientProt.js';
import { ServerProt } from '#/client/io/ServerProt.js';
import { Client } from '#/client/shell/Client.js';
import { stubProps } from '../lib/stubSingletons.js';

const originalInterfaces = IfType.list;
const restores: (() => void)[] = [];
let now = 0;
beforeEach(() => {
    now = performance.now();
    restores.push(stubProps(performance, { now: () => now }));
});

afterEach(async () => {
    restores.splice(0).reverse().forEach(restore => restore());
    detach();
    await Bank.close();
    IfType.list = originalInterfaces;
});

function clientFixture(): Client {
    const client: Client = Object.create(Client.prototype);
    client['mainModalId'] = -1;
    client['sideModalId'] = -1;
    client['chatModalId'] = -1;
    client['out'] = new Packet(new Uint8Array(128));
    client['in'] = new Packet(new Uint8Array(128));
    client['invUpdateState'] = new Map();
    client['modalCloseGeneration'] = 0;
    client['statSessionGeneration'] = 1;
    client['ingame'] = true;
    client['stream'] = Object.create(ClientStream.prototype);
    attach(client);
    return client;
}

async function receive(client: Client, opcode: ServerProt, payload: Packet): Promise<void> {
    const stream = client['stream'];
    if (!stream) { throw new Error('fixture has no session stream'); }
    Object.defineProperty(stream, 'available', { value: payload.pos + 1, configurable: true });
    stream.readBytes = async (destination, offset, length) => {
        destination.set(payload.data.subarray(0, length), offset);
    };
    client['ptype'] = opcode;
    client['psize'] = payload.pos;
    expect(await client['tcpInDispatch']()).toBe(true);
}

test('reads the normal reward inventory after genuine UPDATE_INV_FULL and IF_OPENMAIN handlers', async () => {
    const client = clientFixture();
    const root = new IfType();
    root.id = 6960;
    const inventory = new IfType();
    inventory.id = 6963;
    inventory.linkObjType = new Int32Array(9);
    inventory.linkObjNumber = new Int32Array(9);
    IfType.list = [];
    IfType.list[6960] = root;
    IfType.list[6963] = inventory;
    restores.push(stubProps(ObjType, { list: id => {
        const obj = new ObjType();
        obj.id = id;
        obj.name = `Potion ${id}`;
        return obj;
    } }));
    const packet = new Packet(new Uint8Array(64));
    packet.p2(6963);
    packet.p2(3);
    for (const id of [145, 157, 163]) { packet.p2(id + 1); packet.p1(3); }
    await receive(client, ServerProt.UPDATE_INV_FULL, packet);
    const modal = new Packet(new Uint8Array(2));
    modal.p2(6960);

    await receive(client, ServerProt.IF_OPENMAIN, modal);

    expect(reader.modals().main).toBe(6960);
    expect(reader.shopInv(6963).map(({ id, count }) => ({ id, count }))).toEqual([
        { id: 145, count: 3 }, { id: 157, count: 3 }, { id: 163, count: 3 }
    ]);
});

async function openBank(): Promise<Client> {
    const client = clientFixture();
    client['mainModalId'] = 5292;
    client['sideModalId'] = 5063;
    restores.push(stubProps(reader, {
        bankComId: () => client['mainModalId'] === 5292 ? 5382 : -1,
        closeButtonComId: () => 5384
    }));
    const { actions } = await import('#/bot/adapter/ClientAdapter.js');
    restores.push(stubProps(actions, { menuAction: () => { client['closeModal'](); return true; } }));
    return client;
}

async function pump(): Promise<void> {
    now += 10;
    Scheduler['pump']();
    await new Promise<void>(resolve => setImmediate(resolve));
}

test('stale close and STOP_TRANSMIT cannot acknowledge a new close', async () => {
    const client = await openBank();
    await receive(client, ServerProt.IF_CLOSE, new Packet(new Uint8Array(0)));
    client['mainModalId'] = 5292;
    client['sideModalId'] = 5063;
    let settled = false;
    const closing = Bank.close().then(result => { settled = true; return result; });
    const stop = new Packet(new Uint8Array(2));
    IfType.list = [];
    IfType.list[6963] = new IfType();
    IfType.list[6963].linkObjType = new Int32Array(0);
    IfType.list[6963].linkObjNumber = new Int32Array(0);
    stop.p2(6963);
    await receive(client, ServerProt.UPDATE_INV_STOP_TRANSMIT, stop);
    await pump();
    const premature = settled;
    await receive(client, ServerProt.IF_CLOSE, new Packet(new Uint8Array(0)));
    await pump();
    expect(await closing).toBe(true);
    expect(premature).toBe(false);
    expect(client['modalCloseGeneration']).toBe(2);
});

test('acknowledgement before the first pump works but the next close needs a new one', async () => {
    const client = await openBank();
    const first = Bank.close();
    await receive(client, ServerProt.IF_CLOSE, new Packet(new Uint8Array(0)));
    await pump();
    expect(await first).toBe(true);
    client['mainModalId'] = 5292;
    client['sideModalId'] = 5063;
    let settled = false;
    const second = Bank.close().then(result => { settled = true; return result; });
    await pump();
    const premature = settled;
    await receive(client, ServerProt.IF_CLOSE, new Packet(new Uint8Array(0)));
    await pump();
    expect(await second).toBe(true);
    expect(premature).toBe(false);
    expect(client['out'].pos).toBe(2);
});

test('fresh acknowledgement does not report a reopened bank closed', async () => {
    const client = await openBank();
    const closing = Bank.close(1);
    await receive(client, ServerProt.IF_CLOSE, new Packet(new Uint8Array(0)));
    client['mainModalId'] = 5292;
    await pump();
    expect(await closing).toBe(false);
});

for (const replace of ['detach', 'reattach', 'stream', 'login', 'logout'] as const) {
    test(`${replace} invalidates a pending close even with a fresh acknowledgement`, async () => {
        const client = await openBank();
        const closing = Bank.close();
        switch (replace) {
            case 'detach': detach(); break;
            case 'reattach': detach(); attach(client); break;
            case 'stream': client['stream'] = Object.create(ClientStream.prototype); break;
            case 'login': client['statSessionGeneration']++; break;
            case 'logout': client['ingame'] = false; break;
        }
        await receive(client, ServerProt.IF_CLOSE, new Packet(new Uint8Array(0)));
        await pump();
        expect(await closing).toBe(false);
    });
}

test('timeout retry keeps the original baseline without sending a duplicate close', async () => {
    const client = await openBank();
    const first = Bank.close(1);
    await pump();
    expect(await first).toBe(false);
    let settled = false;
    const retry = Bank.close().then(result => { settled = true; return result; });
    await pump();
    const premature = settled;
    await receive(client, ServerProt.IF_CLOSE, new Packet(new Uint8Array(0)));
    await pump();
    expect(await retry).toBe(true);
    expect(premature).toBe(false);
    expect(client['out'].pos).toBe(1);
});

test('cancellation propagates and retry still waits for the pending close', async () => {
    const client = await openBank();
    const context = new ScriptContext();
    restores.push(stubProps(Scheduler, { active: context }));
    const closing = Bank.close();
    const rejected = closing.catch(error => error);
    context.state = 'stopping';
    context.waiters.splice(0).forEach(waiter => waiter.reject(new ScriptAborted()));
    expect(await rejected).toBeInstanceOf(ScriptAborted);
    context.state = 'running';
    const retry = Bank.close(1);
    await pump();
    expect(await retry).toBe(false);
    await receive(client, ServerProt.IF_CLOSE, new Packet(new Uint8Array(0)));
    const acknowledged = Bank.close();
    await pump();
    expect(await acknowledged).toBe(true);
    expect(client['out'].pos).toBe(1);
});

test('failed close action leaves no pending close', async () => {
    const client = await openBank();
    const { actions } = await import('#/bot/adapter/ClientAdapter.js');
    restores.push(stubProps(actions, { menuAction: () => false }));
    expect(await Bank.close()).toBe(false);
    client['mainModalId'] = -1;
    client['sideModalId'] = -1;
    expect(await Bank.close()).toBe(true);
    expect(client['out'].pos).toBe(0);
});

test('truly closed bank returns immediately without sending a close', async () => {
    const client = clientFixture();
    restores.push(stubProps(reader, { bankComId: () => -1 }));
    expect(await Bank.close()).toBe(true);
    expect(client['out'].pos).toBe(0);
});

test('attached production with missing observation fails closed', async () => {
    const client = await openBank();
    Reflect.deleteProperty(client, 'modalCloseGeneration');
    const closing = Bank.close();
    await pump();
    expect(await closing).toBe(false);
    expect(client['out'].pos).toBe(0);
});

test('does not authorize opening a casket before the bank close reaches the server', async () => {
    const client = clientFixture();
    client['mainModalId'] = 5292;
    client['sideModalId'] = 5063;
    restores.push(stubProps(reader, {
        bankComId: () => client['mainModalId'] === 5292 ? 5382 : -1,
        closeButtonComId: () => 5384
    }));
    const { actions } = await import('#/bot/adapter/ClientAdapter.js');
    restores.push(stubProps(actions, { menuAction: () => { client['closeModal'](); return true; } }));

    let settled = false;
    const closing = Bank.close().then(result => { settled = true; return result; });
    Scheduler['pump']();
    await new Promise<void>(resolve => setImmediate(resolve));
    const settledBeforeAcknowledgement = settled;

    await receive(client, ServerProt.IF_CLOSE, new Packet(new Uint8Array(0)));
    Scheduler['pump']();
    expect(await closing).toBe(true);

    expect(client['out'].data[0]).toBe(ClientProt.CLOSE_MODAL);
    expect(reader.modals()).toEqual({ main: -1, side: -1, chat: -1 });
    expect(settledBeforeAcknowledgement).toBe(false);
});
