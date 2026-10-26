import { beforeEach, expect, test } from 'bun:test';
import { readProfileScript, writeProfileScript, readScriptSettings, replaceScriptSettings, storedScripts } from '#/bot/multibox/RosterStorage.js';

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

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
    expect(readProfileScript('target')).toBe('NatureCrafter');
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
    expect(localStorage.getItem('rs2b0t:a:selectedScript')).toBe('NatureCrafter');
    expect(sessionStorage.getItem('rs2b0t:a:selectedScript')).toBe('NatureCrafter');
    expect(readScriptSettings('a', 'Miner')).toEqual({ rock: 'iron' });
    expect(storedScripts(['a'])).toEqual(['Miner', 'NatureCrafter']);
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
