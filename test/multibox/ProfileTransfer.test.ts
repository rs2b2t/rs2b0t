import { afterEach, describe, expect, test } from 'bun:test';

import {
    PROFILE_FILE_KIND,
    PROFILE_FILE_VERSION,
    applyBoxStorage,
    collectBoxStorage,
    parseProfileFile,
    serializeProfileFile
} from '#/bot/multibox/ProfileTransfer.js';

const snap = {
    profiles: [
        { username: 'alice', password: 'a', tab: 'miners' },
        { username: 'bob', password: 'b' }
    ],
    tabs: ['miners'],
    activeTab: 'miners',
    storage: {
        alice: { selectedScript: 'Miner', 'set:Miner:rock': 'iron', 'set:Global:runAuto': 'false' }
    }
};

afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

describe('ProfileTransfer', () => {
    test('round-trips a vault snapshot', () => {
        const parsed = parseProfileFile(serializeProfileFile(snap));
        expect(parsed).toEqual(snap);
    });

    test('rejects missing kind, wrong version, and garbage', () => {
        expect(() => parseProfileFile('not-json')).toThrow(/not JSON/);
        expect(() => parseProfileFile('[]')).toThrow(/unrecognized shape/);
        expect(() => parseProfileFile(JSON.stringify({ ...snap, v: PROFILE_FILE_VERSION }))).toThrow(/kind/);
        expect(() => parseProfileFile(JSON.stringify({ kind: PROFILE_FILE_KIND, v: 99, ...snap }))).toThrow(/version/);
        expect(() => parseProfileFile(JSON.stringify({ kind: PROFILE_FILE_KIND, v: PROFILE_FILE_VERSION, profiles: [{ username: '' }], tabs: [], activeTab: 'Main' }))).toThrow(/invalid profile/);
        expect(() => parseProfileFile(JSON.stringify({ kind: PROFILE_FILE_KIND, v: PROFILE_FILE_VERSION, ...snap, storage: [] }))).toThrow(/storage must be an object/);
    });

    test('a v1 file without storage still imports as an empty box map', () => {
        const parsed = parseProfileFile(JSON.stringify({
            kind: PROFILE_FILE_KIND,
            v: PROFILE_FILE_VERSION,
            profiles: [{ username: 'alice', password: 'a' }],
            tabs: [],
            activeTab: 'Main'
        }));
        expect(parsed.storage).toEqual({});
    });

    test('collect/apply round-trips box keys and does not steal a prefixed neighbour', () => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('rs2b0t:alice:selectedScript', 'Miner');
        localStorage.setItem('rs2b0t:alice:set:Miner:rock', 'iron');
        localStorage.setItem('rs2b0t:alice2:selectedScript', 'Fisher');
        localStorage.setItem('rs2b0t:multibox:profiles', 'ignore');
        sessionStorage.setItem('rs2b0t:alice:selectedScript', 'HillGiant');

        expect(collectBoxStorage(['alice'])).toEqual({
            alice: { selectedScript: 'HillGiant', 'set:Miner:rock': 'iron' }
        });

        applyBoxStorage({ alice: { selectedScript: 'BrimhavenAgility', 'set:Global:runAuto': 'false' } }, ['alice', 'old']);
        expect(localStorage.getItem('rs2b0t:alice:selectedScript')).toBe('BrimhavenAgility');
        expect(localStorage.getItem('rs2b0t:alice:set:Global:runAuto')).toBe('false');
        expect(localStorage.getItem('rs2b0t:alice:set:Miner:rock')).toBeNull();
        expect(localStorage.getItem('rs2b0t:alice2:selectedScript')).toBe('Fisher');
        expect(localStorage.getItem('rs2b0t:multibox:profiles')).toBe('ignore');
        expect(sessionStorage.getItem('rs2b0t:alice:selectedScript')).toBe('BrimhavenAgility');
    });
});
