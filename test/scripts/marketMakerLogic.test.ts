import { beforeEach, describe, expect, test } from 'bun:test';

import {
    advertiseDue,
    decideBeat,
    Desk,
    freshChatLines,
    RateLimiter,
    shouldSettle,
    sideSignature,
    type Intent,
    type Window
} from '#/bot/scripts/MarketMaker/marketMakerLogic.js';

const IRON = 440;
const COINS = 995;

function intent(customer: string, atMs = 0, over: Partial<Intent> = {}): Intent {
    return { customer, itemId: IRON, maxQty: 100, askedAtMs: atMs, ...over };
}

function windowAt(over: Partial<Window> = {}): Window {
    return {
        customer: 'alice',
        openedAtMs: 0,
        stillBeats: 3,
        reOffers: 0,
        lastSig: '440x100',
        sawOpen: true,
        accepted: null,
        ...over
    };
}

let desk: Desk;

beforeEach(() => {
    desk = new Desk(8);
});

describe('intents are a request, not a promise', () => {
    test('a live intent comes back until it expires', () => {
        desk.remember(intent('alice', 0));
        expect(desk.intentFor('alice', 30_000, 60_000)?.maxQty).toBe(100);
        expect(desk.intentFor('alice', 61_000, 60_000)).toBeNull();
    });

    test('lookup is case-insensitive, since the client capitalises names', () => {
        desk.remember(intent('alice', 0));
        expect(desk.intentFor('Alice', 0, 60_000)).not.toBeNull();
    });

    test('asking again replaces rather than stacking', () => {
        desk.remember(intent('alice', 0));
        desk.remember(intent('alice', 5_000, { maxQty: 50 }));
        expect(desk.intentFor('alice', 5_000, 60_000)?.maxQty).toBe(50);
        expect(desk.intentCount()).toBe(1);
    });

    // Why: an unbounded map is a memory griefing vector for anyone with throwaway names.
    test('the book is capped, dropping the oldest', () => {
        for (let i = 0; i < 10; i++) {
            desk.remember(intent(`p${i}`, i));
        }
        expect(desk.intentCount()).toBe(8);
        expect(desk.intentFor('p0', 10, 60_000)).toBeNull();
    });

    test('pruning drops what has expired', () => {
        desk.remember(intent('alice', 0));
        desk.remember(intent('bob', 50_000));
        desk.pruneIntents(60_001, 60_000);
        expect(desk.intentCount()).toBe(1);
    });

    test('nextIntent is the oldest live one, which is whose goods get fetched', () => {
        desk.remember(intent('alice', 0));
        desk.remember(intent('bob', 1_000));
        expect(desk.nextIntent(2_000, 60_000)?.customer).toBe('alice');
        desk.forget('alice');
        expect(desk.nextIntent(2_000, 60_000)?.customer).toBe('bob');
    });

    test('nextIntent skips expired ones', () => {
        desk.remember(intent('alice', 0));
        expect(desk.nextIntent(90_000, 60_000)).toBeNull();
    });
});

describe('one window at a time', () => {
    test('nothing is open until a window is', () => {
        expect(desk.current()).toBeNull();
    });

    test('opening names the customer and zeroes the counters', () => {
        const w = desk.open('alice', 1_000);
        expect(w.customer).toBe('alice');
        expect(w.stillBeats).toBe(0);
        expect(w.reOffers).toBe(0);
        expect(desk.current()).toBe(w);
    });

    // Why: asking for a window is not the same as getting one. A request sent as a modal closes opens
    // Why: it on their client alone, and the bot would otherwise hold a window it cannot see.
    test('a fresh window has not been seen open yet', () => {
        expect(desk.open('alice', 0).sawOpen).toBe(false);
    });

    test('closing clears it', () => {
        desk.open('alice', 0);
        desk.close();
        expect(desk.current()).toBeNull();
    });

    // Why: the transaction sits under one deadline, so nothing can hold the counter open.
    test('a window goes stale past its deadline', () => {
        desk.open('alice', 1_000);
        expect(desk.expired(60_000, 90_000)).toBe(false);
        expect(desk.expired(92_000, 90_000)).toBe(true);
    });

    test('a closed desk is never expired', () => {
        expect(desk.expired(999_999, 1)).toBe(false);
    });
});

describe('cooldowns punish the staller', () => {
    test('a cooled customer is ignored until the deadline', () => {
        desk.cool('mallory', 60_000);
        expect(desk.onCooldown('mallory', 59_000)).toBe(true);
        expect(desk.onCooldown('mallory', 60_001)).toBe(false);
    });

    test('cooling is case-insensitive', () => {
        desk.cool('Mallory', 60_000);
        expect(desk.onCooldown('mallory', 0)).toBe(true);
    });

    test('an uncooled customer is never blocked', () => {
        expect(desk.onCooldown('alice', 999_999)).toBe(false);
    });
});

describe('decideBeat', () => {
    const base = { stillBeatsNeeded: 3, reOfferCap: 12, oweMatched: false, oweAnything: true };

    // Why: any change resets both accepts, so acting on a moving side means neither ever settles.
    test('a side that just moved is always waited on', () => {
        const beat = decideBeat({ ...base, theirSig: '440x150', window: windowAt(), oweMatched: true });
        expect(beat).toEqual({ do: 'wait', reason: 'their side moved' });
    });

    test('a still side that has not settled long enough waits', () => {
        const beat = decideBeat({ ...base, theirSig: '440x100', window: windowAt({ stillBeats: 2 }) });
        expect(beat.do).toBe('wait');
    });

    test('an empty window waits rather than accepting nothing', () => {
        const beat = decideBeat({ ...base, theirSig: '', window: windowAt({ lastSig: '' }), oweAnything: false });
        expect(beat).toEqual({ do: 'wait', reason: 'nothing to trade yet' });
    });

    test('a settled side the bot has not matched gets an offer', () => {
        const beat = decideBeat({ ...base, theirSig: '440x100', window: windowAt() });
        expect(beat.do).toBe('offer');
    });

    test('a settled side the bot has matched is accepted', () => {
        const beat = decideBeat({ ...base, theirSig: '440x100', window: windowAt(), oweMatched: true });
        expect(beat).toEqual({ do: 'accept' });
    });

    // Why: each re-offer costs clicks and resets both accepts, so a patient toggler could waste the whole window.
    test('past the re-offer cap it gives up rather than keep paying', () => {
        const beat = decideBeat({ ...base, theirSig: '440x100', window: windowAt({ reOffers: 12 }) });
        expect(beat.do).toBe('give-up');
    });

    test('the cap does not fire on a window it has already matched', () => {
        const beat = decideBeat({
            ...base,
            theirSig: '440x100',
            window: windowAt({ reOffers: 99 }),
            oweMatched: true
        });
        expect(beat).toEqual({ do: 'accept' });
    });

    // Why: this is the steady-state claim. Nothing changing means nothing happens.
    test('a beat that repeats with no change decides the same thing twice', () => {
        const input = { ...base, theirSig: '440x100', window: windowAt(), oweMatched: true };
        expect(decideBeat(input)).toEqual(decideBeat(input));
    });
});

describe('sideSignature', () => {
    test('order does not matter', () => {
        expect(sideSignature(new Map([[440, 10], [995, 5]]))).toBe(sideSignature(new Map([[995, 5], [440, 10]])));
    });

    test('a count change changes the signature', () => {
        expect(sideSignature(new Map([[440, 10]]))).not.toBe(sideSignature(new Map([[440, 11]])));
    });

    test('empty is stable', () => {
        expect(sideSignature(new Map())).toBe('');
    });
});

describe('RateLimiter', () => {
    test('allows up to the cap inside the window', () => {
        const rl = new RateLimiter(3, 10_000, 30_000);
        expect(rl.allow('alice', 0)).toBe(true);
        expect(rl.allow('alice', 1_000)).toBe(true);
        expect(rl.allow('alice', 2_000)).toBe(true);
    });

    test('the next one trips the penalty', () => {
        const rl = new RateLimiter(3, 10_000, 30_000);
        for (let i = 0; i < 3; i++) {
            rl.allow('alice', i * 100);
        }
        expect(rl.allow('alice', 400)).toBe(false);
        expect(rl.allow('alice', 20_000)).toBe(false);
        expect(rl.allow('alice', 30_401)).toBe(true);
    });

    test('the window slides, so a steady talker is never penalised', () => {
        const rl = new RateLimiter(3, 10_000, 30_000);
        for (let t = 0; t < 200_000; t += 5_000) {
            expect(rl.allow('alice', t)).toBe(true);
        }
    });

    test('one player flooding does not limit another', () => {
        const rl = new RateLimiter(2, 10_000, 30_000);
        rl.allow('mallory', 0);
        rl.allow('mallory', 1);
        expect(rl.allow('mallory', 2)).toBe(false);
        expect(rl.allow('alice', 2)).toBe(true);
    });

    test('names are matched case-insensitively', () => {
        const rl = new RateLimiter(1, 10_000, 30_000);
        rl.allow('Mallory', 0);
        expect(rl.allow('mallory', 1)).toBe(false);
    });
});

describe('advertiseDue', () => {
    test('fires once the interval has elapsed', () => {
        expect(advertiseDue(0, 59_000, 60)).toBe(false);
        expect(advertiseDue(0, 60_000, 60)).toBe(true);
    });

    test('zero seconds turns advertising off', () => {
        expect(advertiseDue(0, 999_999, 0)).toBe(false);
    });
});

describe('shouldSettle', () => {
    test('true when free slots run low', () => {
        expect(shouldSettle(2, 0, 50_000)).toBe(true);
    });

    test('true when pack coins pass the float', () => {
        expect(shouldSettle(20, 60_000, 50_000)).toBe(true);
    });

    test('false otherwise', () => {
        expect(shouldSettle(20, 1_000, 50_000)).toBe(false);
    });
});

describe('freshChatLines', () => {
    test('an empty mark primes without replaying history', () => {
        expect(freshChatLines([], ['c', 'b', 'a'])).toEqual([]);
    });

    test('no change means nothing fresh', () => {
        expect(freshChatLines(['b', 'a'], ['b', 'a'])).toEqual([]);
    });

    test('one new line comes back', () => {
        expect(freshChatLines(['b', 'a'], ['c', 'b', 'a'])).toEqual(['c']);
    });

    test('several new lines come back oldest-first', () => {
        expect(freshChatLines(['a'], ['d', 'c', 'b', 'a'])).toEqual(['b', 'c', 'd']);
    });

    // Why: repeating yourself is what a customer does the moment the shop looks like it ignored them.
    test('a verbatim repeat is heard again', () => {
        expect(freshChatLines(['buy', 'x'], ['buy', 'buy', 'x'])).toEqual(['buy']);
    });

    test('the same line three times over is heard three times', () => {
        let prev = ['x'];
        const heard: string[] = [];
        for (let i = 1; i <= 3; i++) {
            const now: string[] = [...Array<string>(i).fill('buy'), 'x'];
            heard.push(...freshChatLines(prev, now));
            prev = now;
        }
        expect(heard).toEqual(['buy', 'buy', 'buy']);
    });

    test('lines that fell off the end of the buffer do not replay everything', () => {
        expect(freshChatLines(['c', 'b', 'a'], ['e', 'd', 'c', 'b'])).toEqual(['d', 'e']);
    });

    test('a buffer with no overlap at all is treated as entirely new', () => {
        expect(freshChatLines(['a'], ['z', 'y'])).toEqual(['y', 'z']);
    });
});

describe('the coin id is never assumed', () => {
    test('sideSignature carries coins like any other id', () => {
        expect(sideSignature(new Map([[COINS, 2200]]))).toBe('995x2200');
    });
});
