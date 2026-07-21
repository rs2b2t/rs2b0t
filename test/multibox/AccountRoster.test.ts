import { describe, expect, test } from 'bun:test';
import { AccountRoster } from '#/bot/multibox/AccountRoster.js';

function fakeStorage(): Storage {
    const m = new Map<string, string>();
    return {
        get length() { return m.size; },
        clear: () => m.clear(),
        getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
        key: (i: number) => [...m.keys()][i] ?? null,
        removeItem: (k: string) => void m.delete(k),
        setItem: (k: string, v: string) => void m.set(k, v)
    } as Storage;
}

describe('AccountRoster', () => {
    test('add/list dedups by username and persists', () => {
        const s = fakeStorage();
        const r = new AccountRoster(s);
        r.add({ username: 'alice', password: 'a' });
        r.add({ username: 'alice', password: 'a2' }); // dup ignored
        r.add({ username: 'bob', password: 'b' });
        expect(r.list().map(a => a.username)).toEqual(['alice', 'bob']);
        // a fresh instance over the same storage loads the persisted list
        expect(new AccountRoster(s).list().map(a => a.username)).toEqual(['alice', 'bob']);
    });

    test('claimNext hands out distinct accounts then null', () => {
        const r = new AccountRoster(fakeStorage());
        r.add({ username: 'alice', password: 'a' });
        r.add({ username: 'bob', password: 'b' });
        expect(r.claimNext()?.username).toBe('alice');
        expect(r.claimNext()?.username).toBe('bob');
        expect(r.claimNext()).toBeNull();
    });

    test('release frees an account for re-claim', () => {
        const r = new AccountRoster(fakeStorage());
        r.add({ username: 'alice', password: 'a' });
        expect(r.claimNext()?.username).toBe('alice');
        expect(r.claimNext()).toBeNull();
        r.release('alice');
        expect(r.claimNext()?.username).toBe('alice');
    });

    test('remove drops from list and assignment', () => {
        const r = new AccountRoster(fakeStorage());
        r.add({ username: 'alice', password: 'a' });
        r.claimNext();
        r.remove('alice');
        expect(r.list()).toEqual([]);
        expect(r.claimNext()).toBeNull();
    });
});
