import { beforeEach, describe, expect, test } from 'bun:test';

import {
    advertiseDue,
    Queue,
    shouldRestock,
    shouldSettle,
    type Engagement
} from '#/bot/scripts/MarketMaker/marketMakerLogic.js';

function engagement(customer: string, over: Partial<Engagement> = {}): Engagement {
    return {
        customer,
        kind: 'sell',
        give: new Map([[440, 100]]),
        get: new Map([[995, 2000]]),
        quotedAtMs: 0,
        opened: false,
        ...over
    };
}

let queue: Queue;

beforeEach(() => {
    queue = new Queue(3);
});

describe('Queue', () => {
    test('the first customer is served immediately', () => {
        expect(queue.enqueue('alice', engagement('alice'))).toBe('engaged');
        expect(queue.current()?.customer).toBe('alice');
    });

    test('a second customer waits', () => {
        queue.enqueue('alice', engagement('alice'));
        expect(queue.enqueue('bob', engagement('bob'))).toBe('queued');
        expect(queue.current()?.customer).toBe('alice');
        expect(queue.waiting()).toEqual(['bob']);
    });

    test('re-quoting replaces the same customer rather than queueing twice', () => {
        queue.enqueue('alice', engagement('alice'));
        expect(queue.enqueue('alice', engagement('alice', { get: new Map([[995, 3000]]) }))).toBe('requoted');
        expect(queue.current()?.get.get(995)).toBe(3000);
        expect(queue.size()).toBe(1);
    });

    test('a re-quote matches the name case-insensitively', () => {
        queue.enqueue('Alice', engagement('Alice'));
        expect(queue.enqueue('alice', engagement('alice'))).toBe('requoted');
        expect(queue.size()).toBe(1);
    });

    test('a re-quote keeps the waiting customer in place', () => {
        queue.enqueue('alice', engagement('alice'));
        queue.enqueue('bob', engagement('bob'));
        queue.enqueue('bob', engagement('bob', { get: new Map([[995, 9]]) }));
        expect(queue.current()?.customer).toBe('alice');
        expect(queue.waiting()).toEqual(['bob']);
    });

    test('the queue refuses past its cap', () => {
        queue.enqueue('a', engagement('a'));
        queue.enqueue('b', engagement('b'));
        queue.enqueue('c', engagement('c'));
        expect(queue.enqueue('d', engagement('d'))).toBe('full');
    });

    test('finishing promotes the next customer', () => {
        queue.enqueue('alice', engagement('alice'));
        queue.enqueue('bob', engagement('bob'));
        queue.finish('alice');
        expect(queue.current()?.customer).toBe('bob');
    });

    test('finishing someone who is only waiting drops them quietly', () => {
        queue.enqueue('alice', engagement('alice'));
        queue.enqueue('bob', engagement('bob'));
        queue.finish('bob');
        expect(queue.current()?.customer).toBe('alice');
        expect(queue.waiting()).toEqual([]);
    });

    test('expire drops stale engagements and names them', () => {
        queue.enqueue('alice', engagement('alice', { quotedAtMs: 0 }));
        queue.enqueue('bob', engagement('bob', { quotedAtMs: 80_000 }));
        expect(queue.expire(100_000, 60_000)).toEqual(['alice']);
        expect(queue.current()?.customer).toBe('bob');
    });

    test('an empty queue has no current engagement', () => {
        expect(queue.current()).toBeNull();
        expect(queue.expire(1_000, 10)).toEqual([]);
        expect(queue.waiting()).toEqual([]);
    });

    test('markOpened flags the engagement in place', () => {
        queue.enqueue('alice', engagement('alice'));
        queue.markOpened('alice');
        expect(queue.current()?.opened).toBe(true);
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
        expect(shouldRestock(new Map([[440, 100]]), () => 50)).toBe(true);
    });

    test('false when the pack already holds it', () => {
        expect(shouldRestock(new Map([[440, 100]]), () => 100)).toBe(false);
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
