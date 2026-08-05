import { describe, expect, test } from 'bun:test';
import {
    PRODUCER_MID_TICK_MS,
    decideProducerPass,
    type ProducerCadenceState
} from '#/bot/events/producerCadence.js';

const fresh: ProducerCadenceState = { lastTick: -1, lastMidAt: 0 };

describe('decideProducerPass', () => {
    test('first observation is always a full scan', () => {
        const d = decideProducerPass(0, 1000, fresh);
        expect(d.pass).toBe('full');
        expect(d.tickAdvanced).toBe(true);
        expect(d.state.lastTick).toBe(0);
    });

    test('same tick within mid interval skips', () => {
        const afterFull = decideProducerPass(5, 1000, fresh).state;
        const d = decideProducerPass(5, 1000 + PRODUCER_MID_TICK_MS - 1, afterFull);
        expect(d.pass).toBe('skip');
        expect(d.tickAdvanced).toBe(false);
    });

    test('same tick after mid interval does a mid (inv/chat) pass', () => {
        const afterFull = decideProducerPass(5, 1000, fresh).state;
        const d = decideProducerPass(5, 1000 + PRODUCER_MID_TICK_MS, afterFull);
        expect(d.pass).toBe('mid');
        expect(d.tickAdvanced).toBe(false);
    });

    test('new server tick always full-scans and advances tick', () => {
        let state = decideProducerPass(5, 1000, fresh).state;
        state = decideProducerPass(5, 1000 + PRODUCER_MID_TICK_MS, state).state;
        const d = decideProducerPass(6, 1100, state);
        expect(d.pass).toBe('full');
        expect(d.tickAdvanced).toBe(true);
        expect(d.state.lastTick).toBe(6);
    });
});
