import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('#3rdparty/audio.js', () => ({ playWave: async (): Promise<void> => {}, setWaveVolume: (): void => {} }));
mock.module('#3rdparty/tinymidipcm.js', () => ({ playMidi: (): void => {}, setMidiVolume: (): void => {}, stopMidi: (): void => {} }));

const { RandomEventGuardian } = await import('#/bot/runtime/RandomEventGuardian.js');
const { RandomEvents } = await import('#/bot/api/RandomEvents.js');
const { Game } = await import('#/bot/api/Game.js');
const { BotHost } = await import('#/bot/BotHost.js');
const { Execution } = await import('#/bot/api/Execution.js');
const { Scheduler } = await import('#/bot/runtime/Scheduler.js');
const { ScriptContext } = await import('#/bot/runtime/ScriptContext.js');
const { ScriptRunner } = await import('#/bot/runtime/ScriptRunner.js');

/**
 * When an event lands at a loop boundary, Supervisor turns the loop iteration
 * into an event-wait: loopInFlight stays true while the iteration parks on
 * `delayUntil(detect() === null)`, expecting the guardian to clear the event
 * (genie hands a lamp; the lamp is its own follow-up event). The guardian must
 * handle regardless of that parked iteration — if it waits for the loop to
 * yield, the two deadlock: script waits for the event to clear, guardian waits
 * for the script to yield, and the bot freezes until a manual stop.
 */
describe('RandomEventGuardian with a parked script loop', () => {
    let origDetect: typeof RandomEvents.detect;
    let origHandle: typeof RandomEvents.handle;
    let origReady: typeof Game.sceneReady;
    let tick: number;

    const pumpFrames = async (n: number): Promise<void> => {
        for (let i = 0; i < n; i++) {
            BotHost.onFrame();
            await Promise.resolve();
            await Promise.resolve();
        }
    };

    beforeEach(() => {
        tick = 50_000;
        origDetect = RandomEvents.detect;
        origHandle = RandomEvents.handle;
        origReady = Game.sceneReady;
        Game.sceneReady = (): boolean => true;
        Object.defineProperty(BotHost, 'tickCount', { get: () => tick, configurable: true });
        RandomEventGuardian.enable();
    });

    afterEach(() => {
        RandomEvents.detect = origDetect;
        RandomEvents.handle = origHandle;
        Game.sceneReady = origReady;
        Scheduler.active = null;
        ScriptRunner.ctx = null;
    });

    test('handles the event while the loop iteration is parked awaiting it', async () => {
        let eventActive = true;
        let handleCalls = 0;
        RandomEvents.detect = (): ReturnType<typeof origDetect> =>
            (eventActive ? { kind: 'lamp', name: 'lamp' } : null) as ReturnType<typeof origDetect>;
        RandomEvents.handle = (async (): Promise<boolean> => {
            handleCalls++;
            eventActive = false;
            return true;
        }) as typeof origHandle;

        const ctx = new ScriptContext();
        ctx.state = 'running';
        ctx.loopInFlight = true;
        Scheduler.active = ctx;
        ScriptRunner.ctx = ctx;

        // Supervisor's event-wait iteration: parked on the script queue until
        // the guardian clears the event.
        const parked = Execution.delayUntil(() => !eventActive, 60_000);

        tick++;
        await pumpFrames(6);

        expect(handleCalls).toBe(1);
        expect(eventActive).toBe(false);
        await expect(parked).resolves.toBe(true);
    });
});
