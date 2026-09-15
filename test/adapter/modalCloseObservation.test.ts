import { afterEach, expect, test } from 'bun:test';
import { actions, attach, detach, reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Client } from '#/client/shell/Client.js';
import ClientStream from '#/client/io/ClientStream.js';
import { stubProps } from '../lib/stubSingletons.js';

const restores: (() => void)[] = [];
afterEach(() => {
    restores.splice(0).reverse().forEach(restore => restore());
    detach();
});

function fixture(): Client {
    const client: Client = Object.create(Client.prototype);
    client['ingame'] = true;
    client['statSessionGeneration'] = 1;
    client['modalCloseGeneration'] = 0;
    client['stream'] = Object.create(ClientStream.prototype);
    attach(client);
    return client;
}

test('observation exposes only an opaque stable session and generation', () => {
    const client = fixture();
    const baseline = reader.modalCloseObservation();
    if (!baseline) { throw new Error('fixture has no close observation'); }
    client['modalCloseGeneration']++;
    expect(reader.modalCloseObservation()).toEqual({ session: baseline.session, generation: 1 });
    expect(typeof baseline.session).toBe('symbol');
});

test('reattaching the same client without detach replaces its token', () => {
    const client = fixture();
    const baseline = reader.modalCloseObservation();
    attach(client);
    expect(reader.modalCloseObservation()?.session).not.toBe(baseline?.session);
});

test('observed logout invalidates the token even before login generation changes', () => {
    const client = fixture();
    const baseline = reader.modalCloseObservation();
    client['ingame'] = false;
    expect(reader.modalCloseObservation()).toBeNull();
    client['ingame'] = true;
    expect(reader.modalCloseObservation()?.session).not.toBe(baseline?.session);
});

for (const field of ['stream', 'modalCloseGeneration', 'statSessionGeneration'] as const) {
    test(`missing ${field} fails closed`, () => {
        const client = fixture();
        Reflect.deleteProperty(client, field);
        expect(reader.modalCloseObservation()).toBeNull();
    });
}

for (const generation of [-1, NaN, Infinity, 0.5]) {
    test(`invalid close generation ${generation} fails closed`, () => {
        const client = fixture();
        client['modalCloseGeneration'] = generation;
        expect(reader.modalCloseObservation()).toBeNull();
    });
}

for (const attached of [true, false]) {
    test(`missing reader method ${attached ? 'fails closed while attached' : 'retains the legacy local fallback'}`, async () => {
        if (attached) { fixture(); } else { detach(); }
        let open = true;
        let sent = 0;
        restores.push(stubProps(reader, { bankComId: () => open ? 5382 : -1, modals: () => ({ main: -1, side: -1, chat: -1 }) }));
        restores.push(stubProps(reader, { modalCloseObservation: reader.modalCloseObservation }));
        Reflect.deleteProperty(reader, 'modalCloseObservation');
        restores.push(stubProps(actions, { closeModal: () => { sent++; open = false; return true; } }));
        restores.push(stubProps(Execution, { delayUntil: async condition => condition() }));

        expect(await Bank.close()).toBe(!attached);
        expect(sent).toBe(attached ? 0 : 1);
    });
}
