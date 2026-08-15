import { describe, expect, test } from 'bun:test';

import { decideOpenTrade, OPEN_REQUEST_EVERY_MS } from '../../../../../src/bot/api/ai/quests/defs/shieldofarrav/partner.js';

const base = { tradeActive: false, partnerNear: true, nowMs: 0, deadlineMs: 90_000, nextRequestAtMs: 0 };

describe('decideOpenTrade', () => {
    test('an open window is done', () => {
        expect(decideOpenTrade({ ...base, tradeActive: true })).toBe('done');
    });

    test('an open window wins over an expired budget', () => {
        expect(decideOpenTrade({ ...base, tradeActive: true, nowMs: 99_000 })).toBe('done');
    });

    // Why: the regression — the giver's next step is a 24-tile round trip to the curator, so the taker's partner walks out of trade range mid-wait and the old code failed the step on a partner that was en route.
    test('a partner out of trade range is waited for, never given up on', () => {
        expect(decideOpenTrade({ ...base, partnerNear: false })).toBe('wait');
    });

    test('a partner out of trade range is never clicked at', () => {
        for (let now = 0; now < 60_000; now += 2_000) {
            expect(decideOpenTrade({ ...base, partnerNear: false, nowMs: now, nextRequestAtMs: 0 })).toBe('wait');
        }
    });

    test('a partner in range is requested when the throttle has elapsed', () => {
        expect(decideOpenTrade({ ...base, nowMs: 5_000, nextRequestAtMs: 5_000 })).toBe('request');
    });

    test('a partner in range is not re-requested inside the throttle', () => {
        expect(decideOpenTrade({ ...base, nowMs: 1_000, nextRequestAtMs: OPEN_REQUEST_EVERY_MS })).toBe('wait');
    });

    // Why: one click and a passive wait is what let a single dropped request cost the attempt.
    test('the request repeats while the partner stays in range', () => {
        let next = 0;
        let sent = 0;
        for (let now = 0; now < 20_000; now += 500) {
            if (decideOpenTrade({ ...base, nowMs: now, nextRequestAtMs: next }) === 'request') {
                sent++;
                next = now + OPEN_REQUEST_EVERY_MS;
            }
        }
        expect(sent).toBeGreaterThan(1);
    });

    test('the budget running out gives up', () => {
        expect(decideOpenTrade({ ...base, nowMs: 90_000 })).toBe('give-up');
        expect(decideOpenTrade({ ...base, nowMs: 90_001, partnerNear: false })).toBe('give-up');
    });
});
