import { describe, expect, test } from 'bun:test';

import ClientStream from '#/client/io/ClientStream.js';

interface FakeSocket {
    binaryType: string;
    url: string;
    onmessage: ((e: { data: ArrayBuffer }) => void) | null;
    onclose: ((e: unknown) => void) | null;
    onerror: ((e: unknown) => void) | null;
    send(data: unknown): void;
    close(): void;
}

const fakeSocket = (): FakeSocket => ({
    binaryType: '',
    url: 'ws://localhost:43594/socket',
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (): void => {},
    close: (): void => {}
});

const deliver = (socket: FakeSocket, bytes: number[]): void => {
    socket.onmessage?.({ data: new Uint8Array(bytes).buffer });
};

describe('ClientStream server liveness', () => {
    test('msSinceData resets when the server sends, regardless of reads', () => {
        const socket = fakeSocket();
        const stream = new ClientStream(socket as unknown as WebSocket);

        deliver(socket, [1, 2, 3, 4]);

        expect(stream.available).toBe(4);
        expect(stream.msSinceData).toBeLessThan(1000);

        // the client never reads those bytes; the connection is still demonstrably alive
        expect(stream.available).toBe(4);
        expect(stream.msSinceData).toBeLessThan(1000);
    });

    test('a closed socket reports the server as indefinitely silent', () => {
        const socket = fakeSocket();
        const stream = new ClientStream(socket as unknown as WebSocket);

        deliver(socket, [7]);
        expect(stream.msSinceData).toBeLessThan(1000);

        expect(stream.closed).toBe(false);
        socket.onclose?.({});
        expect(stream.closed).toBe(true);

        expect(stream.msSinceData).toBe(Number.POSITIVE_INFINITY);
        expect(stream.available).toBe(0);
    });

    test('later sends keep pushing the silence window forward', () => {
        const socket = fakeSocket();
        const stream = new ClientStream(socket as unknown as WebSocket);

        deliver(socket, [1]);
        const first = stream.msSinceData;
        deliver(socket, [2]);
        const second = stream.msSinceData;

        expect(second).toBeLessThanOrEqual(first);
        expect(stream.available).toBe(2);
    });
});
