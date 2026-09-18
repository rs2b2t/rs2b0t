import { expect, spyOn, test } from 'bun:test';
import type { Page } from 'playwright-core';
import { KqLootDonor } from '../../e2e/lib/kqLootDonor.js';

test('an uninitialized donor cannot be declared logged out and cleanup stops after one minute', async () => {
    let now = 1000;
    const clock = spyOn(Date, 'now').mockImplementation(() => now);
    const page = Object.assign({} as Page, {
        evaluate: async () => ({ at: now, ingame: null, sceneReady: false, hp: -1, inCombat: false, tick: -1, tile: null, inventory: [], ground: [], chat: [] }),
        waitForTimeout: async (ms: number) => { now += ms; }
    });
    try {
        const donor = new KqLootDonor(page, 'fixture');
        await expect(donor.close()).rejects.toThrow('within 60 seconds');
        expect(now).toBe(61_000);
        expect(donor.proof.loggedOutAt).toBeUndefined();
        expect(donor.proof.failures).toEqual(['Donor logout was not verified within 60 seconds']);
    } finally { clock.mockRestore(); }
});

test('a donor at Shantay waits out combat and confirms offline after the logout input', async () => {
    let now = 1000; let ingame = true; const inputs: number[] = [];
    const clock = spyOn(Date, 'now').mockImplementation(() => now);
    const page = Object.assign({} as Page, {
        evaluate: async (_fn: unknown, arg?: number) => {
            if (typeof arg === 'number') { inputs.push(now); ingame = false; return true; }
            return { at: now, ingame, sceneReady: true, hp: 99, inCombat: now < 2200, tick: 0, tile: { x: 3308, z: 3120, level: 0 }, inventory: [], ground: [], chat: [] };
        },
        waitForFunction: async () => {},
        waitForTimeout: async (ms: number) => { now += ms; }
    });
    try {
        const donor = new KqLootDonor(page, 'fixture');
        await donor.close();
        expect(inputs).toEqual([2200]);
        expect(donor.proof.observations.at(-1)?.ingame).toBe(false);
        expect(donor.proof.loggedOutAt).toBe(2400);
        expect(donor.proof.failures).toEqual([]);
    } finally { clock.mockRestore(); }
});
