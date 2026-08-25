import { beforeEach, describe, expect, test } from 'bun:test';

import {
    advertiseDue,
    Desk,
    freshChatLines,
    RateLimiter,
    shouldRestock,
    shouldSettle,
    type Engagement,
    type Quote
} from '#/bot/scripts/MarketMaker/marketMakerLogic.js';

const IRON = 440;
const COINS = 995;

function quote(customer: string, atMs = 0, over: Partial<Quote> = {}): Quote {
    return { customer, kind: 'sell', itemId: IRON, qty: 100, unitPrice: 22, quotedAtMs: atMs, ...over };
}

function engagement(customer: string, atMs = 0): Engagement {
    return {
        customer,
        kind: 'sell',
        give: new Map([[IRON, 100]]),
        get: new Map([[COINS, 2200]]),
        startedAtMs: atMs,
        opened: false
    };
}

let desk: Desk;

beforeEach(() => {
    desk = new Desk(8);
});

describe('quotes are indicative, not a place in line', () => {
    test('a live quote comes back until it expires', () => {
        desk.quote(quote('alice', 0));
        expect(desk.liveQuote('alice', 30_000, 60_000)?.qty).toBe(100);
        expect(desk.liveQuote('alice', 61_000, 60_000)).toBeNull();
    });

    test('lookup is case-insensitive, since the client capitalises names', () => {
        desk.quote(quote('alice', 0));
        expect(desk.liveQuote('Alice', 0, 60_000)).not.toBeNull();
    });

    test('re-quoting replaces rather than stacking', () => {
        desk.quote(quote('alice', 0));
        desk.quote(quote('alice', 5_000, { qty: 50 }));
        expect(desk.liveQuote('alice', 5_000, 60_000)?.qty).toBe(50);
        expect(desk.quoteCount()).toBe(1);
    });

    // Why: an unbounded quote map is a memory griefing vector for anyone with throwaway names.
    test('the book is capped, dropping the oldest quote', () => {
        for (let i = 0; i < 10; i++) {
            desk.quote(quote(`p${i}`, i));
        }
        expect(desk.quoteCount()).toBe(8);
        expect(desk.liveQuote('p0', 10, 60_000)).toBeNull();
        expect(desk.liveQuote('p9', 10, 60_000)).not.toBeNull();
    });

    test('pruning drops what has expired', () => {
        desk.quote(quote('alice', 0));
        desk.quote(quote('bob', 50_000));
        desk.prune(60_001, 60_000);
        expect(desk.quoteCount()).toBe(1);
        expect(desk.liveQuote('bob', 60_001, 60_000)).not.toBeNull();
    });

    test('dropping a quote removes it', () => {
        desk.quote(quote('alice', 0));
        desk.dropQuote('ALICE');
        expect(desk.liveQuote('alice', 0, 60_000)).toBeNull();
    });
});

describe('one customer at a time', () => {
    test('nothing is served until a customer is started', () => {
        expect(desk.current()).toBeNull();
    });

    test('starting sets the served customer', () => {
        desk.startServing(engagement('alice'));
        expect(desk.current()?.customer).toBe('alice');
    });

    test('finishing clears it', () => {
        desk.startServing(engagement('alice'));
        desk.finishServing();
        expect(desk.current()).toBeNull();
    });

    test('markOpened flags the served engagement', () => {
        desk.startServing(engagement('alice'));
        desk.markOpened();
        expect(desk.current()?.opened).toBe(true);
    });

    // Why: the whole transaction, bank trip included, sits under one deadline.
    test('the served customer is stale past the window', () => {
        desk.startServing(engagement('alice', 1_000));
        expect(desk.staleServing(60_000, 90_000)).toBeNull();
        expect(desk.staleServing(92_000, 90_000)?.customer).toBe('alice');
    });
});

describe('cooldowns punish the griefer, not the queue', () => {
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

    // Why: this is the inversion the FIFO queue got backwards. Stalling costs the staller their
    // Why: access, and everyone else keeps trading while they wait it out.
    test('a stalling attacker cannot starve an honest customer', () => {
        desk.quote(quote('mallory', 0));
        desk.startServing(engagement('mallory', 0));

        const stale = desk.staleServing(95_000, 90_000);
        expect(stale?.customer).toBe('mallory');
        desk.finishServing();
        desk.cool('mallory', 95_000 + 60_000);
        desk.dropQuote('mallory');

        // Mallory keeps typing; the bot ignores them and serves Alice.
        expect(desk.onCooldown('mallory', 100_000)).toBe(true);
        desk.quote(quote('alice', 100_000));
        desk.startServing(engagement('alice', 100_000));
        expect(desk.current()?.customer).toBe('alice');
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

describe('shouldRestock', () => {
    test('true when the pack is short of what was promised', () => {
        expect(shouldRestock(new Map([[IRON, 100]]), () => 50)).toBe(true);
    });

    test('false when the pack already holds it', () => {
        expect(shouldRestock(new Map([[IRON, 100]]), () => 100)).toBe(false);
    });

    test('an empty need never restocks', () => {
        expect(shouldRestock(new Map(), () => 0)).toBe(false);
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

    // Why: this is the case a newest-signature mark loses, and repeating yourself is what a customer
    // Why: does the moment the shop looks like it ignored them.
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
