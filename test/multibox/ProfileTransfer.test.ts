import { afterEach, describe, expect, test } from 'bun:test';
import { Loadouts } from '#/bot/api/loadout/loadoutStore.js';
import type { Profile } from '#/bot/multibox/ProfileVault.js';
import { SettingsStore } from '#/bot/runtime/Settings.js';

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

    test('round-trips all worlds and keeps a legacy profile unassigned', () => {
        const snapshot = { ...snap, profiles: [
            { username: 'alice', password: 'a', world: 1 as const },
            { username: 'bob', password: 'b', world: 2 as const },
            { username: 'charlie', password: 'c', world: 3 as const },
            { username: 'legacy', password: 'c' }
        ] };
        expect(parseProfileFile(serializeProfileFile(snapshot))).toEqual(snapshot);
    });

    test('importing W3 preserves credentials, tabs and script settings', () => {
        const source = { ...snap, profiles: [{ username: 'alice', password: 'a', tab: 'miners', world: 3 as const }] };
        const parsed = parseProfileFile(JSON.stringify({ kind: PROFILE_FILE_KIND, v: PROFILE_FILE_VERSION, ...source }));
        expect(parsed).toEqual(source);
        expect(parseProfileFile(serializeProfileFile(parsed))).toEqual(source);
    });

    for (const world of [null, '3', 0, 4, true]) {
        test(`rejects explicit invalid world ${JSON.stringify(world)} on import and export`, () => {
            const snapshot = { ...snap, profiles: [{ username: 'alice', password: 'a', world } as Profile] };
            expect(() => serializeProfileFile(snapshot)).toThrow(/world/i);
            expect(() => parseProfileFile(JSON.stringify({ kind: PROFILE_FILE_KIND, v: PROFILE_FILE_VERSION, ...snapshot }))).toThrow(/world/i);
        });
    }

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

    test('desktop export includes the script selected in another window', () => {
        const result = Bun.spawnSync(['bun', 'test/fixtures/roster-desktop-storage.ts', '--export']);
        expect(result.exitCode).toBe(0);
        expect(parseProfileFile(result.stdout.toString()).storage.source.selectedScript).toBe('Fisher');
    });

    for (const size of [16, 32]) {
        test(`desktop export and import each enumerate shared keys once for ${size} accounts`, () => {
            const result = Bun.spawnSync(['bun', 'test/fixtures/profile-transfer-desktop.ts', String(size)]);
            expect(result.exitCode, result.stderr.toString()).toBe(0);
            expect(JSON.parse(result.stdout.toString())).toEqual({ exportReads: 1, importReads: 1 });
        });
    }

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

    test('exporting set includes only its profile storage', () => {
        Loadouts.save([{ name: 'travel', worn: {}, carry: [] }]);
        SettingsStore.save('Global', 'runEnergyMin', '73');
        SettingsStore.save('set', 'custom', 'standalone');
        localStorage.setItem('rs2b0t:set:set:Global:runEnergyMin', '42');
        sessionStorage.setItem('rs2b0t:set:selectedScript', 'Miner');

        expect(collectBoxStorage(['set'])).toEqual({
            set: { 'set:Global:runEnergyMin': '42', selectedScript: 'Miner' }
        });
    });

    for (const incoming of ['set', 'fixture', 'legacy set']) {
        test(`restoring ${incoming} over set preserves standalone storage`, () => {
            const loadout = { name: 'travel', worn: {}, carry: [{ item: 'Lobster', qty: 2 }] };
            Loadouts.save([loadout]);
            SettingsStore.save('Global', 'runEnergyMin', '73');
            const user = incoming === 'fixture' ? 'fixture' : 'set';
            const threshold = 'set:Global:runEnergyMin';
            for (const store of [localStorage, sessionStorage]) {
                store.setItem('rs2b0t:set:selectedScript', 'Miner');
                store.setItem(`rs2b0t:set:${threshold}`, '31');
            }
            const entries: Record<string, string> = { [threshold]: '42' };
            if (incoming === 'legacy set') {
                entries['Loadouts:sets'] = '[]';
                entries['Global:runEnergyMin'] = '10';
            }

            applyBoxStorage({ [user]: entries }, ['set', user]);

            for (const store of [localStorage, sessionStorage]) {
                expect(store.getItem('rs2b0t:set:selectedScript')).toBeNull();
                expect(store.getItem(`rs2b0t:set:${threshold}`)).toBe(user === 'set' ? '42' : null);
                expect(store.getItem(`rs2b0t:${user}:${threshold}`)).toBe('42');
                expect(store.getItem('rs2b0t:set:Global:runEnergyMin')).toBe('73');
                expect(store.getItem('rs2b0t:set:Loadouts:sets')).toBe(JSON.stringify([loadout]));
            }
            sessionStorage.clear();
            expect(SettingsStore.saved('Global', 'runEnergyMin')).toBe('73');
            expect(Loadouts.all()).toEqual([loadout]);
        });
    }
});
