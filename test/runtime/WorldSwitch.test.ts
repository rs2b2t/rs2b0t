import { expect, test } from 'bun:test';
import { waitForWorldSwitch } from '#/bot/runtime/WorldSwitch.js';

test('logout refusal times out without reporting a completed switch', async () => {
    expect(await waitForWorldSwitch(() => false, new AbortController().signal, 0)).toBe(false);
});

test('cancellation stops polling even if the session becomes ready later', async () => {
    const abort = new AbortController();
    let polls = 0;
    const switching = waitForWorldSwitch(() => ++polls > 1, abort.signal);
    abort.abort();
    expect(await switching).toBe(false);
    expect(polls).toBe(1);
});

test('an already cancelled switch never starts logout', async () => {
    const abort = new AbortController();
    abort.abort();
    let polls = 0;
    expect(await waitForWorldSwitch(() => { polls++; return true; }, abort.signal)).toBe(false);
    expect(polls).toBe(0);
});
