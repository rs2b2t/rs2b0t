import { afterEach, describe, expect, test } from 'bun:test';

import { pressCleanLogout } from '../../e2e/lib/cleanLogout.js';

const host = globalThis as unknown as Record<string, unknown>;
const saved = Object.getOwnPropertyDescriptor(globalThis, 'rs2b0t');
afterEach(() => {
    if (saved) {
        Object.defineProperty(globalThis, 'rs2b0t', saved);
    } else {
        delete host.rs2b0t;
    }
});

function fixture(buttonSent = true) {
    const presses: number[] = [];
    const polls: boolean[] = [];
    let logouts = 0;
    const client = {
        ingame: true,
        logoutTimer: 0,
        stream: { remoteClosed: false, socket: { readyState: 1 } },
        logout: () => { logouts++; client.ingame = false; }
    };
    host.rs2b0t = { client, actions: { ifButton: (com: number) => { presses.push(com); return buttonSent; } } };
    const page = {
        evaluate: async <R, A>(fn: (arg: A) => R, arg: A): Promise<R> => fn(arg),
        waitForFunction: async (fn: () => boolean) => {
            polls.push(fn());
            if (!polls[0]) {
                client.stream.remoteClosed = true;
                polls.push(fn());
            }
            if (!polls.at(-1)) { throw new Error('logout timed out'); }
        }
    };
    return { page, client, presses, polls, logouts: () => logouts };
}

describe('clean logout', () => {
    test('presses once, arms the timer and leaves the game when the socket closes', async () => {
        const f = fixture();
        expect(await pressCleanLogout(f.page)).toBe('ifbutton');
        expect(f.presses).toEqual([2458]);
        expect(f.client.logoutTimer).toBe(250);
        expect(f.polls).toEqual([false, true]);
        expect(f.client.ingame).toBe(false);
        expect(f.logouts()).toBe(1);
    });

    test('falls back to client logout when the button cannot be sent', async () => {
        const f = fixture(false);
        expect(await pressCleanLogout(f.page)).toBe('client');
        expect(f.client.ingame).toBe(false);
        expect(f.logouts()).toBe(1);
    });

    test('missing client cannot be reported as a successful logout', async () => {
        const f = fixture();
        delete host.rs2b0t;
        await expect(pressCleanLogout(f.page)).rejects.toThrow('client unavailable');
    });
});
