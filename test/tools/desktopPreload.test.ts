import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import type { DesktopStorage } from '../../src/bot/runtime/desktopStorage.js';

test('settings cache ignores queued snapshots older than a synchronous write response', async () => {
    const key = 'rs2b0t:set:Global:navPathColorPath';
    let storage!: DesktopStorage;
    let changed!: (_: unknown, snapshot: { version: number; data: Record<string, string> }) => void;
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
    expect(storage.getItem(key)).toBe('#222222');
    changed(null, { version: 3, data: { [key]: '#000000' } });
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
    expect(storage.getItem('rs2b0t:set:Miner:ore')).toBe('Iron');
    const changes: (string | null)[][] = [];
    storage.subscribe((key, oldValue, newValue) => changes.push([key, oldValue, newValue]));
    changed(null, 'rs2b0t:set:Miner:ore', 'Iron', 'Tin');
    expect(changes).toEqual([['rs2b0t:set:Miner:ore', 'Iron', 'Tin']]);
});
