import { afterEach, describe, expect, test } from 'bun:test';

import { actions, attach, detach, reader } from '#/bot/adapter/ClientAdapter.js';
import { Client } from '#/client/shell/Client.js';
import Packet from '#/client/io/Packet.js';

interface Said {
    type: number;
    text: string;
    sender: string;
}

/** Enough of the client for a public line: the outbound packet, the speaker, and the chat sink. */
function fakeClient(name: string | null = 'Elliott') {
    const said: Said[] = [];
    return {
        said,
        out: new Packet(new Uint8Array(512)),
        statSessionGeneration: 0,
        chatType: new Int32Array(100),
        chatUsername: new Array<string | null>(100).fill(null),
        chatText: new Array<string | null>(100).fill(null),
        localPlayer: { name, chatMessage: null as string | null, chatColour: 9, chatEffect: 9, chatTimer: 0 },
        addChat(type: number, text: string, sender: string): void {
            said.unshift({ type, text, sender });
        }
    };
}

afterEach(() => detach());

// Why: the echo calls straight into the client's own chat sink, which the adapter reaches by name, so a rename there would only show up as a mute shop at runtime.
test('the client still has the chat sink the echo calls', () => {
    expect(typeof (Client.prototype as unknown as { addChat?: unknown }).addChat).toBe('function');
});

// Why: the server never sends your own public line back, the client echoes it as it writes the packet, and sayPublic wrote the packet without the echo, so the operator watched a silent shop.
describe('sayPublic', () => {
    test('puts the line in the operator\'s own chat, as the speaker', () => {
        const client = fakeClient();
        attach(client);

        expect(actions.sayPublic('Iron ore 18-22.')).toBe(true);
        expect(client.said[0]).toEqual({ type: 2, text: 'Iron ore 18-22.', sender: 'Elliott' });
    });

    test('shows the bubble over the bot\'s own head', () => {
        const client = fakeClient();
        attach(client);

        actions.sayPublic('Trade me.');
        expect(client.localPlayer.chatMessage).toBe('Trade me.');
        expect(client.localPlayer.chatColour).toBe(0);
        expect(client.localPlayer.chatEffect).toBe(0);
        expect(client.localPlayer.chatTimer).toBeGreaterThan(0);
    });

    test('still writes the packet when there is no local player to echo to', () => {
        const client = { out: new Packet(new Uint8Array(512)), statSessionGeneration: 0, localPlayer: null };
        attach(client);

        expect(actions.sayPublic('Trade me.')).toBe(true);
    });

    test('says nothing on an empty line', () => {
        const client = fakeClient();
        attach(client);

        expect(actions.sayPublic('   ')).toBe(false);
        expect(client.said.length).toBe(0);
    });

    test('the shop reads its own line back, so it must carry the shop\'s name', () => {
        const client = fakeClient();
        attach(client);

        actions.sayPublic('Nothing listed right now.');
        expect(client.said[0].sender).toBe(reader.localPlayerName()!);
    });
});
