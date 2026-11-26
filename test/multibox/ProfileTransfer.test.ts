import { afterEach, describe, expect, test } from 'bun:test';
import { Loadouts } from '#/bot/api/loadout/loadoutStore.js';
import { readScriptSettings, replaceScriptSettings, storedScripts } from '#/bot/multibox/RosterStorage.js';
import type { Profile } from '#/bot/multibox/ProfileVault.js';
import { SettingsStore } from '#/bot/runtime/Settings.js';
import { boxKey } from '#/bot/runtime/box.js';

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

const browser = Reflect.get(window, 'happyDOM') as { setURL(url: string): void };

function inBox<T>(box: string, run: () => T): T {
    const previous = location.href;
    browser.setURL('http://localhost/bot.html?box=' + box);
    try {
        return run();
    } finally {
        browser.setURL(previous);
    }
}

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
            v: 1,
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

    test('desktop export keeps the session login edited after restoring set', () => {
        const result = Bun.spawnSync(['bun', 'test/fixtures/roster-desktop-storage.ts', '--export-edited-login']);
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        const { storage } = parseProfileFile(result.stdout.toString());
        expect(JSON.parse(storage.set.creds)).toEqual({ username: 'edited', password: '' });
    });

    test('desktop export distinguishes mirrored standalone writes from legacy session settings', () => {
        const result = Bun.spawnSync(['bun', 'test/fixtures/roster-desktop-storage.ts', '--export-set']);
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        expect(JSON.parse(result.stdout.toString())).toEqual({
            before: { set: { 'set:Miner:rock': 'coal', 'set:Global:runEnergyMin': '73' } }, offered: [], after: {}
        });
    });

    test('reading missing global settings for set uses the desktop snapshot', () => {
        const result = Bun.spawnSync(['bun', 'test/fixtures/profile-transfer-desktop.ts', '--settings']);
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        expect(JSON.parse(result.stdout.toString())).toEqual({ threshold: 20, syncReads: 0 });
    });

    test('desktop export respects a profile setting cleared in another session', () => {
        const result = Bun.spawnSync(['bun', 'test/fixtures/roster-desktop-storage.ts', '--export-cleared']);
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        expect(JSON.parse(result.stdout.toString())).toEqual({ offered: [], restored: 20 });
    });

    test('restoring set preserves literal pre-upgrade percent escapes alongside colon-bearing keys', () => {
        localStorage.setItem('rs2b0t:set:plugin%3Amode', 'literal');
        expect(collectBoxStorage(['set'])).toEqual({ set: { 'plugin%3Amode': 'literal' } });
        localStorage.setItem(boxKey('plugin:mode', 'set'), 'nested');
        const profiles = [{ username: 'set', password: '' }];
        const file = serializeProfileFile({ ...snap, profiles, storage: collectBoxStorage(['set']) });
        const { storage } = parseProfileFile(file);
        expect(storage.set).toEqual({ 'plugin%3Amode': 'literal', 'plugin:mode': 'nested' });
        applyBoxStorage(storage, ['set']);
        sessionStorage.clear();
        expect(localStorage.getItem(boxKey('plugin%3Amode', 'set'))).toBe('literal');
        expect(localStorage.getItem(boxKey('plugin:mode', 'set'))).toBe('nested');
    });

    test('restores a colon-bearing profile key from its own export', () => {
        const key = boxKey('plugin:mode', 'set');
        localStorage.setItem(key, 'walk');
        const file = serializeProfileFile({ ...snap, profiles: [{ username: 'set', password: '' }], storage: collectBoxStorage(['set']) });
        const backup = parseProfileFile(file);
        applyBoxStorage(backup.storage, ['set']);
        expect(localStorage.getItem(key)).toBe('walk');
        expect(sessionStorage.getItem(key)).toBe('walk');
    });

    test('an ambiguous pre-upgrade standalone value stays out of profile exports', () => {
        for (const store of [localStorage, sessionStorage]) store.setItem('rs2b0t:set:set:travel:mode', 'walk');
        expect(collectBoxStorage(['set'])).toEqual({});
        expect(inBox('set', () => SettingsStore.saved('travel', 'mode'))).toBe('walk');
        expect(collectBoxStorage(['set'])).toEqual({});
        sessionStorage.clear();
        expect(SettingsStore.saved('set', 'travel:mode')).toBe('walk');
    });

    test('export includes each confirmed legacy setting once and keeps declined values local', () => {
        for (const store of [localStorage, sessionStorage]) {
            store.setItem('rs2b0t:set:set:Global:runEnergyMin', '42');
            store.setItem('rs2b0t:set:set:travel:mode', 'walk');
        }
        const choices: string[] = [];
        const storage = collectBoxStorage(['set'], suffix => {
            choices.push(suffix);
            return suffix === 'set:Global:runEnergyMin';
        });
        expect(choices.sort()).toEqual(['set:Global:runEnergyMin', 'set:travel:mode']);
        expect(storage).toEqual({ set: { 'set:Global:runEnergyMin': '42' } });
        expect(SettingsStore.saved('set', 'travel:mode')).toBe('walk');
    });

    test('standalone saves and clears leave the shared legacy value readable by the profile', () => {
        const legacy = 'rs2b0t:set:set:travel:mode';
        localStorage.setItem(legacy, 'walk');
        SettingsStore.save('set', 'travel:mode', 'ride');
        sessionStorage.clear();
        expect(SettingsStore.saved('set', 'travel:mode')).toBe('ride');
        expect(inBox('set', () => SettingsStore.saved('travel', 'mode'))).toBe('walk');
        SettingsStore.clear('set', 'travel:mode');
        sessionStorage.clear();
        expect(SettingsStore.saved('set', 'travel:mode')).toBeUndefined();
        expect(inBox('set', () => SettingsStore.saved('travel', 'mode'))).toBe('walk');
        expect(localStorage.getItem(legacy)).toBe('walk');
    });

    for (const consumer of ['settings', 'export']) {
        test(`legacy session settings take precedence over a newer durable key during ${consumer}`, () => {
            const suffix = 'set:Global:runEnergyMin';
            sessionStorage.setItem('rs2b0t:set:set:Global:runEnergyMin', '42');
            localStorage.setItem(boxKey(suffix, 'set'), '73');
            const read = () => consumer === 'settings'
                ? inBox('set', () => SettingsStore.saved('Global', 'runEnergyMin'))
                : collectBoxStorage(['set'], () => true).set[suffix];
            expect(read()).toBe('42');
            expect(collectBoxStorage(['set'], () => false).set[suffix]).toBe('73');
            localStorage.setItem('rs2b0t:set-profile-settings-v1', '1');
            expect(read()).toBe('73');
        });
    }

    test('a legacy read preserves an interleaved durable profile save', () => {
        const legacy = 'rs2b0t:set:set:Global:runEnergyMin';
        const current = boxKey('set:Global:runEnergyMin', 'set');
        localStorage.setItem(legacy, '42');
        const getItem = localStorage.getItem.bind(localStorage);
        let interleaved = false;
        Object.defineProperty(localStorage, 'getItem', { configurable: true, value(key: string) {
            const value = getItem(key);
            if (key === legacy && !interleaved) {
                interleaved = true;
                localStorage.setItem(current, '73');
            }
            return value;
        } });
        try {
            inBox('set', () => SettingsStore.saved('Global', 'runEnergyMin'));
        } finally {
            Reflect.deleteProperty(localStorage, 'getItem');
        }
        expect(interleaved).toBe(true);
        sessionStorage.clear();
        expect(inBox('set', () => SettingsStore.saved('Global', 'runEnergyMin'))).toBe('73');
    });

    test('fixture-only backups remain readable by version 1 clients', () => {
        expect(JSON.parse(serializeProfileFile(snap)).v).toBe(1);
    });

    test('exports a readable legacy threshold when storage is full', () => {
        localStorage.setItem('rs2b0t:set:set:Global:runEnergyMin', '42');
        const setItem = localStorage.setItem;
        Object.defineProperty(localStorage, 'setItem', { value() { throw new DOMException('storage full', 'QuotaExceededError'); } });
        try {
            expect(inBox('set', () => SettingsStore.saved('Global', 'runEnergyMin'))).toBe('42');
            expect(collectBoxStorage(['set'], () => true)).toEqual({ set: { 'set:Global:runEnergyMin': '42' } });
        } finally {
            Object.defineProperty(localStorage, 'setItem', { value: setItem });
        }
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
        SettingsStore.save('set', 'travel:mode', 'walk');
        inBox('set', () => SettingsStore.save('Global', 'runEnergyMin', '42'));
        sessionStorage.setItem('rs2b0t:set:selectedScript', 'Miner');

        expect(collectBoxStorage(['set'])).toEqual({
            set: { 'set:Global:runEnergyMin': '42', selectedScript: 'Miner' }
        });
    });

    test('round-trips distinct v1 settings for set and :profile:set after a fresh session', () => {
        const names = ['set', ':profile:set'];
        const profiles = names.map(username => ({ username, password: '' }));
        const storage = { set: { 'set:Global:runEnergyMin': '42' }, ':profile:set': { 'set:Global:runEnergyMin': '73' } };
        const file = JSON.stringify({ ...snap, profiles, storage, kind: PROFILE_FILE_KIND, v: 1 });
        applyBoxStorage(parseProfileFile(file).storage, names);
        sessionStorage.clear();

        expect(names.map(name => inBox(name, () => SettingsStore.globalBag().num('runEnergyMin')))).toEqual([42, 73]);
        const exported = serializeProfileFile({ ...snap, profiles, storage: collectBoxStorage(names) });
        expect(parseProfileFile(exported).storage).toEqual(storage);
        applyBoxStorage({}, ['set']);
        sessionStorage.clear();
        expect(collectBoxStorage(names)).toEqual({ ':profile:set': storage[':profile:set'] });
    });

    test('restoring colon-prefixed profiles preserves standalone settings and clears', () => {
        localStorage.setItem('rs2b0t:set:set:travel:mode', 'legacy');
        SettingsStore.clear('set', 'travel:mode');
        SettingsStore.save('set', 'travel:route', 'walk');
        const names = [':set', ':cleared'];
        expect(collectBoxStorage(names)).toEqual({});
        applyBoxStorage({}, names);
        sessionStorage.clear();
        expect(SettingsStore.saved('set', 'travel:mode')).toBeUndefined();
        expect(SettingsStore.saved('set', 'travel:route')).toBe('walk');
    });

    test('a fresh set profile reads and exports its pre-upgrade settings and loadouts', () => {
        const loadout = { name: 'profile', worn: {}, carry: [] };
        localStorage.setItem('rs2b0t:set:set:Global:runEnergyMin', '42');
        localStorage.setItem('rs2b0t:set:set:Loadouts:sets', JSON.stringify([loadout]));
        localStorage.setItem('rs2b0t:set:Global:runEnergyMin', '73');

        inBox('set', () => {
            expect(SettingsStore.globalBag().num('runEnergyMin')).toBe(42);
            expect(Loadouts.all()).toEqual([loadout]);
        });
        expect(collectBoxStorage(['set'], () => true)).toEqual({ set: {
            'set:Global:runEnergyMin': '42', 'set:Loadouts:sets': JSON.stringify([loadout])
        } });
        expect(SettingsStore.globalBag().num('runEnergyMin')).toBe(73);
    });

    test('export reads legacy values from both storage layers before the profile is opened', () => {
        localStorage.setItem('rs2b0t:set:set:Miner:rock', 'iron');
        sessionStorage.setItem('rs2b0t:set:set:Miner:rock', 'coal');
        localStorage.setItem(boxKey('set:Miner:tool', 'set'), 'pickaxe');
        localStorage.setItem('rs2b0t:set:set:Miner:tool', 'old');

        expect(collectBoxStorage(['set'], () => true)).toEqual({ set: { 'set:Miner:rock': 'coal', 'set:Miner:tool': 'pickaxe' } });
        sessionStorage.clear();
        expect(readScriptSettings('set', 'Miner')).toEqual({ rock: 'iron', tool: 'pickaxe' });
        replaceScriptSettings('set', 'Miner', {});
        sessionStorage.clear();
        expect(inBox('set', () => SettingsStore.saved('Miner', 'rock'))).toBeUndefined();
        expect(SettingsStore.saved('set', 'Miner:rock')).toBe('iron');
    });

    test('the roster and the running profile share settings independently of legacy standalone values', () => {
        for (const store of [sessionStorage, localStorage]) {
            store.setItem('rs2b0t:set:set:travel:mode', 'walk');
        }
        SettingsStore.save('set%3Atravel%3Amode', 'color', 'green');
        inBox('set', () => SettingsStore.save('travel', 'mode', 'ride'));
        expect(SettingsStore.saved('set', 'travel:mode')).toBe('walk');
        expect(readScriptSettings('set', 'travel')).toEqual({ mode: 'ride' });
        replaceScriptSettings('set', 'travel', { 'return:%3A': 'sail' });
        expect(storedScripts(['set'])).toEqual(['travel']);
        expect(inBox('set', () => SettingsStore.saved('travel', 'return:%3A'))).toBe('sail');
        expect(SettingsStore.saved('set%3Atravel%3Amode', 'color')).toBe('green');
        const backup = collectBoxStorage(['set']);
        expect(backup).toEqual({ set: { 'set:travel:return:%3A': 'sail' } });
        applyBoxStorage(backup, ['set']);
        expect(readScriptSettings('set', 'travel')).toEqual({ 'return:%3A': 'sail' });
        sessionStorage.clear();
        expect(SettingsStore.saved('set', 'travel:mode')).toBe('walk');
    });

    for (const [previous, incoming] of [['set', 'set'], ['set', 'fixture'], ['fixture', 'set'], ['set', 'legacy set']]) {
        test(`restoring ${incoming} over ${previous} preserves standalone storage`, () => {
            const loadout = { name: 'travel', worn: {}, carry: [{ item: 'Lobster', qty: 2 }] };
            Loadouts.save([loadout]);
            SettingsStore.save('Global', 'runEnergyMin', '73');
            const user = incoming === 'fixture' ? 'fixture' : 'set';
            const threshold = 'set:Global:runEnergyMin';
            for (const store of [localStorage, sessionStorage]) {
                store.setItem('rs2b0t:set:set:travel:mode', 'walk');
                store.setItem('rs2b0t:set:selectedScript', 'Miner');
                store.setItem('rs2b0t:set:set:Global:runEnergyMin', '31');
                store.setItem(boxKey(threshold, 'set'), '32');
                store.setItem('rs2b0t:set:set:Loadouts:sets', JSON.stringify([{ ...loadout, name: 'profile' }]));
            }
            const entries: Record<string, string> = { [threshold]: '42' };
            if (incoming === 'legacy set') {
                entries['Loadouts:sets'] = '[]';
                entries['Global:runEnergyMin'] = '10';
                entries['set:travel:mode'] = 'ride';
            }

            const snapshot = { ...snap, profiles: [{ username: user, password: '' }], storage: { [user]: entries } };
            const file = incoming === 'legacy set'
                ? JSON.stringify({ ...snapshot, kind: PROFILE_FILE_KIND, v: 1 })
                : serializeProfileFile(snapshot);
            const backup = parseProfileFile(file);
            applyBoxStorage(backup.storage, [previous, ...backup.profiles.map(p => p.username)]);

            expect(inBox('set', () => SettingsStore.saved('Global', 'runEnergyMin'))).toBe(user === 'set' ? '42' : undefined);
            for (const store of [localStorage, sessionStorage]) {
                expect(store.getItem('rs2b0t:set:set:travel:mode')).toBe('walk');
                expect(store.getItem('rs2b0t:set:selectedScript')).toBeNull();
                expect(store.getItem('rs2b0t:set:Global:runEnergyMin')).toBe('73');
                expect(store.getItem('rs2b0t:set:Loadouts:sets')).toBe(JSON.stringify([loadout]));
            }
            sessionStorage.clear();
            expect(SettingsStore.saved('Global', 'runEnergyMin')).toBe('73');
            expect(Loadouts.all()).toEqual([loadout]);
            if (incoming === 'legacy set') {
                expect(collectBoxStorage(['set'])).toEqual({ set: { [threshold]: '42', 'set:travel:mode': 'ride' } });
            }
            expect(inBox('set', () => Loadouts.all())).toEqual([]);
            expect(SettingsStore.saved('set', 'travel:mode')).toBe('walk');
            expect(inBox(user, () => SettingsStore.saved('Global', 'runEnergyMin'))).toBe('42');
            expect(inBox('set', () => SettingsStore.saved('Global', 'runEnergyMin'))).toBe(user === 'set' ? '42' : undefined);
        });
    }
});
