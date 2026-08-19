import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ProfileVault } from '#/bot/multibox/ProfileVault.js';

const KEY = 'rs2b0t:multibox:profiles';
const LEGACY_KEY = 'rs2b0t:multibox:accounts';

const clearAll = () => {
    sessionStorage.clear();
    localStorage.clear();
};
beforeEach(clearAll);
afterEach(clearAll);

describe('ProfileVault', () => {
    test('empty → setup unlocks with an empty list and writes an encrypted blob', async () => {
        const v = new ProfileVault();
        expect(v.status()).toBe('empty');
        await v.setup('pw');
        expect(v.status()).toBe('unlocked');
        expect(v.list()).toEqual([]);
        const blob = JSON.parse(localStorage.getItem(KEY)!) as { v: number; kdf: string; iter: number };
        expect(blob.v).toBe(1);
        expect(blob.kdf).toBe('PBKDF2-SHA256');
        expect(blob.iter).toBe(310000);
    });

    test('round-trip: upsert/remove survive a real lock/unlock cycle', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'hunter2' });
        await v.upsert({ username: 'bob', password: 'b' });
        await v.remove('bob');
        const v2 = new ProfileVault();
        expect(v2.status()).toBe('locked');
        expect(await v2.unlock('pw')).toBe(true);
        expect(v2.list()).toEqual([{ username: 'alice', password: 'hunter2', tab: 'Main' }]);
    });

    test('stored blob never contains plaintext', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'hunter2' });
        const raw = localStorage.getItem(KEY)!;
        expect(raw).not.toContain('alice');
        expect(raw).not.toContain('hunter2');
    });

    test('reorder is encrypted and survives locking and unlocking', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'a' });
        await v.upsert({ username: 'bob', password: 'b' });
        await v.upsert({ username: 'carol', password: 'c' });

        await v.reorder(['carol', 'alice', 'bob']);
        expect(v.list().map(profile => profile.username)).toEqual(['carol', 'alice', 'bob']);
        expect(localStorage.getItem(KEY)).not.toContain('carol');

        const reopened = new ProfileVault();
        expect(await reopened.unlock('pw')).toBe(true);
        expect(reopened.list().map(profile => profile.username)).toEqual(['carol', 'alice', 'bob']);
    });

    test('reorder ignores duplicates and unknown profiles, then appends unloaded profiles', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'a' });
        await v.upsert({ username: 'bob', password: 'b' });
        await v.upsert({ username: 'carol', password: 'c' });

        await v.reorder(['carol', 'missing', 'carol']);
        expect(v.list().map(profile => profile.username)).toEqual(['carol', 'alice', 'bob']);
    });

    test('concurrent profile changes persist in call order', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'a' });
        await v.upsert({ username: 'bob', password: 'b' });

        const add = v.upsert({ username: 'carol', password: 'c' });
        const reorder = v.reorder(['carol', 'bob', 'alice']);
        await Promise.all([add, reorder]);

        const reopened = new ProfileVault();
        expect(await reopened.unlock('pw')).toBe(true);
        expect(reopened.list().map(profile => profile.username)).toEqual(['carol', 'bob', 'alice']);
    });

    test('wrong passphrase fails to unlock and stays locked', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        const v2 = new ProfileVault();
        expect(await v2.unlock('nope')).toBe(false);
        expect(v2.status()).toBe('locked');
        expect(() => v2.list()).toThrow();
    });

    test('legacy plaintext array under the profiles key is adopted by setup', async () => {
        localStorage.setItem(KEY, JSON.stringify([{ username: 'old', password: 'p' }]));
        const v = new ProfileVault();
        expect(v.status()).toBe('plaintext-legacy');
        await v.setup('pw');
        expect(v.list()).toEqual([{ username: 'old', password: 'p', tab: 'Main' }]);
        expect(localStorage.getItem(KEY)!).not.toContain('old');
    });

    test('pre-#30 roster key is adopted too, then deleted', async () => {
        localStorage.setItem(LEGACY_KEY, JSON.stringify([{ username: 'old', password: 'p' }]));
        const v = new ProfileVault();
        expect(v.status()).toBe('plaintext-legacy');
        await v.setup('pw');
        expect(v.list()).toEqual([{ username: 'old', password: 'p', tab: 'Main' }]);
        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    test('reset wipes to empty', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'a' });
        v.reset();
        expect(v.status()).toBe('empty');
        expect(localStorage.getItem(KEY)).toBeNull();
        expect(() => v.list()).toThrow();
    });

    test('reset cannot be undone by an in-flight encrypted write', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        const pending = v.upsert({ username: 'alice', password: 'a' });
        v.reset();
        await pending;
        expect(v.status()).toBe('empty');
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    test('setup while locked throws', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        const v2 = new ProfileVault();
        await expect(v2.setup('other')).rejects.toThrow();
    });

    test('every persist uses a fresh IV', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'a', password: '1' });
        const iv1 = (JSON.parse(localStorage.getItem(KEY)!) as { iv: string }).iv;
        await v.upsert({ username: 'b', password: '2' });
        const iv2 = (JSON.parse(localStorage.getItem(KEY)!) as { iv: string }).iv;
        expect(iv1).not.toBe(iv2);
    });
});

// Encrypt an arbitrary payload as ProfileVault does, so migration and
// corruption paths can be exercised against blobs the current code never writes.
async function writeBlob(pass: string, payload: unknown): Promise<void> {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload))));
    const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
    localStorage.setItem(KEY, JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter: 310000, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
}

describe('ProfileVault tabs', () => {
    test('tab state round-trips through a real lock/unlock cycle', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'a' });
        await v.upsert({ username: 'bob', password: 'b' });
        await v.saveTabState(['miners', 'mules'], new Map([['alice', 'miners']]), 'miners');
        expect(v.tabState()).toEqual({ tabs: ['miners', 'mules'], activeTab: 'miners' });

        const reopened = new ProfileVault();
        expect(await reopened.unlock('pw')).toBe(true);
        expect(reopened.tabState()).toEqual({ tabs: ['miners', 'mules'], activeTab: 'miners' });
        expect(reopened.list()).toEqual([
            { username: 'alice', password: 'a', tab: 'miners' },
            { username: 'bob', password: 'b', tab: 'Main' }
        ]);
    });

    test('upsert preserves the profile tab when re-saving a password', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'old' });
        await v.saveTabState(['m'], new Map([['alice', 'm']]), 'Main');
        await v.upsert({ username: 'alice', password: 'new' });
        expect(v.list()).toEqual([{ username: 'alice', password: 'new', tab: 'm' }]);
    });

    test('reorder keeps tab assignments', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'a' });
        await v.upsert({ username: 'bob', password: 'b' });
        await v.saveTabState(['m'], new Map([['alice', 'm']]), 'Main');
        await v.reorder(['bob', 'alice']);
        expect(v.list()).toEqual([
            { username: 'bob', password: 'b', tab: 'Main' },
            { username: 'alice', password: 'a', tab: 'm' }
        ]);
    });

    test('deleting a tab clears it from profiles that are not loaded in the wall', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'a' });
        await v.upsert({ username: 'bob', password: 'b' });
        await v.saveTabState(['m'], new Map([['alice', 'm'], ['bob', 'm']]), 'Main');
        // wall session with only alice loaded deletes the tab
        await v.saveTabState([], new Map([['alice', 'Main']]), 'Main');
        expect(v.list()).toEqual([
            { username: 'alice', password: 'a', tab: 'Main' },
            { username: 'bob', password: 'b', tab: 'Main' }
        ]);
    });

    test('saveTabState rejects invalid tab lists loudly', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'a' });
        await expect(v.saveTabState(['Main'], new Map(), 'Main')).rejects.toThrow();
        await expect(v.saveTabState(['a', 'a'], new Map(), 'Main')).rejects.toThrow();
        await expect(v.saveTabState(['a'], new Map(), 'ghost')).rejects.toThrow(/ghost/);
        await expect(v.saveTabState(['a'], new Map([['alice', 'ghost']]), 'Main')).rejects.toThrow(/ghost/);
    });

    test('a v1 array payload unlocks with tabs migrated empty', async () => {
        await writeBlob('pw', [{ username: 'old', password: 'p' }]);
        const v = new ProfileVault();
        expect(v.status()).toBe('locked');
        expect(await v.unlock('pw')).toBe(true);
        expect(v.list()).toEqual([{ username: 'old', password: 'p', tab: 'Main' }]);
        expect(v.tabState()).toEqual({ tabs: [], activeTab: 'Main' });
    });

    test('a profile pointing at a missing tab fails the unlock loudly', async () => {
        await writeBlob('pw', { profiles: [{ username: 'x', password: '', tab: 'ghost' }], tabs: [], activeTab: 'Main' });
        const v = new ProfileVault();
        await expect(v.unlock('pw')).rejects.toThrow(/ghost/);
    });

    test('an unrecognized decrypted payload fails the unlock loudly', async () => {
        await writeBlob('pw', 'what');
        const v = new ProfileVault();
        await expect(v.unlock('pw')).rejects.toThrow();
    });

    test('replaceAll overwrites profiles and tabs and persists them', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'old', password: 'x' });
        await v.replaceAll({
            profiles: [
                { username: 'alice', password: 'a', tab: 'miners' },
                { username: 'bob', password: 'b' }
            ],
            tabs: ['miners'],
            activeTab: 'miners'
        });
        expect(v.snapshot()).toEqual({
            profiles: [
                { username: 'alice', password: 'a', tab: 'miners' },
                { username: 'bob', password: 'b', tab: 'Main' }
            ],
            tabs: ['miners'],
            activeTab: 'miners'
        });

        const reopened = new ProfileVault();
        expect(await reopened.unlock('pw')).toBe(true);
        expect(reopened.snapshot()).toEqual(v.snapshot());
    });

    test('replaceAll rejects a profile pointing at a missing tab', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await expect(v.replaceAll({
            profiles: [{ username: 'x', password: '', tab: 'ghost' }],
            tabs: [],
            activeTab: 'Main'
        })).rejects.toThrow(/ghost/);
    });
});
