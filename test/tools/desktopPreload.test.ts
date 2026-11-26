import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import type { DesktopStorage } from '../../src/bot/runtime/desktopStorage.js';

test('settings cache ignores queued snapshots older than a synchronous write response', async () => {
    const key = 'rs2b0t:set:Global:navPathColorPath';
    let storage!: DesktopStorage;
    let changed!: (_: unknown, message: unknown) => void;
    const calls: string[] = [];
    runInNewContext(readFileSync(new URL('../../desktop/preload.cjs', import.meta.url), 'utf8'), {
        queueMicrotask,
        require: () => ({
            contextBridge: { exposeInMainWorld: (_: string, api: DesktopStorage) => { storage = api; } },
            ipcRenderer: {
                on: (_: string, listener: typeof changed) => { changed = listener; },
                sendSync: (_: string, method: string) => {
                    calls.push(method);
                    if (method === 'snapshot') return { snapshot: { version: 0, data: { [key]: '#000000' } } };
                    if (method === 'setItem') return { snapshot: { version: 2, data: { [key]: '#222222' } } };
                    if (method === 'getItem') return { value: 'fresh encrypted account data' };
                    throw new Error(`Unexpected storage operation: ${method}`);
                }
            }
        })
    });
    const changes: (string | null)[] = [];
    storage.subscribe((_, __, value) => changes.push(value));
    storage.setItem(key, '#222222');
    changed(null, { version: 1, data: { [key]: '#111111' } });
    changed(null, { version: 1, changes: { [key]: null } });
    expect(storage.getItem(key)).toBe('#222222');
    changed(null, { version: 3, changes: { [key]: '#000000' } });
    expect(storage.getItem(key)).toBe('#000000');
    changed(null, { version: 4, data: {} });
    expect(storage.getItem(key)).toBeNull();
    await Promise.resolve();
    expect(changes).toEqual(['#222222', '#000000', null]);
    expect(calls).toEqual(['snapshot', 'setItem']);
    expect(storage.getItem('rs2b0t:multibox:vault')).toBe('fresh encrypted account data');
});

test('reloading a running older desktop keeps shared settings working until restart', () => {
    let storage!: DesktopStorage;
    let changed!: (_: unknown, key: string, oldValue: string | null, newValue: string | null) => void;
    runInNewContext(readFileSync(new URL('../../desktop/preload.cjs', import.meta.url), 'utf8'), {
        queueMicrotask,
        require: () => ({
            contextBridge: { exposeInMainWorld: (_: string, api: DesktopStorage) => { storage = api; } },
            ipcRenderer: {
                on: (_: string, listener: typeof changed) => { changed = listener; },
                sendSync: (_: string, method: string) => method === 'snapshot'
                    ? { error: 'Invalid storage request' }
                    : { value: 'Iron' }
            }
        })
    });
    expect(storage.getItems).toBeUndefined();
    expect(storage.getItem('rs2b0t:set:Miner:ore')).toBe('Iron');
    const changes: (string | null)[][] = [];
    storage.subscribe((key, oldValue, newValue) => changes.push([key, oldValue, newValue]));
    changed(null, 'rs2b0t:set:Miner:ore', 'Iron', 'Tin');
    expect(changes).toEqual([['rs2b0t:set:Miner:ore', 'Iron', 'Tin']]);
});


test('enumerating shared keys uses the current snapshot without synchronous IPC', () => {
    let storage!: DesktopStorage;
    let changed!: (_: unknown, snapshot: { version: number; data: Record<string, string> }) => void;
    const key = 'rs2b0t:alice:set:WalkTo:destination';
    const calls: string[] = [];
    runInNewContext(readFileSync(new URL('../../desktop/preload.cjs', import.meta.url), 'utf8'), {
        queueMicrotask,
        require: () => ({
            contextBridge: { exposeInMainWorld: (_: string, api: DesktopStorage) => { storage = api; } },
            ipcRenderer: {
                on: (_: string, listener: typeof changed) => { changed = listener; },
                sendSync: (_: string, method: string) => {
                    calls.push(method);
                    return method === 'snapshot' ? { snapshot: { version: 0, data: { [key]: 'Varrock' } } } : { value: [key] };
                }
            }
        })
    });
    expect(storage.keys()).toEqual([key]);
    expect(storage.keys()).toEqual([key]);
    expect(calls).toEqual(['snapshot']);
    changed(null, { version: 1, data: {} });
    expect(storage.keys()).toEqual([]);
    changed(null, { version: 0, data: { [key]: 'Varrock' } });
    expect(storage.keys()).toEqual([]);
});

test('consecutive deltas preserve key order and queued values, version gaps recover once', async () => {
    const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(k => 'rs2b0t:set:Demo:' + k);
    const calls: string[] = [];
    let storage!: DesktopStorage;
    let changed!: (_: unknown, message: unknown) => void;
    let current = { version: 0, data: { [a]: 'old', [b]: 'old', [c]: 'old', [d]: 'old' } };
    runInNewContext(readFileSync(new URL('../../desktop/preload.cjs', import.meta.url), 'utf8'), {
        queueMicrotask,
        require: () => ({
            contextBridge: { exposeInMainWorld: (_: string, api: DesktopStorage) => { storage = api; } },
            ipcRenderer: {
                on: (_: string, listener: typeof changed) => { changed = listener; },
                sendSync: (_: string, method: string) => {
                    calls.push(method);
                    return { snapshot: structuredClone(current) };
                }
            }
        })
    });
    const events: (string | null)[][] = [];
    storage.subscribe((...args) => events.push(args));
    changed(null, { version: 1, changes: { [a]: null, [b]: '', [e]: 'new' }, append: [c] });
    expect(storage.keys()).toEqual([b, d, e, c]);
    expect(storage.getItem(a)).toBeNull();
    expect(storage.getItem(b)).toBe('');
    changed(null, { version: 2, changes: { [b]: 'updated' } });
    current = { version: 5, data: { [b]: 'recovered', [e]: 'new' } };
    changed(null, { version: 4, changes: { [a]: 'obsolete' } });
    changed(null, { version: 5, changes: { [a]: 'obsolete' } });
    expect(storage.keys()).toEqual([b, e]);
    expect(storage.getItem(b)).toBe('recovered');
    expect(calls).toEqual(['snapshot', 'snapshot']);
    await Promise.resolve();
    expect(events).toEqual([
        [a, 'old', null], [b, 'old', ''], [e, null, 'new'], [b, '', 'updated'],
        [b, 'updated', 'recovered'], [d, 'old', null], [c, 'old', null]
    ]);
});
