import { beforeEach, describe, expect, test } from 'bun:test';

import {
    advertiseDue,
    decideBeat,
    Desk,
    freshChatLines,
    dealLine,
    dealOf,
    dealTotals,
    RateLimiter,
    resolveQuote,
    shouldSettle,
    sideSignature,
    type Intent,
    type Window
} from '#/bot/scripts/MarketMaker/marketMakerLogic.js';
import { buildCatalog } from '#/bot/api/market/catalog.js';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';
import type { PriceBook } from '#/bot/api/market/priceBook.js';

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
        waited: 0,
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
    const base = { stillBeatsNeeded: 3, reOfferCap: 12, waitCap: 25, oweMatched: false, wantMatched: true, oweAnything: true };

    // Why: one customer sitting on an open window blocks every customer behind them, so waiting is capped.
    test('waiting is given up on once the customer has sat on it long enough', () => {
        const patient = decideBeat({ ...base, theirSig: '440x100', window: windowAt({ waited: 24 }), wantMatched: false, oweMatched: true });
        expect(patient.do).toBe('wait');

        const done = decideBeat({ ...base, theirSig: '440x100', window: windowAt({ waited: 25 }), wantMatched: false, oweMatched: true });
        expect(done).toEqual({ do: 'give-up', reason: 'you left your side up too long' });
    });

    test('the cap never turns a settleable trade away', () => {
        const beat = decideBeat({ ...base, theirSig: '440x100', window: windowAt({ waited: 999 }), oweMatched: true, wantMatched: true });
        expect(beat).toEqual({ do: 'accept' });
    });

    test('the cap does not stop the shop putting its own side up', () => {
        const beat = decideBeat({ ...base, theirSig: '440x100', window: windowAt({ waited: 999 }), oweMatched: false });
        expect(beat.do).toBe('offer');
    });

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

    // Why: each re-offer costs clicks and resets both accepts, so a patient toggler could waste the window.
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

    // Why: a sale is x * y = z, so short money is not a smaller deal, it is not the deal.
    test('their side not being the deal waits rather than accepting', () => {
        const beat = decideBeat({
            ...base,
            theirSig: '440x100',
            window: windowAt(),
            oweMatched: true,
            wantMatched: false
        });
        expect(beat).toEqual({ do: 'wait', reason: 'their side is not the deal yet' });
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


function rec(id: number, name: string, over: Partial<ObjRecord> = {}): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, equippable: false, certlink: -1, certtemplate: -1, ...over };
}

// Why: the strung bow is the equippable one, and that flag is the only thing separating the pair by name.
const QUOTE_CAT = buildCatalog([
    rec(440, 'Iron ore'),
    rec(1333, 'Rune scimitar', { equippable: true }),
    rec(851, 'Maple longbow', { equippable: true }),
    rec(62, 'Maple longbow'),
    rec(853, 'Yew longbow', { equippable: true }),
    rec(1515, 'Yew logs')
]);

const QUOTE_BOOK: PriceBook = {
    name: 'demo',
    margin: 20,
    maxTradeValue: 500_000,
    rows: [
        { id: 440, mid: 20, cap: 5_000, buying: true, selling: true },
        { id: 1333, mid: 15_000, cap: 20, buying: true, selling: true },
        { id: 851, mid: 640, cap: 500, buying: true, selling: true },
        { id: 62, mid: 320, cap: 500, buying: true, selling: true },
        { id: 853, mid: 800, cap: 500, buying: true, selling: true },
        { id: 1515, mid: 320, cap: 2_000, buying: true, selling: false }
    ]
};

function quote(query: string, qtyImplied: boolean, side: 'buying' | 'selling' = 'selling') {
    return resolveQuote({ cat: QUOTE_CAT, book: QUOTE_BOOK, query, side, qtyImplied });
}

describe('Desk.limitTo', () => {
    // Why: an order the shop can never fill keeps Restock going back to the bank, and Restock at the bank is
    // Why: what stopped it banking anything, so cutting the order is what breaks the loop.
    test('cuts an order down to what actually arrived', () => {
        desk.remember(intent('alice', 0, { maxQty: 100 }));
        desk.limitTo('alice', 40);
        expect(desk.intentFor('alice', 0, 90_000)?.maxQty).toBe(40);
    });

    test('never raises an order, so nobody gets more than they asked for', () => {
        desk.remember(intent('alice', 0, { maxQty: 100 }));
        desk.limitTo('alice', 500);
        expect(desk.intentFor('alice', 0, 90_000)?.maxQty).toBe(100);
    });

    test('nothing arriving leaves the order alone, for the miss count to deal with', () => {
        desk.remember(intent('alice', 0, { maxQty: 100 }));
        desk.limitTo('alice', 0);
        expect(desk.intentFor('alice', 0, 90_000)?.maxQty).toBe(100);
    });

    test('a customer with no order is not a crash', () => {
        expect(() => desk.limitTo('nobody', 5)).not.toThrow();
    });
});

describe('Desk.clear', () => {
    test('drops intents, cooldowns and the window together', () => {
        desk.remember(intent('alice'));
        desk.cool('bob', 10_000);
        desk.open('carol', 0);

        desk.clear();

        expect(desk.intentFor('alice', 0, 90_000)).toBeNull();
        expect(desk.onCooldown('bob', 0)).toBe(false);
        expect(desk.current()).toBeNull();
        expect(desk.intentCount()).toBe(0);
    });

    test('clearing an empty desk is not an error', () => {
        expect(() => desk.clear()).not.toThrow();
        expect(desk.intentCount()).toBe(0);
    });
});

describe('resolveQuote', () => {
    test('an exact name lands with no count given', () => {
        expect(quote('rune scimitar', true)).toEqual({ kind: 'hit', id: 1333, name: 'Rune scimitar' });
    });

    test('the same name lands when the count was given', () => {
        expect(quote('rune scimitar', false)).toEqual({ kind: 'hit', id: 1333, name: 'Rune scimitar' });
    });

    // Why: without this every sentence opening with "buy" would draw a reply, and a shop that answers passing chat gets muted.
    test('ordinary chat with no count is a miss the shop does not answer', () => {
        expect(quote('me a beer', true)).toEqual({ kind: 'miss', answer: false });
    });

    test('a named item the shop does not stock is answered when the count was given', () => {
        expect(quote('dragon claws', false)).toEqual({ kind: 'miss', answer: true });
    });

    // Why: a partial name is a typo worth answering when a count says the line was meant as a request, and a guess otherwise.
    test('a partial name only resolves when the count was given', () => {
        expect(quote('scimitar', false)).toEqual({ kind: 'hit', id: 1333, name: 'Rune scimitar' });
        expect(quote('scimitar', true)).toEqual({ kind: 'miss', answer: false });
    });

    test('the bow pair splits on the u suffix with no count given', () => {
        expect(quote('maple longbow', true)).toEqual({ kind: 'hit', id: 851, name: 'Maple longbow' });
        expect(quote('maple longbow u', true)).toEqual({ kind: 'hit', id: 62, name: 'Maple longbow' });
    });

    test('a partial name matching several is ambiguous, and only reachable with a count', () => {
        const target = quote('longbow', false);
        if (target.kind !== 'ambiguous') {
            throw new Error(`expected ambiguous, got ${target.kind}`);
        }
        expect(target.candidates.map(c => c.id).sort((a, b) => a - b)).toEqual([62, 851, 853]);
        expect(quote('longbow', true)).toEqual({ kind: 'miss', answer: false });
    });

    test('a row the shop will not sell is a miss on the selling side', () => {
        expect(quote('yew logs', true)).toEqual({ kind: 'miss', answer: false });
        expect(quote('yew logs', true, 'buying')).toEqual({ kind: 'hit', id: 1515, name: 'Yew logs' });
    });

    test('an item outside the book is a miss on both sides', () => {
        expect(quote('coins', false)).toEqual({ kind: 'miss', answer: true });
    });
});


describe('dealOf', () => {
    const coins = 995;

    test('coins on the shop\'s side means it bought', () => {
        const deal = dealOf({
            give: new Map([[coins, 2200]]),
            get: new Map([[440, 100]]),
            coinId: coins,
            customer: 'Elliott',
            atMs: 1000
        });
        expect(deal).toEqual({ atMs: 1000, customer: 'Elliott', kind: 'bought', itemId: 440, count: 100, gp: -2200, mixed: false });
    });

    test('coins on their side means it sold', () => {
        const deal = dealOf({
            give: new Map([[1333, 2]]),
            get: new Map([[coins, 33000]]),
            coinId: coins,
            customer: 'Elliott',
            atMs: 2000
        });
        expect(deal).toEqual({ atMs: 2000, customer: 'Elliott', kind: 'sold', itemId: 1333, count: 2, gp: 33000, mixed: false });
    });

    test('a mixed pile reports the biggest line and flags the rest', () => {
        const deal = dealOf({
            give: new Map([[coins, 5000]]),
            get: new Map([[440, 100], [1515, 300]]),
            coinId: coins,
            customer: 'Elliott',
            atMs: 3000
        });
        expect(deal?.itemId).toBe(1515);
        expect(deal?.count).toBe(300);
        expect(deal?.mixed).toBe(true);
    });

    // Why: a window that settled with coins on both sides and no goods is not a deal worth a line.
    test('coins for coins is not a deal', () => {
        expect(dealOf({ give: new Map([[coins, 10]]), get: new Map([[coins, 10]]), coinId: coins, customer: 'a', atMs: 0 })).toBeNull();
    });
});

describe('dealTotals', () => {
    test('nets the money and counts each way', () => {
        const deals = [
            { atMs: 1, customer: 'a', kind: 'sold' as const, itemId: 1, count: 1, gp: 500, mixed: false },
            { atMs: 2, customer: 'b', kind: 'bought' as const, itemId: 2, count: 1, gp: -200, mixed: false },
            { atMs: 3, customer: 'c', kind: 'sold' as const, itemId: 3, count: 1, gp: 100, mixed: false }
        ];
        expect(dealTotals(deals)).toEqual({ count: 3, net: 400, sold: 2, bought: 1 });
    });

    test('no deals is a zero net, not a gap', () => {
        expect(dealTotals([])).toEqual({ count: 0, net: 0, sold: 0, bought: 0 });
    });
});

describe('dealLine', () => {
    test('columns line up whatever the name length', () => {
        const short = dealLine({ clock: '14:32:06', customer: 'Bob', kind: 'sold', count: 100, item: 'Iron ore', gp: 2200, mixed: false });
        const long = dealLine({ clock: '14:31:41', customer: 'Averylongname', kind: 'bought', count: 20, item: 'Rune scimitar', gp: -13500, mixed: false });
        // Why: the money column is right-aligned, so it is the ends that line up, not where each number starts.
        expect(short.length).toBe(long.length);
        expect(short.endsWith('+2,200')).toBe(true);
        expect(long.endsWith('-13,500')).toBe(true);
    });

    test('a mixed pile says so', () => {
        expect(dealLine({ clock: '00:00:00', customer: 'a', kind: 'bought', count: 300, item: 'Yew logs', gp: -5000, mixed: true })).toContain('+more');
    });

    test('money carries its sign either way', () => {
        expect(dealLine({ clock: '00:00:00', customer: 'a', kind: 'sold', count: 1, item: 'X', gp: 10, mixed: false })).toContain('+10');
        expect(dealLine({ clock: '00:00:00', customer: 'a', kind: 'bought', count: 1, item: 'X', gp: -10, mixed: false })).toContain('-10');
    });
});
