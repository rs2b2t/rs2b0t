import { afterEach, describe, expect, test } from 'bun:test';
import { Execution } from '#/bot/api/Execution.js';
import { BotHost } from '#/bot/BotHost.js';
import { Scheduler } from '#/bot/runtime/Scheduler.js';
import { ScriptContext } from '#/bot/runtime/ScriptContext.js';

/**
 * RandomEventGuardian must settle Execution waits even when a script context
 * exists (paused / mid-loop). hostWaiters + runHost are that path.
 */
describe('Scheduler host scope', () => {
    afterEach(() => {
        Scheduler.active = null;
    });

    test('runHost settles waits while a paused script is active', async () => {
        const ctx = new ScriptContext();
        ctx.pause();
        Scheduler.active = ctx;

        // Without host scope, waits land on the frozen script queue and never
        // resolve while state !== 'running'.
        let hostDone = false;
        const hostPromise = Scheduler.runHost(async () => {
            await Execution.delay(1);
            hostDone = true;
        });

        // Pump a few client frames (Scheduler listens on BotHost frames).
        for (let i = 0; i < 5; i++) {
            BotHost.onFrame();
            await Promise.resolve();
            if (hostDone) {
                break;
            }
            await new Promise(r => setTimeout(r, 5));
        }

        await hostPromise;
        expect(hostDone).toBe(true);
        expect(ctx.waiters).toHaveLength(0);
    });

    test('without runHost, waits on a paused script do not settle', async () => {
        const ctx = new ScriptContext();
        ctx.pause();
        Scheduler.active = ctx;

        let settled = false;
        const p = Execution.delay(1).then(() => {
            settled = true;
        });
        // Attach a no-op catch so an eventual abort/reject later does not warn.
        void p.catch(() => undefined);

        for (let i = 0; i < 5; i++) {
            BotHost.onFrame();
            await Promise.resolve();
            await new Promise(r => setTimeout(r, 5));
        }

        expect(settled).toBe(false);
        expect(ctx.waiters.length).toBeGreaterThan(0);

        // Clean up so the waiter does not leak into other tests.
        ctx.abortWaiters();
        await Promise.resolve();
    });

    test('no active script still uses host waiters', async () => {
        Scheduler.active = null;
        let done = false;
        const p = Execution.delay(1).then(() => {
            done = true;
        });

        for (let i = 0; i < 5; i++) {
            BotHost.onFrame();
            await Promise.resolve();
            if (done) {
                break;
            }
            await new Promise(r => setTimeout(r, 5));
        }

        await p;
        expect(done).toBe(true);
    });
});
