import { expect, mock, test } from 'bun:test';

import type ClientStream from '#/client/io/ClientStream.js';

mock.module('#/client/3rdparty/audio.js', () => ({
    playWave: async (): Promise<void> => {},
    setWaveVolume: (): void => {}
}));
mock.module('#/client/3rdparty/tinymidipcm.js', () => ({
    playMidi: (): void => {},
    setMidiVolume: (): void => {},
    stopMidi: (): void => {}
}));

const { Client } = await import('#/client/shell/Client.js');

interface AttemptView {
    cancelled: boolean;
    stream: ClientStream | null;
    done: Promise<void>;
}

interface LoginClientView {
    ingame: boolean;
    loginscreen: number;
    loginSelect: number;
    loginMes1: string;
    loginMes2: string;
    loginUser: string;
    loginPass: string;
    statSessionGeneration: number;
    invUpdateState: Map<number, { generation: number; fullGeneration: number; transmitting: boolean }>;
    loginAttempt: AttemptView | null;
    stream: ClientStream | null;
    out: {
        pos: number;
        data: Uint8Array;
        p1(value: number): void;
    };
    titleScreenDraw(): Promise<void>;
    openLoginStream(): Promise<ClientStream>;
    loginSleep(ms: number): Promise<void>;
    startLogin(username: string, password: string): boolean;
    cancelLoginAttempt(): void;
}

class FakeLoginStream {
    closeCount = 0;
    readCount = 0;
    private readonly reads: number[];

    constructor(response: number) {
        this.reads = [...new Array<number>(8).fill(0), response];
    }

    write(_src: Uint8Array, _len: number): void {}

    async read(): Promise<number> {
        this.readCount++;
        const value = this.reads.shift();
        if (value === undefined) {
            throw new Error('fake login stream ran out of bytes');
        }
        return value;
    }

    async readBytes(_dst: Uint8Array, _off: number, _len: number): Promise<void> {}

    close(): void {
        this.closeCount++;
    }
}

class DeferredFirstReadStream {
    closeCount = 0;
    readCount = 0;
    private readonly firstRead: Deferred<number>;
    private readonly reads: number[];

    constructor(firstRead: Deferred<number>, response: number) {
        this.firstRead = firstRead;
        this.reads = [...new Array<number>(7).fill(0), response];
    }

    write(_src: Uint8Array, _len: number): void {}

    async read(): Promise<number> {
        this.readCount++;
        if (this.readCount === 1) {
            return this.firstRead.promise;
        }
        const value = this.reads.shift();
        if (value === undefined) {
            throw new Error('deferred login stream ran out of bytes');
        }
        return value;
    }

    async readBytes(_dst: Uint8Array, _off: number, _len: number): Promise<void> {}

    close(): void {
        this.closeCount++;
    }
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

function asClientStream(stream: FakeLoginStream | DeferredFirstReadStream): ClientStream {
    return stream as unknown as ClientStream;
}

function bareClient(openLoginStream: () => Promise<ClientStream>): LoginClientView {
    const client = Object.create(Client.prototype) as LoginClientView;
    Object.assign(client, {
        ingame: false,
        loginscreen: 0,
        loginSelect: 0,
        loginMes1: '',
        loginMes2: '',
        loginUser: '',
        loginPass: '',
        statSessionGeneration: 0,
        invUpdateState: new Map(),
        loginAttempt: null,
        stream: null,
        out: {
            pos: 0,
            data: new Uint8Array(2),
            p1(this: { pos: number; data: Uint8Array }, value: number): void {
                this.data[this.pos++] = value;
            }
        },
        titleScreenDraw: async (): Promise<void> => {},
        openLoginStream,
        loginSleep: async (): Promise<void> => {}
    });
    return client;
}

test('programmatic login immediately uses the native screen and rejects a concurrent attempt', async () => {
    const firstStream = new FakeLoginStream(5);
    const secondStream = new FakeLoginStream(5);
    const streams = [firstStream, secondStream];
    let opens = 0;
    const client = bareClient(async () => asClientStream(streams[opens++]));

    expect(client.startLogin('alice', 'secret')).toBe(true);
    expect(client.loginscreen).toBe(2);
    expect(client.loginUser).toBe('alice');
    expect(client.loginPass).toBe('secret');
    expect(client.loginMes1).toBe('');
    expect(client.loginMes2).toBe('Connecting to server...');
    expect(client.statSessionGeneration).toBe(1);
    expect(client.startLogin('mallory', 'other')).toBe(false);
    expect(client.statSessionGeneration).toBe(1);

    await client.loginAttempt!.done;
    expect(opens).toBe(1);
    expect(client.loginMes1).toBe('Your account is already logged in.');
    expect(client.loginMes2).toBe('Try again in 60 secs...');
    expect(firstStream.closeCount).toBe(1);
    expect(client.loginAttempt).toBeNull();

    expect(client.startLogin('alice', 'secret')).toBe(true);
    expect(client.statSessionGeneration).toBe(2);
    await client.loginAttempt!.done;
    expect(opens).toBe(2);
});

test('server retry stays inside one public login attempt', async () => {
    const retryStream = new FakeLoginStream(1);
    const resultStream = new FakeLoginStream(5);
    const streams = [retryStream, resultStream];
    const retryDelay = deferred<void>();
    let opens = 0;
    const client = bareClient(async () => asClientStream(streams[opens++]));
    client.loginSleep = async (): Promise<void> => retryDelay.promise;

    expect(client.startLogin('alice', 'secret')).toBe(true);
    expect(client.statSessionGeneration).toBe(1);
    const done = client.loginAttempt!.done;
    while (retryStream.closeCount === 0) {
        await Bun.sleep(0);
    }

    expect(client.startLogin('mallory', 'other')).toBe(false);
    expect(opens).toBe(1);
    retryDelay.resolve();
    await done;

    expect(opens).toBe(2);
    expect(client.statSessionGeneration).toBe(1);
    expect(retryStream.closeCount).toBe(1);
    expect(client.loginMes1).toBe('Your account is already logged in.');
    expect(client.loginMes2).toBe('Try again in 60 secs...');
});

test('cancelling a pending socket releases the gate and closes stale work', async () => {
    const pendingOpen = deferred<ClientStream>();
    const staleStream = new FakeLoginStream(5);
    const nextStream = new FakeLoginStream(5);
    let opening = false;
    let opens = 0;
    const client = bareClient(async () => {
        opens++;
        if (opens === 1) {
            opening = true;
            return pendingOpen.promise;
        }
        return asClientStream(nextStream);
    });

    expect(client.startLogin('alice', 'secret')).toBe(true);
    const done = client.loginAttempt!.done;
    while (!opening) {
        await Bun.sleep(0);
    }
    client.cancelLoginAttempt();
    client.loginscreen = 0;
    client.loginUser = '';
    client.loginPass = '';
    expect(client.loginAttempt).toBeNull();
    expect(client.startLogin('bob', 'new secret')).toBe(true);
    const nextDone = client.loginAttempt!.done;
    pendingOpen.resolve(asClientStream(staleStream));
    await Promise.all([done, nextDone]);

    expect(staleStream.closeCount).toBe(1);
    expect(nextStream.closeCount).toBe(1);
    expect(client.loginscreen).toBe(2);
    expect(client.loginUser).toBe('bob');
    expect(client.loginPass).toBe('new secret');
    expect(client.loginMes1).toBe('Your account is already logged in.');
    expect(client.loginMes2).toBe('Try again in 60 secs...');
    expect(client.loginAttempt).toBeNull();
});

test('a cancelled read cannot consume bytes from the replacement login stream', async () => {
    const oldFirstRead = deferred<number>();
    const nextFirstRead = deferred<number>();
    const oldStream = new DeferredFirstReadStream(oldFirstRead, 5);
    const nextStream = new DeferredFirstReadStream(nextFirstRead, 5);
    const streams = [oldStream, nextStream];
    let opens = 0;
    const client = bareClient(async () => asClientStream(streams[opens++]));

    expect(client.startLogin('alice', 'secret')).toBe(true);
    const oldDone = client.loginAttempt!.done;
    while (oldStream.readCount === 0) {
        await Bun.sleep(0);
    }

    client.cancelLoginAttempt();
    expect(client.startLogin('bob', 'new secret')).toBe(true);
    const nextDone = client.loginAttempt!.done;
    while (nextStream.readCount === 0) {
        await Bun.sleep(0);
    }

    oldFirstRead.resolve(0);
    await Bun.sleep(0);
    expect(oldStream.readCount).toBe(8);
    expect(nextStream.readCount).toBe(1);

    nextFirstRead.resolve(0);
    await Promise.all([oldDone, nextDone]);
    expect(nextStream.readCount).toBe(9);
    expect(client.loginUser).toBe('bob');
    expect(client.loginMes1).toBe('Your account is already logged in.');
});

test('transport failures release the gate and show native connection feedback', async () => {
    const resultStream = new FakeLoginStream(11);
    let opens = 0;
    const client = bareClient(async () => {
        opens++;
        if (opens === 1) {
            throw new Error('synthetic connection failure');
        }
        return asClientStream(resultStream);
    });
    const originalError = console.error;
    console.error = (): void => {};
    try {
        expect(client.startLogin('alice', 'secret')).toBe(true);
        await client.loginAttempt!.done;
        expect(client.loginMes1).toBe('');
        expect(client.loginMes2).toBe('Error connecting to server.');
        expect(client.loginAttempt).toBeNull();

        expect(client.startLogin('alice', 'secret')).toBe(true);
        await client.loginAttempt!.done;
        expect(client.loginMes1).toBe('Login server rejected session.');
        expect(client.loginMes2).toBe('Please try again.');
    } finally {
        console.error = originalError;
    }
});
