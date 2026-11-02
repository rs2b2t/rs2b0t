import { afterEach, beforeEach, expect, test } from 'bun:test';
import { readProfileScript, writeProfileScript, readScriptSettings, replaceScriptSettings, storedScripts } from '#/bot/multibox/RosterStorage.js';

const clearStorage = () => { localStorage.clear(); sessionStorage.clear(); };
beforeEach(clearStorage);
afterEach(clearStorage);

test('copy replaces one script, preserves other settings, and leaves independent values', () => {
    localStorage.setItem('rs2b0t:source:set:Miner:rock', 'iron');
    sessionStorage.setItem('rs2b0t:source:set:Miner:rock', 'coal');
    localStorage.setItem('rs2b0t:target:set:Miner:rock', 'copper');
    sessionStorage.setItem('rs2b0t:target:set:Miner:old', 'remove');
    localStorage.setItem('rs2b0t:target:set:Global:runAuto', 'false');
    localStorage.setItem('rs2b0t:target:set:MinerPlus:rock', 'gold');
    localStorage.setItem('rs2b0t:target:creds', 'private');
    writeProfileScript('target', 'NatureCrafter');
    const settings = readScriptSettings('source', 'Miner');
    replaceScriptSettings('target', 'Miner', settings);
    expect(readScriptSettings('target', 'Miner')).toEqual({ rock: 'coal' });
    expect(localStorage.getItem('rs2b0t:target:set:Miner:rock')).toBe('coal');
    expect(sessionStorage.getItem('rs2b0t:target:set:Miner:old')).toBeNull();
    expect(localStorage.getItem('rs2b0t:target:set:Global:runAuto')).toBe('false');
    expect(localStorage.getItem('rs2b0t:target:set:MinerPlus:rock')).toBe('gold');
    expect(localStorage.getItem('rs2b0t:target:creds')).toBe('private');
    expect(readProfileScript('target')).toBe('JiveRC');
    replaceScriptSettings('target', 'Miner', { rock: 'iron' });
    expect(readScriptSettings('source', 'Miner')).toEqual({ rock: 'coal' });
});

test('copying defaults clears stale destination overrides in both stores', () => {
    localStorage.setItem('rs2b0t:target:set:Miner:rock', 'coal');
    sessionStorage.setItem('rs2b0t:target:set:Miner:bank', 'false');
    replaceScriptSettings('target', 'Miner', readScriptSettings('source', 'Miner'));
    expect(readScriptSettings('target', 'Miner')).toEqual({});
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
});

test('script assignment persists without copying parameters and catalog excludes globals', () => {
    localStorage.setItem('rs2b0t:a:set:Miner:rock', 'iron');
    localStorage.setItem('rs2b0t:a:set:Global:runAuto', 'false');
    localStorage.setItem('rs2b0t:other:set:Fisher:fish', 'trout');
    writeProfileScript('a', 'NatureCrafter');
    expect(localStorage.getItem('rs2b0t:a:selectedScript')).toBe('JiveRC');
    expect(sessionStorage.getItem('rs2b0t:a:selectedScript')).toBe('JiveRC');
    expect(readScriptSettings('a', 'Miner')).toEqual({ rock: 'iron' });
    expect(storedScripts(['a'])).toEqual(['JiveRC', 'Miner']);
    expect(() => replaceScriptSettings('a', 'Global', {})).toThrow();
    expect(() => writeProfileScript('a', '')).toThrow();
});

test('desktop copying reads durable settings instead of stale session values', () => {
    const result = Bun.spawnSync(['bun', 'test/fixtures/roster-desktop-storage.ts'], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
        script: 'Miner', source: { rock: 'coal' }, target: { rock: 'coal' }, durable: 'coal', session: 'coal'
    });
});

for (const reserved of ['Global', 'MapPicker', 'Loadouts', 'PriceBooks']) test(`storage rejects reserved ${reserved} discovery and direct mutation`, () => {
    for (const store of [localStorage, sessionStorage]) {
        store.setItem(`rs2b0t:alice:set:${reserved}:value`, 'keep');
        store.setItem('rs2b0t:alice:selectedScript', reserved);
    }
    expect(storedScripts(['alice'])).toEqual([]);
    expect(() => writeProfileScript('alice', reserved)).toThrow();
    expect(() => readScriptSettings('alice', reserved)).toThrow();
    expect(() => replaceScriptSettings('alice', reserved, { value: 'overwrite' })).toThrow();
    for (const store of [localStorage, sessionStorage]) {
        expect(store.getItem(`rs2b0t:alice:set:${reserved}:value`)).toBe('keep');
        expect(store.getItem('rs2b0t:alice:selectedScript')).toBe(reserved);
    }
});

test('desktop roster opens and refreshes without enumerating shared storage for every setting', () => {
    const result = Bun.spawnSync(['bun', 'test/fixtures/roster-desktop-storage.ts', '--roster'], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString().trim().split('\n').at(-1)!);
    expect(report.rows).toBe(12);
    expect(report.scripts).toEqual(['Fisher', 'Miner']);
    expect(report.updated).toBe(true);
    expect(report.openReads).toBeLessThan(100);
    expect(report.refreshReads).toBeLessThan(100);
});


test('unloaded NatureCrafter profiles copy inherited values into the JiveRC namespace', () => {
    localStorage.setItem('rs2b0t:source:selectedScript', 'NatureCrafter');
    localStorage.setItem('rs2b0t:source:set:NatureCrafter:rune', 'Nature runes');
    sessionStorage.setItem('rs2b0t:source:set:NatureCrafter:rune', 'Cosmic runes');
    sessionStorage.setItem('rs2b0t:source:set:NatureCrafter:partner', 'legacy runner');
    localStorage.setItem('rs2b0t:source:set:JiveRC:partner', 'current runner');
    const values = readScriptSettings('source', 'JiveRC');
    expect(values).toEqual({ rune: 'Cosmic runes', partner: 'current runner' });
    replaceScriptSettings('target', 'JiveRC', values);
    expect(readScriptSettings('target', 'JiveRC')).toEqual(values);
    expect(localStorage.getItem('rs2b0t:target:set:JiveRC:rune')).toBe('Cosmic runes');
    expect(readProfileScript('source')).toBe('JiveRC');
    expect(storedScripts(['source', 'target'])).toEqual(['JiveRC']);
    localStorage.setItem('rs2b0t:unselected:set:NatureCrafter:mode', 'Runner');
    expect(storedScripts(['unselected'])).toEqual(['JiveRC']);
});

test('replacing JiveRC defaults clears both namespaces without touching other scripts', () => {
    for (const storage of [localStorage, sessionStorage]) {
        storage.setItem('rs2b0t:target:set:NatureCrafter:rune', 'Cosmic runes');
        storage.setItem('rs2b0t:target:set:NatureCrafter:obsolete', 'old');
        storage.setItem('rs2b0t:target:set:JiveRC:partner', 'runner');
        storage.setItem('rs2b0t:target:set:Miner:rock', 'iron');
        storage.setItem('rs2b0t:target:set:Global:runAuto', 'false');
    }
    replaceScriptSettings('target', 'JiveRC', {});
    expect(readScriptSettings('target', 'JiveRC')).toEqual({});
    for (const storage of [localStorage, sessionStorage]) {
        expect(storage.getItem('rs2b0t:target:set:NatureCrafter:obsolete')).toBeNull();
        expect(storage.getItem('rs2b0t:target:set:Miner:rock')).toBe('iron');
        expect(storage.getItem('rs2b0t:target:set:Global:runAuto')).toBe('false');
    }
});
