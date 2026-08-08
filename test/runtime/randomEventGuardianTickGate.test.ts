import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('#3rdparty/audio.js', () => ({ playWave: async (): Promise<void> => {}, setWaveVolume: (): void => {} }));
mock.module('#3rdparty/tinymidipcm.js', () => ({ playMidi: (): void => {}, setMidiVolume: (): void => {}, stopMidi: (): void => {} }));

const { RandomEventGuardian } = await import('#/bot/runtime/RandomEventGuardian.js');
const { RandomEvents } = await import('#/bot/api/RandomEvents.js');
const { Game } = await import('#/bot/api/Game.js');
const { BotHost } = await import('#/bot/BotHost.js');

/**
 * detectRaw() walks every NPC twice and every scene loc, so it must run once per
 * server tick -- not once per client frame. Stamping the tick only after a
 * successful detect left the guard permanently disarmed whenever nothing was
 * found, which is the steady state: measured 19.7 scans/sec per bot across 27
 * bots, and fixing it cut main-thread stall from 938ms/s to 276ms/s.
 */
describe('RandomEventGuardian tick gate', () => {
    let detectCalls: number;
    let origDetect: typeof RandomEvents.detect;
    let origReady: typeof Game.sceneReady;
    let tick: number;

    const kickFrame = async (): Promise<void> => {
        BotHost.onFrame();
        await Promise.resolve();
    };

    // the guardian is a singleton and remembers its last tick, so each test needs a
    // tick range that cannot collide with the previous test's leftover stamp
    let tickBase = 1000;

    beforeEach(() => {
        detectCalls = 0;
        tickBase += 1000;
        tick = tickBase;
        origDetect = RandomEvents.detect;
        origReady = Game.sceneReady;
        Game.sceneReady = (): boolean => true;
        Object.defineProperty(BotHost, 'tickCount', { get: () => tick, configurable: true });
        RandomEventGuardian.enable();
    });

    afterEach(() => {
        RandomEvents.detect = origDetect;
        Game.sceneReady = origReady;
    });

    test('scans at most once per server tick while nothing is found', async () => {
        RandomEvents.detect = (): null => {
            detectCalls++;
            return null;
        };

        // many client frames inside one server tick
        for (let i = 0; i < 24; i++) {
            await kickFrame();
        }
        expect(detectCalls).toBe(1);

        tick++;
        for (let i = 0; i < 24; i++) {
            await kickFrame();
        }
        expect(detectCalls).toBe(2);
    });

    test('a quiet tick still arms the guard, so cost does not scale with frame rate', async () => {
        RandomEvents.detect = (): null => {
            detectCalls++;
            return null;
        };

        for (let t = 0; t < 5; t++) {
            tick++;
            for (let i = 0; i < 50; i++) {
                await kickFrame();
            }
        }

        // one scan per tick regardless of how many frames each tick contained
        expect(detectCalls).toBe(5);
    });
});
