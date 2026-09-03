import { afterEach, describe, expect, mock, test } from 'bun:test';

mock.module('#/client/3rdparty/audio.js', () => ({ playWave: async (): Promise<void> => {}, setWaveVolume: (): void => {} }));
mock.module('#/client/3rdparty/tinymidipcm.js', () => ({ playMidi: (): void => {}, setMidiVolume: (): void => {}, stopMidi: (): void => {} }));

const { RandomEvents } = await import('#/bot/runtime/randomevents/RandomEvents.js');
const { ScriptContext } = await import('#/bot/runtime/ScriptContext.js');
const { Scheduler } = await import('#/bot/runtime/Scheduler.js');
const { Supervisor } = await import('#/bot/runtime/Supervisor.js');
const { Execution } = await import('#/bot/api/execution/Execution.js');
const { AbstractBot } = await import('#/bot/api/bot/Bot.js');

const WEDGE_MS = 10 * 60_000;

class Stall extends AbstractBot {
    loop(): void {}
}

const realNow = performance.now.bind(performance);
const realDetect = RandomEvents.detect;

function at(ms: number): void {
    performance.now = (): number => ms;
}

afterEach(() => {
    performance.now = realNow;
    RandomEvents.detect = realDetect;
    Scheduler.active = null;
});

/** A shop trades from one tile and gains no xp, and both are the only progress the wedge check can see. */
describe('Supervisor wedge', () => {
    test('a bot that never moves and never gains xp is restarted', () => {
        RandomEvents.detect = (): null => null;
        at(1_000_000);
        Supervisor.resetProgress();
        const ctx = new ScriptContext();

        expect(Supervisor.intercept(ctx, new Stall())).toBeNull();

        at(1_000_000 + WEDGE_MS + 1);
        expect(Supervisor.intercept(ctx, new Stall())?.label).toBe('watchdog recovery');
    });

    test('Supervisor.noteProgress holds the wedge off for a bot doing work it cannot see', () => {
        RandomEvents.detect = (): null => null;
        at(2_000_000);
        Supervisor.resetProgress();
        const ctx = new ScriptContext();

        for (let t = 2_000_000; t <= 2_000_000 + WEDGE_MS * 3; t += WEDGE_MS / 2) {
            at(t);
            Supervisor.noteProgress();
            expect(Supervisor.intercept(ctx, new Stall())).toBeNull();
        }

        at(2_000_000 + WEDGE_MS * 3 + WEDGE_MS + 1);
        expect(Supervisor.intercept(ctx, new Stall())?.label).toBe('watchdog recovery');
    });

    test('Execution.noteProgress holds the wedge off and feeds the stall guard', () => {
        RandomEvents.detect = (): null => null;
        at(3_000_000);
        Supervisor.resetProgress();
        const ctx = new ScriptContext();
        Scheduler.active = ctx;

        for (let t = 3_000_000; t <= 3_000_000 + WEDGE_MS * 3; t += WEDGE_MS / 2) {
            at(t);
            Execution.noteProgress();
            expect(ctx.lastProgressAt).toBe(t);
            expect(Supervisor.intercept(ctx, new Stall())).toBeNull();
        }

        at(3_000_000 + WEDGE_MS * 3 + WEDGE_MS + 1);
        expect(Supervisor.intercept(ctx, new Stall())?.label).toBe('watchdog recovery');
    });

    test('a heartbeat from the previous run does not hold the wedge off for the next', () => {
        RandomEvents.detect = (): null => null;
        at(1_500_000);
        Supervisor.resetProgress();
        const ctx = new ScriptContext();
        Scheduler.active = ctx;

        expect(Supervisor.intercept(ctx, new Stall())).toBeNull();

        at(1_500_000 + WEDGE_MS + 1);
        expect(Supervisor.intercept(ctx, new Stall())?.label).toBe('watchdog recovery');
    });

    test('Execution.noteProgress with no script running is a no-op', () => {
        Scheduler.active = null;
        expect(() => Execution.noteProgress()).not.toThrow();
    });
});
